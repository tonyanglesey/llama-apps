import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db.js";

// Deployments — list, get, rollback.
export async function deploymentRoutes(app: FastifyInstance) {
  // GET /deployments — recent across all projects.
  app.get("/", async () => {
    const { rows } = await getPool().query(
      "select id, project_id, status, git_branch, git_sha, url, created_at from deploy.deployments order by created_at desc limit 50",
    );
    return { deployments: rows };
  });

  // GET /deployments/:id — one deployment joined with its project.
  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await getPool().query(
      `select d.id, d.project_id, d.status, d.git_branch, d.git_sha, d.url, d.error,
              d.container_id, d.started_at, d.finished_at, d.created_at,
              p.name as project_name, p.repo_url, p.production_domain
         from deploy.deployments d
         join deploy.projects p on p.id = d.project_id
        where d.id = $1`,
      [id],
    );
    if (!rows[0]) return reply.code(404).send({ error: "deployment not found" });
    return { deployment: rows[0] };
  });

  // POST /deployments/:id/rollback — TODO(milestone 6): re-point Caddy to a prior container.
  app.post("/:id/rollback", async (_req, reply) =>
    reply.code(501).send({ status: "stub", route: "deployments.rollback", todo: "milestone-6" }),
  );
}
