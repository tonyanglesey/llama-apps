import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db.js";
import { newId } from "../lib/ids.js";
import { resolveSha } from "../lib/github.js";
import { createDeployment, runDeployment } from "../lib/deploy.js";
import { dockerStop } from "../lib/builder.js";
import { removeRoute, caddyEnabled } from "../lib/caddy.js";

const TENANT = process.env.TENANT_ID ?? "ten_operator";
const DEPLOY_DOMAIN = process.env.DEPLOY_DOMAIN ?? "apps.example.com";

interface NewProject {
  name?: string;
  repo_url?: string;
  default_branch?: string;
  production_domain?: string;
  env?: Record<string, string>;
}

export async function projectRoutes(app: FastifyInstance) {
  // GET /projects — list
  app.get("/", async () => {
    const { rows } = await getPool().query(
      "select id, name, repo_url, default_branch, production_domain, created_at from deploy.projects order by created_at desc",
    );
    return { projects: rows };
  });

  // POST /projects — create (connect a repo).
  app.post("/", async (req, reply) => {
    const b = (req.body ?? {}) as NewProject;
    if (!b.name || !b.repo_url) {
      return reply.code(400).send({ error: "name and repo_url are required" });
    }
    const id = newId("proj");
    try {
      const { rows } = await getPool().query(
        `insert into deploy.projects (id, tenant_id, name, repo_url, default_branch, production_domain, env)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, name, repo_url, default_branch, production_domain, created_at`,
        [
          id,
          TENANT,
          b.name,
          b.repo_url,
          b.default_branch || "main",
          b.production_domain || null,
          JSON.stringify(b.env ?? {}),
        ],
      );
      return reply.code(201).send({ project: rows[0] });
    } catch (err) {
      // unique (tenant_id, name) or bad input
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  // GET /projects/:id — a project with its deployment history.
  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const pool = getPool();
    const { rows } = await pool.query(
      "select id, name, repo_url, default_branch, production_domain, env, created_at from deploy.projects where id = $1",
      [id],
    );
    if (!rows[0]) return reply.code(404).send({ error: "project not found" });
    const deps = await pool.query(
      "select id, project_id, status, git_branch, git_sha, url, error, created_at from deploy.deployments where project_id = $1 order by created_at desc limit 50",
      [id],
    );
    return { project: rows[0], deployments: deps.rows };
  });

  // POST /projects/:id/deploy { branch?, sha? } — trigger a deploy by hand.
  app.post("/:id/deploy", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { branch?: string; sha?: string };
    const { rows } = await getPool().query(
      "select repo_url, default_branch from deploy.projects where id = $1",
      [id],
    );
    if (!rows[0]) return reply.code(404).send({ error: "project not found" });
    const branch = body.branch ?? rows[0].default_branch ?? "main";
    const sha =
      body.sha ?? (await resolveSha(rows[0].repo_url, branch, process.env.GITHUB_TOKEN));
    const dplId = await createDeployment({ projectId: id, branch, sha });
    runDeployment(dplId).catch((e) => app.log.error(e, "deploy failed"));
    return reply.code(202).send({ deployment: dplId, branch, sha, status: "queued" });
  });

  // PATCH /:id — update mutable project settings. Partial: only the keys present
  // in the body are touched. `env` replaces the whole env map (the editor always
  // sends the full set). Env/domain changes take effect on the NEXT deploy —
  // containers receive env at `docker run`, so we don't touch the live one here.
  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as NewProject;

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (b.name !== undefined) {
      if (!b.name) return reply.code(400).send({ error: "name cannot be empty" });
      sets.push(`name = $${i++}`);
      vals.push(b.name);
    }
    if (b.default_branch !== undefined) {
      sets.push(`default_branch = $${i++}`);
      vals.push(b.default_branch || "main");
    }
    if (b.production_domain !== undefined) {
      sets.push(`production_domain = $${i++}`);
      vals.push(b.production_domain || null);
    }
    if (b.env !== undefined) {
      const env = b.env;
      if (typeof env !== "object" || env === null || Array.isArray(env)) {
        return reply.code(400).send({ error: "env must be an object" });
      }
      for (const [k, v] of Object.entries(env)) {
        if (typeof v !== "string") {
          return reply.code(400).send({ error: `env value for "${k}" must be a string` });
        }
      }
      sets.push(`env = $${i++}`);
      vals.push(JSON.stringify(env));
    }
    if (!sets.length) {
      return reply.code(400).send({ error: "no updatable fields provided" });
    }

    vals.push(id);
    try {
      const { rows } = await getPool().query(
        `update deploy.projects set ${sets.join(", ")} where id = $${i}
         returning id, name, repo_url, default_branch, production_domain, created_at`,
        vals,
      );
      if (!rows[0]) return reply.code(404).send({ error: "project not found" });
      return { project: rows[0] };
    } catch (err) {
      // unique (tenant_id, name) collision on rename, etc.
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  // DELETE /:id — remove a project and tear down everything it owns: running
  // containers, its public route, and (via FK cascade) its deployments,
  // build_logs and domains. Infra teardown is best-effort — a missing container
  // or unreachable Caddy must never block removing the project.
  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const pool = getPool();
    const { rows } = await pool.query(
      "select name, production_domain from deploy.projects where id = $1",
      [id],
    );
    if (!rows[0]) return reply.code(404).send({ error: "project not found" });
    const project = rows[0] as { name: string; production_domain: string | null };

    // Stop every container this project ever ran. Names are deterministic
    // (llama_<deploymentId>), so this catches deploys that never recorded a
    // container_id too; dockerStop is `docker rm -f` and swallows its own errors.
    const deps = await pool.query<{ id: string }>(
      "select id from deploy.deployments where project_id = $1",
      [id],
    );
    for (const d of deps.rows) await dockerStop(`llama_${d.id}`);

    // Drop the public route (mirrors how deploy.ts derived the hostname).
    if (caddyEnabled()) {
      const hostname =
        project.production_domain || `${project.name}.${DEPLOY_DOMAIN}`;
      await removeRoute(hostname).catch((e) =>
        app.log.warn(e, "caddy route removal failed during project delete"),
      );
    }

    // One delete — FK `on delete cascade` clears deployments -> build_logs,
    // plus domains.
    await pool.query("delete from deploy.projects where id = $1", [id]);
    return reply.code(200).send({ ok: true });
  });
}
