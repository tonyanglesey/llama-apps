const badge: Record<string, string> = {
  running:
    "text-emerald-700 bg-emerald-50 ring-emerald-600/20 dark:text-emerald-400 dark:bg-emerald-500/10",
  building:
    "text-amber-700 bg-amber-50 ring-amber-600/20 dark:text-amber-400 dark:bg-amber-500/10",
  queued:
    "text-zinc-600 bg-zinc-100 ring-zinc-500/20 dark:text-zinc-400 dark:bg-zinc-500/10",
  failed:
    "text-red-700 bg-red-50 ring-red-600/20 dark:text-red-400 dark:bg-red-500/10",
  cancelled:
    "text-zinc-500 bg-zinc-100 ring-zinc-500/20 dark:text-zinc-500 dark:bg-zinc-500/10",
};

const dotColor: Record<string, string> = {
  running: "bg-emerald-500",
  building: "bg-amber-500 animate-pulse",
  queued: "bg-zinc-400",
  failed: "bg-red-500",
  cancelled: "bg-zinc-400",
};

export function StatusBadge({
  status,
  dot = false,
}: {
  status: string;
  dot?: boolean;
}) {
  if (dot) {
    return (
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotColor[status] ?? "bg-zinc-400"}`}
        title={status}
      />
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${badge[status] ?? badge.queued}`}
    >
      {status}
    </span>
  );
}
