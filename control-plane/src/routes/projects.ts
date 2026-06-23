import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db.js";
import { newId } from "../lib/ids.js";
import { resolveSha } from "../lib/github.js";
import { createDeployment, runDeployment } from "../lib/deploy.js";

const TENANT = process.env.TENANT_ID ?? "ten_operator";

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
}
