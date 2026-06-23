"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeployButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function deploy() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/deploy`, {
        method: "POST",
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      // Let the control plane create the deployment row, then refresh server data.
      setTimeout(() => {
        router.refresh();
        setBusy(false);
      }, 1500);
    } catch (err) {
      window.alert("Deploy failed: " + (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <button
      onClick={deploy}
      disabled={busy}
      className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
    >
      {busy ? "Deploying…" : "Deploy"}
    </button>
  );
}
