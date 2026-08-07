// The generator core — the one genuinely new piece of the builder. Everything
// else (publish, deploy, route, TLS) already exists in the control plane.
//
// Input:  a natural-language prompt (+ optional partial spec from the guided flow)
// Output: a GeneratedApp — a validated file tree ready to be committed to a fresh
//         GitHub repo and handed to the existing deploy spine.
//
// Reliability strategy (not one giant "write me an app" prompt):
//   1. Force structured output via Anthropic tool-use — the model MUST return a
//      files[] array through the emit_project tool, so we never parse prose.
//   2. Constrain hard in the system prompt: Next.js 16 + @lla-ma/ui + raw `pg`
//      (no ORM), a shape Nixpacks can build unattended.
//   3. Validate every result before it can reach GitHub/Docker — a malformed
//      package.json or a path-traversal filename fails here, loudly, not on the box.

import Anthropic from "@anthropic-ai/sdk";
import { normalizeSpec, slugify, type AppSpec } from "./spec.js";

export interface GeneratedFile {
  path: string; // repo-relative, forward slashes, no leading slash
  contents: string;
}

export interface GeneratedApp {
  name: string; // slug — becomes the repo name and the *.apps.lla.ma subdomain
  summary: string; // one-liner shown back to the user before deploy
  spec: AppSpec; // the structured spec the model worked from (store/show/edit)
  files: GeneratedFile[];
}

// Configurable so we can trade cost/quality without a code change. Codegen
// quality is the whole game here, so the default leans capable.
const MODEL = process.env.BUILDER_MODEL ?? "claude-opus-4-8";
const MAX_TOKENS = Number(process.env.BUILDER_MAX_TOKENS ?? 16000);

const SYSTEM = `You generate a complete, deployable Next.js application from a spec.

The app is deployed unattended by Nixpacks (auto-detect) → Docker → \`next start\`.
It must build and boot with ZERO manual steps. Follow these rules exactly:

STACK (non-negotiable — this is the house stack):
- Next.js 16 (App Router) + React 19 + TypeScript.
- UI: import components from "@lla-ma/ui" (available: Card, Button, Input, Textarea,
  Select, Checkbox, Badge, Navbar, Footer). Import its stylesheet once in the root
  layout: import "@lla-ma/ui/styles.css".
- Database: raw \`pg\` (node-postgres). NO ORM, no Prisma, no Drizzle. A single
  Pool reading process.env.DATABASE_URL, created in lib/db.ts.
- Styling: Tailwind is available via @lla-ma/ui's stylesheet; keep custom CSS minimal.

MUST INCLUDE:
- package.json with: "next", "react", "react-dom", "@lla-ma/ui", "pg" as deps;
  "@types/*" + "typescript" as devDeps; scripts { "dev": "next dev", "build":
  "next build", "start": "next start" }. Do NOT pin a hard -p PORT in start —
  Nixpacks sets $PORT and next respects it.
- schema.sql at the repo root: CREATE TABLE for every entity. Every table gets
  \`id uuid primary key default gen_random_uuid()\` and \`created_at timestamptz
  not null default now()\`. Emit relations as real foreign keys.
- lib/db.ts: exports a shared pg Pool from DATABASE_URL.
- app/layout.tsx importing the @lla-ma/ui stylesheet.
- app/page.tsx: a dashboard linking to each entity.
- Per entity: a list page and a create form (Server Actions or route handlers +
  \`pg\` queries). Real, working CRUD — not TODO stubs.
- next.config.ts, tsconfig.json, and a README.md with the one env var (DATABASE_URL).

RULES:
- Parameterize every SQL query ($1, $2…). Never string-concatenate user input.
- Do not invent env vars beyond DATABASE_URL (and auth vars only if auth != none).
- Do not commit secrets or a .env with real values (a .env.example is fine).
- Keep it tight and coherent over clever. It must actually compile and run.

Return the project ONLY by calling the emit_project tool.`;

// The tool schema is the contract. Forcing tool_choice guarantees we get this
// shape back instead of markdown we'd have to scrape.
const EMIT_TOOL: Anthropic.Tool = {
  name: "emit_project",
  description: "Emit the complete generated project as a file tree.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Short slug for the app; lowercase, hyphenated. Becomes the repo name and subdomain.",
      },
      summary: { type: "string", description: "One sentence describing the app." },
      spec: {
        type: "object",
        description:
          "The structured spec you worked from, so it can be shown back and edited.",
        properties: {
          description: { type: "string" },
          appType: {
            type: "string",
            enum: ["internal", "public", "saas", "content"],
          },
          entities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                fields: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      type: {
                        type: "string",
                        enum: [
                          "text",
                          "int",
                          "float",
                          "bool",
                          "timestamp",
                          "uuid",
                          "json",
                        ],
                      },
                      ref: { type: "string" },
                    },
                    required: ["name", "type"],
                  },
                },
              },
              required: ["name", "fields"],
            },
          },
          auth: {
            type: "string",
            enum: ["none", "passkey", "password", "social"],
          },
          roles: { type: "array", items: { type: "string" } },
          integrations: { type: "array", items: { type: "string" } },
        },
        required: ["description", "appType", "entities", "auth"],
      },
      files: {
        type: "array",
        description: "Every file in the project.",
        items: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Repo-relative path, forward slashes, no leading slash.",
            },
            contents: { type: "string" },
          },
          required: ["path", "contents"],
        },
      },
    },
    required: ["name", "summary", "spec", "files"],
  },
};

export interface GenerateInput {
  prompt: string;
  // From the guided flow, if present — steers the model instead of letting it
  // infer everything. v0 passes just the prompt.
  spec?: Partial<AppSpec>;
  apiKey?: string; // defaults to process.env.ANTHROPIC_API_KEY
}

export async function generateApp(input: GenerateInput): Promise<GeneratedApp> {
  // Accept either the SDK's standard name or the CLAUDE_API_KEY alias used
  // elsewhere in this ecosystem's .env files.
  const apiKey =
    input.apiKey ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.CLAUDE_API_KEY;
  if (!apiKey)
    throw new Error("ANTHROPIC_API_KEY (or CLAUDE_API_KEY) is not set");
  if (!input.prompt?.trim()) throw new Error("prompt is required");

  const client = new Anthropic({ apiKey });

  const userMsg = input.spec
    ? `Build this app.\n\nDescription: ${input.prompt}\n\nStructured spec (authoritative — honor it):\n${JSON.stringify(
        normalizeSpec(input.spec),
        null,
        2,
      )}`
    : `Build this app from the description below. Infer a sensible spec (entities,
appType, auth) and return it alongside the files.\n\nDescription: ${input.prompt}`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    tools: [EMIT_TOOL],
    tool_choice: { type: "tool", name: "emit_project" },
    messages: [{ role: "user", content: userMsg }],
  });

  const block = res.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === "emit_project",
  );
  if (!block) {
    throw new Error(
      `model did not call emit_project (stop_reason=${res.stop_reason})`,
    );
  }

  return validate(block.input as RawEmit);
}

interface RawEmit {
  name?: string;
  summary?: string;
  spec?: Partial<AppSpec>;
  files?: { path?: string; contents?: string }[];
}

// Everything below is the safety gate between the model and real infra. A file
// tree that fails here never reaches GitHub or the build box.
const MAX_FILES = 120;
const MAX_FILE_BYTES = 200_000;

function validate(raw: RawEmit): GeneratedApp {
  const name = slugify((raw.name ?? "").toString());
  const files = normalizeFiles(raw.files ?? []);

  if (files.length === 0) throw new Error("generation returned no files");
  if (files.length > MAX_FILES)
    throw new Error(`generation returned too many files (${files.length})`);

  const byPath = new Map(files.map((f) => [f.path, f]));

  // package.json must exist, parse, and be buildable by the deploy spine.
  const pkgFile = byPath.get("package.json");
  if (!pkgFile) throw new Error("generation is missing package.json");
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(pkgFile.contents);
  } catch {
    throw new Error("generated package.json is not valid JSON");
  }
  if (!pkg.scripts?.build || !pkg.scripts?.start)
    throw new Error('package.json must define "build" and "start" scripts');
  if (!pkg.dependencies?.next)
    throw new Error("package.json must depend on next");

  // A Next app router entrypoint must exist, or `next start` serves nothing.
  const hasEntry = files.some(
    (f) => f.path === "app/page.tsx" || f.path === "app/page.js",
  );
  if (!hasEntry) throw new Error("generation is missing app/page.tsx");

  return {
    name,
    summary: (raw.summary ?? "").toString().trim(),
    spec: normalizeSpec(raw.spec),
    files,
  };
}

function normalizeFiles(raw: { path?: string; contents?: string }[]): GeneratedFile[] {
  const seen = new Set<string>();
  const out: GeneratedFile[] = [];
  for (const f of raw) {
    const path = (f?.path ?? "").toString().trim().replace(/^\/+/, "");
    const contents = (f?.contents ?? "").toString();
    if (!path) continue;
    // Reject anything that could escape the repo root or is obviously hostile.
    if (path.includes("..") || path.includes("\0") || path.startsWith("/"))
      throw new Error(`unsafe file path from generation: ${path}`);
    if (Buffer.byteLength(contents, "utf8") > MAX_FILE_BYTES)
      throw new Error(`generated file too large: ${path}`);
    if (seen.has(path)) continue; // first write wins
    seen.add(path);
    out.push({ path, contents });
  }
  return out;
}
