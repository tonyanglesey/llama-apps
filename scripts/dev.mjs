#!/usr/bin/env node
/**
 * `npm run dev` — run the full local stack together: the control plane
 * (build/deploy orchestrator) and the dashboard frontend. The all-local OSS
 * setup needs no SSH tunnel; every server is configured in .env.
 *
 *   control plane  -> reads control-plane/.env  (PG_*, optional Caddy)
 *   frontend       -> reads ./.env              (CONTROL_PLANE_URL)
 *
 * Logs from each are prefixed. Ctrl-C stops both. To run just one, use
 * `npm run dev:web` here, or `npm run dev` inside control-plane/.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const cpDir = path.join(root, "control-plane");

const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const RESET = "\x1b[0m";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function probe(host, port, timeout = 500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    s.setTimeout(timeout, () => done(false));
  });
}

/** Read PORT out of control-plane/.env (defaults to 8787). */
function controlPlanePort() {
  try {
    const m = readFileSync(path.join(cpDir, ".env"), "utf8").match(
      /^\s*PORT\s*=\s*(\d+)/m
    );
    if (m) return Number(m[1]);
  } catch {
    /* fall through */
  }
  return 8787;
}

/** Pipe a child's stdout/stderr through a colored prefix. */
function prefix(child, label, color) {
  for (const stream of [child.stdout, child.stderr]) {
    readline
      .createInterface({ input: stream })
      .on("line", (line) =>
        process.stdout.write(`${color}${label}${RESET} ${line}\n`)
      );
  }
}

if (!existsSync(path.join(cpDir, ".env"))) {
  console.log(
    `${DIM}note: control-plane/.env not found — copy control-plane/.env.example and set PG_*.${RESET}`
  );
}

// Control plane: run in its own dir so dotenv loads control-plane/.env.
const cp = spawn("npm", ["run", "dev"], {
  cwd: cpDir,
  stdio: ["ignore", "pipe", "pipe"],
});
prefix(cp, "[control-plane]", CYAN);

// Frontend: invoke Next's bin directly via node (portable, no shell).
const nextBin = path.join(root, "node_modules/next/dist/bin/next");
const web = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", "3000"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
prefix(web, "[frontend]    ", MAGENTA);

// Announce once the control plane is actually accepting connections.
(async () => {
  const port = controlPlanePort();
  for (let i = 0; i < 60; i++) {
    if (await probe("127.0.0.1", port)) {
      console.log(`${CYAN}[control-plane]${RESET} listening on http://127.0.0.1:${port}`);
      return;
    }
    await delay(500);
  }
  console.log(
    `${CYAN}[control-plane]${RESET} ${DIM}not listening yet after 30s — check control-plane/.env${RESET}`
  );
})();

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  cp.kill("SIGINT");
  web.kill("SIGINT");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// If either process dies, bring the other down and exit with its code.
cp.on("exit", (code) => {
  if (!shuttingDown)
    console.log(`${CYAN}[control-plane]${RESET} exited (${code ?? 0})`);
  shutdown();
  process.exit(code ?? 0);
});
web.on("exit", (code) => {
  if (!shuttingDown)
    console.log(`${MAGENTA}[frontend]${RESET} exited (${code ?? 0})`);
  shutdown();
  process.exit(code ?? 0);
});
