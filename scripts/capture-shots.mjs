// Capture deployment thumbnails for the Projects grid (the "Vercel preview" look).
//
// Localhost-first: reads the project → domain map from the control plane (over your
// running `pnpm tunnel`), screenshots each project's *live* deployment over public
// HTTPS, and writes JPEGs into public/shots/<projectId>.jpg for the dashboard to show.
//
//   pnpm shots
//
// Web-app port later: run this as a worker on the app box, triggered on deploy
// success, writing to object storage instead of public/. The seam is captureUrl()
// + where the bytes land — everything else stays.

import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "shots");
const VIEWPORT = { width: 1280, height: 800 };
const NAV_TIMEOUT = 20_000;

// Minimal .env.local reader so this shares CONTROL_PLANE_URL with the dashboard.
async function envLocal(key) {
  if (process.env[key]) return process.env[key];
  const f = path.join(ROOT, ".env.local");
  if (!existsSync(f)) return undefined;
  const line = (await readFile(f, "utf8"))
    .split("\n")
    .find((l) => l.trim().startsWith(`${key}=`));
  return line
    ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")
    : undefined;
}

const CP = (await envLocal("CONTROL_PLANE_URL")) ?? "http://127.0.0.1:8787";

async function cp(p) {
  const res = await fetch(CP + p, { cache: "no-store" });
  if (!res.ok) throw new Error(`control plane ${p} → HTTP ${res.status}`);
  return res.json();
}

// Prefer the stable production domain; fall back to the latest deployment URL.
// Returns null for anything we can't load in a browser (e.g. file:// sources).
function captureUrl(project, latest) {
  const raw = project.production_domain
    ? `https://${project.production_domain}`
    : (latest?.url ?? null);
  return raw && /^https?:\/\//.test(raw) ? raw : null;
}

async function main() {
  let projects, deployments;
  try {
    [{ projects }, { deployments }] = await Promise.all([
      cp("/projects"),
      cp("/deployments"),
    ]);
  } catch (err) {
    console.error(`✖ Can't reach the control plane at ${CP}.`);
    console.error("  Start the tunnel first:  pnpm tunnel");
    console.error(`  (${err.message})`);
    process.exit(1);
  }

  // The control plane returns deployments newest-first (same as the dashboard),
  // so the first one seen per project is the latest.
  const latestByProject = new Map();
  for (const d of deployments ?? []) {
    if (!latestByProject.has(d.project_id)) latestByProject.set(d.project_id, d);
  }

  const targets = [];
  for (const p of projects ?? []) {
    const latest = latestByProject.get(p.id);
    const url = captureUrl(p, latest);
    // Only shoot deployments that are actually serving something.
    if (url && latest?.status === "running") targets.push({ p, url });
    else {
      const why = !url ? "no http url" : (latest?.status ?? "no deployments");
      console.log(`· skip ${p.name} (${why})`);
    }
  }

  if (targets.length === 0) {
    console.log("Nothing to capture.");
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  let ok = 0;
  for (const { p, url } of targets) {
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
      await page.waitForTimeout(600); // let fonts / hero images settle
      const buf = await page.screenshot({ type: "jpeg", quality: 72 });
      await writeFile(path.join(OUT_DIR, `${p.id}.jpg`), buf);
      console.log(`✓ ${p.name.padEnd(16)} ${url}  →  public/shots/${p.id}.jpg`);
      ok++;
    } catch (err) {
      console.warn(`✖ ${p.name.padEnd(16)} ${url}  (${err.message.split("\n")[0]})`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log(`\nDone — ${ok}/${targets.length} captured.`);
}

main();
