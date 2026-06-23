import Link from "next/link";
import { notFound } from "next/navigation";
import { getDeployment } from "@/lib/control-plane";
import { StatusBadge } from "@/app/ui/status-badge";
import { timeAgo } from "@/app/ui/time";
import { BuildLogs } from "./build-logs";

export default async function DeploymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const d = await getDeployment(id);
  if (!d) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${d.project_id}`}
          className="text-sm text-zinc-400 hover:text-zinc-300"
        >
          ← {d.project_name}
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Deployment</h1>
          <StatusBadge status={d.status} />
        </div>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <Field label="Commit">
            <span className="font-mono">{d.git_sha.slice(0, 7)}</span>
          </Field>
          <Field label="Branch">
            <span className="font-mono">{d.git_branch}</span>
          </Field>
          <Field label="URL">
            {d.url ? (
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-500 hover:underline"
              >
                {d.url.replace(/^https?:\/\//, "")} ↗
              </a>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Started">
            {d.started_at ? timeAgo(d.started_at) : "—"}
          </Field>
        </dl>
        {d.status === "failed" && d.error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 font-mono text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
            {d.error}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Build logs</h2>
        <BuildLogs deploymentId={d.id} initialStatus={d.status} />
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
