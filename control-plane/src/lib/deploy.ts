import { execa } from "execa";
import { getPool } from "./db.js";
import { newId } from "./ids.js";
import { cloneAtSha, cleanupDir } from "./github.js";
import { nixpacksBuild, dockerRun } from "./builder.js";
import { addRoute, removeRoute } from "./caddy.js";
import { scrubSecrets } from "./secrets.js";

const CONTAINER_PORT = Number(process.env.CONTAINER_PORT ?? 3000);
const DEPLOY_DOMAIN = process.env.DEPLOY_DOMAIN ?? "apps.example.com";
const PORT = Number(process.env.PORT ?? 8787);

// Optional post-deploy hook: once a deployment is live, fire a configured command
// to refresh the project's dashboard thumbnail (e.g. the dashboard's
// `node scripts/capture-shots.mjs`). Opt-in via SHOT_HOOK_CMD — unset = no-op.
// Best-effort and fully detached: it must never block, fail, or slow a deploy.
function fireShotHook(projectId: string): void {
  const cmd = process.env.SHOT_HOOK_CMD;
  if (!cmd) return;
  execa(cmd, {
    shell: true,
    detached: true,
    stdio: "ignore",
    env: {
      // The capture script reads these — the project to shoot and where to
      // reach this control plane (loopback on the box).
      SHOT_PROJECT_ID: projectId,
      CONTROL_PLANE_URL:
        process.env.CONTROL_PLANE_URL ?? `http://127.0.0.1:${PORT}`,
    },
  }).catch(() => {
    /* thumbnail capture is cosmetic — swallow any failure */
  });
}

// Create a queued deployment row; returns its id.
export async function createDeployment(opts: {
  projectId: string;
  branch: string;
  sha: string;
}): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query(
    "select tenant_id from deploy.projects where id = $1",
    [opts.projectId],
  );
  if (!rows[0]) throw new Error(`project ${opts.projectId} not found`);
  const id = newId("dpl");
  await pool.query(
    `insert into deploy.deployments (id, project_id, tenant_id, git_sha, git_branch, status)
     values ($1, $2, $3, $4, $5, 'queued')`,
    [id, opts.projectId, rows[0].tenant_id, opts.sha, opts.branch],
  );
  return id;
}

// The spine: clone -> nixpacks build -> docker run -> Caddy route -> health -> running.
// Persists build_logs throughout and flips deployment status. Throws on failure
// (after recording status=failed + error).
export async function runDeployment(deploymentId: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select d.git_sha, d.git_branch, p.id as project_id, p.name, p.repo_url,
            p.production_domain, p.env
       from deploy.deployments d
       join deploy.projects p on p.id = d.project_id
      where d.id = $1`,
    [deploymentId],
  );
  if (!rows[0]) throw new Error(`deployment ${deploymentId} not found`);
  const dep = rows[0];
  const env: Record<string, string> = dep.env ?? {};
  const secretValues = Object.values(env);

  let seq = 0;
  const log = async (stream: "stdout" | "stderr", chunk: string): Promise<void> => {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line) continue;
      await pool.query(
        "insert into deploy.build_logs (deployment_id, seq, stream, line) values ($1, $2, $3, $4)",
        [deploymentId, seq++, stream, scrubSecrets(line, secretValues)],
      );
    }
  };

  const image = `llama-apps/${dep.project_id}:${deploymentId}`;
  const containerName = `llama_${deploymentId}`;
  const hostname: string =
    dep.production_domain || `${dep.name}.${DEPLOY_DOMAIN}`;
  let buildDir: string | undefined;

  try {
    await pool.query(
      "update deploy.deployments set status = 'building', started_at = now() where id = $1",
      [deploymentId],
    );

    await log("stdout", `cloning ${dep.repo_url} @ ${dep.git_sha}\n`);
    buildDir = await cloneAtSha({
      repoUrl: dep.repo_url,
      sha: dep.git_sha,
      token: process.env.GITHUB_TOKEN,
    });

    await log("stdout", `building ${image} with nixpacks\n`);
    await nixpacksBuild({ repoDir: buildDir, image, onLog: log });

    const hostPort = 30000 + Math.floor(Math.random() * 5000);
    await log("stdout", "starting container\n");
    const containerId = await dockerRun({
      image,
      name: containerName,
      hostPort,
      containerPort: CONTAINER_PORT,
      env,
      onLog: log,
    });

    await log("stdout", `routing ${hostname} -> 127.0.0.1:${hostPort}\n`);
    await removeRoute(hostname);
    await addRoute({ hostname, upstreamPort: hostPort });

    await log("stdout", "health-checking container\n");
    if (!(await healthCheck(hostPort))) {
      throw new Error("health check failed — container not responding");
    }

    const url = `https://${hostname}`;
    await pool.query(
      `update deploy.deployments
          set status = 'running', container_id = $2, url = $3, finished_at = now()
        where id = $1`,
      [deploymentId, containerId, url],
    );
    await log("stdout", `live at ${url}\n`);

    // Refresh the dashboard thumbnail for this project (best-effort, detached).
    fireShotHook(dep.project_id);
  } catch (err) {
    const msg = (err as Error).message;
    await log("stderr", `deploy failed: ${msg}\n`).catch(() => {});
    await pool
      .query(
        "update deploy.deployments set status = 'failed', error = $2, finished_at = now() where id = $1",
        [deploymentId, msg],
      )
      .catch(() => {});
    throw err;
  } finally {
    if (buildDir) await cleanupDir(buildDir).catch(() => {});
  }
}

async function healthCheck(port: number, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
