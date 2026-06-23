import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/control-plane";
import { StatusBadge } from "@/app/ui/status-badge";
import { timeAgo } from "@/app/ui/time";
import { DeployButton } from "./deploy-button";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getProject(id);
  if (!data) notFound();
  const { project, deployments } = data;
  const prod = deployments.find((d) => d.status === "running") ?? deployments[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-300">
            ← Projects
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">
            {project.name}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {project.production_domain && (
            <a
              href={`https://${project.production_domain}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              Visit ↗
            </a>
          )}
          <DeployButton projectId={project.id} />
        </div>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-500">
            Production deployment
          </h2>
          {prod && <StatusBadge status={prod.status} />}
        </div>
        {prod ? (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Field label="URL">
              {prod.url ? (
                <a
                  href={prod.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-500 hover:underline"
                >
                  {prod.url.replace(/^https?:\/\//, "")} ↗
                </a>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Branch">
              <span className="font-mono">{prod.git_branch}</span>
            </Field>
            <Field label="Commit">
              <span className="font-mono">{prod.git_sha.slice(0, 7)}</span>
            </Field>
            <Field label="Deployed">{timeAgo(prod.created_at)}</Field>
          </dl>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">
            No deployments yet — hit Deploy to ship the first one.
          </p>
        )}
        {prod?.status === "failed" && prod.error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 font-mono text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
            {prod.error}
          </p>
        )}
        <p className="mt-4 flex items-center gap-1.5 text-xs text-zinc-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Running on your box — flat cost, no per-request billing, no overages.
        </p>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-medium text-zinc-500">Source</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <Field label="Repository">
            <span className="break-all font-mono">{project.repo_url}</span>
          </Field>
          <Field label="Default branch">
            <span className="font-mono">{project.default_branch}</span>
          </Field>
          <Field label="Domain">{project.production_domain ?? "—"}</Field>
        </dl>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Deployments</h2>
        {deployments.length === 0 ? (
          <p className="text-sm text-zinc-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
            {deployments.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/deployments/${d.id}`}
                  className="flex items-center justify-between bg-white px-5 py-3 hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900/50"
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
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
