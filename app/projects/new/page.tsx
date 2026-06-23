"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewProject() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const body = {
      name: String(f.get("name") ?? "").trim(),
      repo_url: String(f.get("repo_url") ?? "").trim(),
      default_branch: String(f.get("default_branch") ?? "main").trim() || "main",
      production_domain:
        String(f.get("production_domain") ?? "").trim() || undefined,
    };
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      router.push(`/projects/${data.project.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-300">
        ← Projects
      </Link>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">New project</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Connect a GitHub repo. Push to its default branch and it deploys to your box.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-5">
        <Field
          name="name"
          label="Name"
          placeholder="my-app"
          required
          hint="Lowercase, used for the default subdomain."
        />
        <Field
          name="repo_url"
          label="GitHub repository"
          placeholder="https://github.com/you/my-app"
          required
          hint="HTTPS clone URL. Private repos need a token (added later)."
        />
        <div className="grid grid-cols-2 gap-4">
          <Field name="default_branch" label="Production branch" placeholder="main" />
          <Field
            name="production_domain"
            label="Production domain"
            placeholder="my-app.example.com"
            hint="Optional — defaults to a subdomain."
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 font-mono text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {busy ? "Creating…" : "Create project"}
          </button>
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-400">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  placeholder,
  hint,
  required,
}: {
  name: string;
  label: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-zinc-400"> *</span>}
      </span>
      <input
        name={name}
        placeholder={placeholder}
        required={required}
        className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
      />
      {hint && <span className="mt-1 block text-xs text-zinc-400">{hint}</span>}
    </label>
  );
}
