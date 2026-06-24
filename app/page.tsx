import Link from "next/link";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import {
  getProjects,
  getDeployments,
  type Deployment,
} from "@/lib/control-plane";
import { StatusBadge } from "@/app/ui/status-badge";
import { timeAgo } from "@/app/ui/time";

// Deployment thumbnails are captured out-of-band by `pnpm shots` into
// public/shots/<projectId>.jpg. We check the filesystem at render time and
// cache-bust on the file's mtime so a fresh capture shows immediately.
function shotFor(projectId: string): string | null {
  const file = path.join(process.cwd(), "public", "shots", `${projectId}.jpg`);
  if (!existsSync(file)) return null;
  return `/shots/${projectId}.jpg?v=${Math.floor(statSync(file).mtimeMs)}`;
}

export default async function Home() {
  let projects, deployments;
  try {
    [projects, deployments] = await Promise.all([
      getProjects(),
      getDeployments(),
    ]);
  } catch (err) {
    return <ConnectionError message={(err as Error).message} />;
  }

  const byProject = new Map<string, Deployment[]>();
  for (const d of deployments) {
    const arr = byProject.get(d.project_id);
    if (arr) arr.push(d);
    else byProject.set(d.project_id, [d]);
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <span className="text-sm text-zinc-400">
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </span>
        </div>
        <Link
          href="/projects/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          + New Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <Empty />
      ) : (
        <ul className="grid w-full grid-cols-1 items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const deps = byProject.get(p.id) ?? [];
            const latest = deps[0];
            const shot = shotFor(p.id);
            return (
              <li
                key={p.id}
                className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
              >
                {shot ? (
                  <a
                    href={
                      p.production_domain
                        ? `https://${p.production_domain}`
                        : `/projects/${p.id}`
                    }
                    target={p.production_domain ? "_blank" : undefined}
                    rel="noreferrer"
                    className="block aspect-[16/10] overflow-hidden border-b border-zinc-100 bg-zinc-100 dark:border-zinc-900 dark:bg-zinc-900"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={shot}
                      alt={`${p.name} preview`}
                      loading="lazy"
                      className="h-full w-full object-cover object-top transition-transform duration-300 hover:scale-[1.02]"
                    />
                  </a>
                ) : (
                  <div className="grid aspect-[16/10] place-items-center border-b border-zinc-100 bg-gradient-to-br from-zinc-50 to-zinc-100 dark:border-zinc-900 dark:from-zinc-900 dark:to-zinc-950">
                    <span className="font-mono text-xs text-zinc-400 dark:text-zinc-600">
                      no preview yet
                    </span>
                  </div>
                )}
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href={`/projects/${p.id}`}
                      className="min-w-0 truncate font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                    {latest && (
                      <span className="shrink-0">
                        <StatusBadge status={latest.status} />
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate font-mono text-sm text-zinc-500">
                    {p.repo_url}
                  </p>
                  {p.production_domain && (
                    <a
                      href={`https://${p.production_domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block truncate text-sm text-indigo-500 hover:underline"
                    >
                      {p.production_domain} ↗
                    </a>
                  )}
                  <p className="mt-1 font-mono text-xs text-zinc-400">
                    {p.default_branch}
                  </p>
                </div>

                {deps.length > 0 && (
                  <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-900 dark:border-zinc-900">
                    {deps.slice(0, 3).map((d) => (
                      <li key={d.id}>
                        <Link
                          href={`/deployments/${d.id}`}
                          className="flex items-center justify-between px-5 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <StatusBadge status={d.status} dot />
                            <span className="font-mono text-xs text-zinc-500">
                              {d.git_sha.slice(0, 7)}
                            </span>
                            <span className="truncate text-sm text-zinc-400">
                              {d.git_branch}
                            </span>
                          </div>
                          <span className="shrink-0 text-xs text-zinc-400">
                            {timeAgo(d.created_at)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
      <p className="text-zinc-500">No projects yet.</p>
      <p className="mt-1 text-sm text-zinc-400">
        Connect a GitHub repo to deploy your first app.
      </p>
    </div>
  );
}

function ConnectionError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 dark:border-red-900/50 dark:bg-red-950/30">
      <h2 className="font-medium text-red-700 dark:text-red-400">
        Can&apos;t reach the control plane
      </h2>
      <p className="mt-1 font-mono text-sm text-red-600/80 dark:text-red-400/80">
        {message}
      </p>
      <p className="mt-3 text-sm text-zinc-500">
        Start the control plane (or tunnel to the box it runs on) and point{" "}
        <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">
          CONTROL_PLANE_URL
        </code>{" "}
        at it — it defaults to{" "}
        <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">
          http://127.0.0.1:8787
        </code>
        .
      </p>
    </div>
  );
}
