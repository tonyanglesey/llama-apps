import { execa } from "execa";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { dockerEnvFlags } from "./secrets.js";

export type LogFn = (stream: "stdout" | "stderr", chunk: string) => void | Promise<void>;

// Node major to use for repos that DON'T pin a version themselves. nixpacks
// otherwise defaults to an EOL Node 18, which breaks modern toolchains (Vite 5+,
// React Router 7+, Next 14+ all need >=20, some >=22). Configurable per operator.
const DEFAULT_NODE_VERSION = process.env.BUILD_NODE_VERSION ?? "22";

// Optional: pin the build/run architecture (e.g. "linux/amd64") so every host —
// Intel, Apple Silicon, Windows, Linux — produces an identical image and the
// same native binaries resolve. Unset = build for the host's native arch
// (faster; arm64 hosts stay native instead of emulating).
const BUILD_PLATFORM = process.env.BUILD_PLATFORM || undefined;

// Does the repo pin its own Node version? If so we leave it alone (it wins);
// otherwise we inject a modern default instead of nixpacks' ancient fallback.
function repoPinsNode(repoDir: string): boolean {
  if (
    existsSync(path.join(repoDir, ".nvmrc")) ||
    existsSync(path.join(repoDir, ".node-version"))
  ) {
    return true;
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(repoDir, "package.json"), "utf8"));
    return Boolean(pkg?.engines?.node);
  } catch {
    return false;
  }
}

// Build the deploy image. If the repo ships its own Dockerfile we honor it —
// the escape hatch for anything nixpacks can't build (bleeding-edge toolchains,
// non-Node stacks, custom needs). Otherwise nixpacks auto-detects the framework.
export async function buildImage(opts: {
  repoDir: string;
  image: string;
  onLog: LogFn;
}): Promise<void> {
  if (existsSync(path.join(opts.repoDir, "Dockerfile"))) {
    await opts.onLog(
      "stdout",
      "Dockerfile found in repo — building it directly (nixpacks skipped)\n",
    );
    await dockerBuild(opts);
  } else {
    await nixpacksBuild(opts);
  }
}

// docker build -t <image> <dir>  — used when the repo brings its own Dockerfile.
async function dockerBuild(opts: {
  repoDir: string;
  image: string;
  onLog: LogFn;
}): Promise<void> {
  const args = ["build", "-t", opts.image];
  if (BUILD_PLATFORM) args.push("--platform", BUILD_PLATFORM);
  args.push(opts.repoDir);
  const sp = execa("docker", args);
  sp.stdout?.on("data", (d) => void opts.onLog("stdout", d.toString()));
  sp.stderr?.on("data", (d) => void opts.onLog("stderr", d.toString()));
  await sp;
}

// nixpacks build <dir> --name <image>  — auto-detects the framework, streams output.
export async function nixpacksBuild(opts: {
  repoDir: string;
  image: string;
  onLog: LogFn;
}): Promise<void> {
  const pinned = repoPinsNode(opts.repoDir);
  const args = ["build", opts.repoDir, "--name", opts.image];
  if (!pinned) {
    await opts.onLog(
      "stdout",
      `no Node version pinned in repo — building with Node ${DEFAULT_NODE_VERSION} (override via BUILD_NODE_VERSION, or pin .nvmrc/engines)\n`,
    );
    // nixpacks only reads NIXPACKS_NODE_VERSION from build env passed via --env,
    // NOT from its own process environment. Repo pins win, so we only set a
    // default when the repo specifies none.
    args.push("--env", `NIXPACKS_NODE_VERSION=${DEFAULT_NODE_VERSION}`);
  }
  // nixpacks shells out to `docker build`; DOCKER_DEFAULT_PLATFORM steers it.
  const sp = execa("nixpacks", args, {
    env: BUILD_PLATFORM ? { DOCKER_DEFAULT_PLATFORM: BUILD_PLATFORM } : {},
  });
  sp.stdout?.on("data", (d) => void opts.onLog("stdout", d.toString()));
  sp.stderr?.on("data", (d) => void opts.onLog("stderr", d.toString()));
  await sp;
}

// docker run -d, inject env, map a loopback host port to the container's $PORT.
export async function dockerRun(opts: {
  image: string;
  name: string;
  hostPort: number;
  containerPort: number;
  env: Record<string, string>;
  onLog: LogFn;
}): Promise<string> {
  const args = [
    "run",
    "-d",
    // match the build arch when pinned, so an amd64 image runs as amd64
    ...(BUILD_PLATFORM ? ["--platform", BUILD_PLATFORM] : []),
    "--name",
    opts.name,
    "--restart",
    "unless-stopped",
    // bind to loopback only — Caddy is the sole public entry point
    "-p",
    `127.0.0.1:${opts.hostPort}:${opts.containerPort}`,
    ...dockerEnvFlags({ ...opts.env, PORT: String(opts.containerPort) }),
    opts.image,
  ];
  const { stdout } = await execa("docker", args);
  const containerId = stdout.trim();
  await opts.onLog(
    "stdout",
    `container ${containerId.slice(0, 12)} up on 127.0.0.1:${opts.hostPort} -> ${opts.containerPort}\n`,
  );
  return containerId;
}

export async function dockerStop(containerIdOrName: string): Promise<void> {
  await execa("docker", ["rm", "-f", containerIdOrName]).catch(() => {});
}
