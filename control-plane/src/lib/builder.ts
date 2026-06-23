import { execa } from "execa";
import { dockerEnvFlags } from "./secrets.js";

export type LogFn = (stream: "stdout" | "stderr", chunk: string) => void | Promise<void>;

// nixpacks build <dir> --name <image>  — auto-detects the framework, streams output.
export async function nixpacksBuild(opts: {
  repoDir: string;
  image: string;
  onLog: LogFn;
}): Promise<void> {
  const sp = execa("nixpacks", ["build", opts.repoDir, "--name", opts.image]);
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
