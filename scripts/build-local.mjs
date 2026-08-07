// End-to-end builder harness: prompt -> generate -> GitHub repo -> deploy.
//
//   npm run build:app -- "a tool for my gym clients to book sessions"
//
// Needs, beyond generation:
//   ANTHROPIC_API_KEY / CLAUDE_API_KEY  — the model (with console credit)
//   GITHUB_TOKEN                        — repo-create scope
//   CONTROL_PLANE_URL                   — reachable control plane (loopback/tunnel)
// All are read from ../llama-crm/.env or ./.env automatically (see loadEnv).
//
// Prints live stage progress and ends with the repo + preview URL. The actual
// build/container/route happens async in the control plane — follow it in the
// dashboard's deployment log view.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildApp } from "../lib/builder/pipeline.js";

async function loadEnv() {
  for (const path of [resolve("./.env"), resolve("../llama-crm/.env")]) {
    let text;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env))
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
await loadEnv();

const prompt = process.argv[2];
if (!prompt) {
  console.error('usage: npm run build:app -- "<prompt>"');
  process.exit(1);
}

const missing = ["GITHUB_TOKEN"].filter((k) => !process.env[k]);
if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_API_KEY)
  missing.push("ANTHROPIC_API_KEY");
if (missing.length) {
  console.error(`missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`\n▸ building from: ${JSON.stringify(prompt)}\n`);
const res = await buildApp({
  prompt,
  onProgress: ({ stage, detail }) =>
    console.log(`  [${stage}]${detail ? ` ${detail}` : ""}`),
});

console.log(`\n✔ queued`);
console.log(`  repo:    ${res.repo.htmlUrl}`);
console.log(`  project: ${res.projectId}`);
console.log(`  deploy:  ${res.deploymentId}`);
console.log(`  preview: ${res.previewUrl}  (live once the build finishes)\n`);
