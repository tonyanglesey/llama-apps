"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Row = { id: number; key: string; value: string };

// Parse a pasted .env blob into clean key→value pairs. Tolerates the usual mess:
// blank lines, `# comments`, `export ` prefixes, and surrounding single/double
// quotes. Inline `#` is left intact on purpose — secrets can legitimately
// contain it, and silently truncating a value is worse than keeping a stray tail.
function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// Order-independent canonical form, so reordering rows isn't seen as "dirty".
function canon(env: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(env).sort()) sorted[k] = env[k];
  return JSON.stringify(sorted);
}

function rowsToEnv(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (k) out[k] = r.value; // last write wins on dup keys
  }
  return out;
}

export function EnvSettings({
  projectId,
  env,
}: {
  projectId: string;
  env: Record<string, string>;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    Object.entries(env).map(([key, value], i) => ({ id: i, key, value })),
  );
  const [nextId, setNextId] = useState(Object.keys(env).length);
  const [reveal, setReveal] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const dirty = canon(rowsToEnv(rows)) !== canon(env);

  function edit(id: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setSaved(false);
  }
  function addRow() {
    setRows((rs) => [...rs, { id: nextId, key: "", value: "" }]);
    setNextId((n) => n + 1);
    setSaved(false);
  }
  function removeRow(id: number) {
    setRows((rs) => rs.filter((r) => r.id !== id));
    setSaved(false);
  }

  function applyImport() {
    const parsed = parseDotenv(paste);
    if (!Object.keys(parsed).length) {
      setImportOpen(false);
      setPaste("");
      return;
    }
    // Merge: existing keys are overwritten in place, new keys appended.
    const merged = new Map<string, string>();
    for (const r of rows) if (r.key.trim()) merged.set(r.key.trim(), r.value);
    for (const [k, v] of Object.entries(parsed)) merged.set(k, v);
    let id = 0;
    const next: Row[] = [];
    for (const [k, v] of merged) next.push({ id: id++, key: k, value: v });
    setRows(next);
    setNextId(id);
    setPaste("");
    setImportOpen(false);
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ env: rowsToEnv(rows) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setSaved(true);
      router.refresh();
    } catch (err) {
      window.alert("Save failed: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {rows.length === 0 && !importOpen && (
        <p className="text-sm text-zinc-500">
          No environment variables yet. Add one, or import a .env file.
        </p>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <input
                value={r.key}
                onChange={(e) => edit(r.id, { key: e.target.value })}
                placeholder="KEY"
                spellCheck={false}
                className="w-2/5 rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
              <input
                value={r.value}
                onChange={(e) => edit(r.id, { value: e.target.value })}
                placeholder="value"
                spellCheck={false}
                type={reveal ? "text" : "password"}
                className="flex-1 rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
              <button
                onClick={() => removeRow(r.id)}
                aria-label="Remove variable"
                className="shrink-0 rounded-md px-2 py-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-900 dark:hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {importOpen && (
        <div className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500">
            Paste a .env file — comments, <code>export</code> prefixes and quotes
            are stripped automatically. Matching keys are overwritten.
          </p>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={6}
            spellCheck={false}
            placeholder={"# pasted lines like\nDATABASE_URL=postgres://...\nexport API_KEY=\"sk-...\""}
            className="w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-2 font-mono text-xs outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setImportOpen(false);
                setPaste("");
              }}
              className="rounded-md px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
            <button
              onClick={applyImport}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Import
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <button
          onClick={addRow}
          className="text-sm font-medium text-indigo-500 hover:underline"
        >
          + Add variable
        </button>
        {!importOpen && (
          <button
            onClick={() => setImportOpen(true)}
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Import .env
          </button>
        )}
        {rows.length > 0 && (
          <label className="flex items-center gap-1.5 text-sm text-zinc-500">
            <input
              type="checkbox"
              checked={reveal}
              onChange={(e) => setReveal(e.target.checked)}
            />
            Show values
          </label>
        )}

        <div className="ml-auto flex items-center gap-3">
          {saved && !dirty && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              Saved — applies on next deploy
            </span>
          )}
          {dirty && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Unsaved changes
            </span>
          )}
          <button
            onClick={save}
            disabled={!dirty || busy}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
