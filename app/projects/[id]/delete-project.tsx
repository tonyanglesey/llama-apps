"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Type-to-confirm delete. The action is irreversible (tears down containers,
// routing and all deployment history), so the button only arms once the user
// types the project name exactly — mirroring the GitHub/Vercel danger pattern.
export function DeleteProject({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const armed = confirm.trim() === projectName && !busy;

  function close() {
    if (busy) return;
    setOpen(false);
    setConfirm("");
  }

  async function remove() {
    if (!armed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      // The project (and this page) are gone — head back to the overview.
      router.push("/");
    } catch (err) {
      window.alert("Delete failed: " + (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
      >
        Delete project
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">Delete this project?</h3>
            <p className="mt-2 text-sm text-zinc-500">
              This permanently deletes{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {projectName}
              </span>{" "}
              and all its deployment history, and tears down its running
              containers and routing. This cannot be undone.
            </p>
            <label className="mt-4 block text-xs text-zinc-500">
              Type{" "}
              <span className="font-mono text-zinc-700 dark:text-zinc-300">
                {projectName}
              </span>{" "}
              to confirm
            </label>
            <input
              autoFocus
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && remove()}
              placeholder={projectName}
              className="mt-1.5 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-500"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={close}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                onClick={remove}
                disabled={!armed}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Deleting…" : "Delete project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
