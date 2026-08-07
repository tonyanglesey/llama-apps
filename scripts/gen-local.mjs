// Local, zero-infra harness for the generator core.
//
//   ANTHROPIC_API_KEY=sk-... node scripts/gen-local.mjs "a tool for my gym
//     clients to book sessions" [outDir]
//
// Runs prompt -> generateApp() and writes the file tree to disk so you can
// eyeball it and `cd <outDir> && npm install && npm run dev`. No GitHub, no
// Docker, no control plane involved — this exercises ONLY the new code.
//
// Needs a TypeScript loader since lib/builder is .ts. Run under tsx:
//   npx tsx scripts/gen-local.mjs "..."   (or `node --import tsx ...`)

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { generateApp } from "../lib/builder/generate.js";

// Minimal .env loader (no dotenv dep). Reads the first .env it finds so
// `npm run gen -- "..."` just works. Checks the llama-apps dir, then the
// sibling llama-crm/.env where the key currently lives.
async function loadEnv() {
  const candidates = [
    resolve("./.env"),
    resolve("../llama-crm/.env"),
  ];
  for (const path of candidates) {
    let text;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      const val = m[2].replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}
await loadEnv();

const prompt = process.argv[2];
const outDir = resolve(process.argv[3] ?? "./.gen-out");

if (!prompt) {
  console.error('usage: npx tsx scripts/gen-local.mjs "<prompt>" [outDir]');
  process.exit(1);
}

console.log(`\n▸ generating from: ${JSON.stringify(prompt)}`);
console.time("generate");
const app = await generateApp({ prompt });
console.timeEnd("generate");

console.log(`\n▸ name:    ${app.name}`);
console.log(`▸ summary: ${app.summary}`);
console.log(`▸ entities: ${app.spec.entities.map((e) => e.name).join(", ") || "(none)"}`);
console.log(`▸ auth:    ${app.spec.auth}`);
console.log(`▸ files:   ${app.files.length}`);

for (const f of app.files) {
  const dest = join(outDir, f.path);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, f.contents, "utf8");
  console.log(`  + ${f.path}`);
}

console.log(`\n✔ written to ${outDir}`);
console.log(`  next: cd ${outDir} && npm install && npm run dev\n`);
