import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyGithubSignature, parsePushEvent } from "../lib/github.js";
import { getPool } from "../lib/db.js";
import { createDeployment, runDeployment } from "../lib/deploy.js";

// POST /webhook — GitHub push. HMAC-verified over the RAW body BEFORE acting.
export async function webhookRoutes(app: FastifyInstance) {
  app.post("/", async (req: FastifyRequest, reply) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
    const sig = req.headers["x-hub-signature-256"] as string | undefined;
    if (!raw || !verifyGithubSignature(raw, sig, secret)) {
      return reply.code(401).send({ error: "invalid signature" });
    }

    const event = req.headers["x-github-event"];
    if (event === "ping") return { ok: true, pong: true };
    if (event !== "push") return { ok: true, ignored: event };

    const push = parsePushEvent(req.body);
    if (!push) return reply.code(400).send({ error: "unparseable push payload" });

    // Match the push to a project by repo URL (with/without the .git suffix).
    const { rows } = await getPool().query(
      "select id, default_branch from deploy.projects where repo_url in ($1, $2) limit 1",
      [push.repoUrl, push.repoUrl.replace(/\.git$/, "")],
    );
    const project = rows[0];
    if (!project) {
      return reply.code(404).send({ error: "no project for repo", repo: push.repoUrl });
    }
    // v1: only deploy the project's default branch (production).
    if (push.branch !== project.default_branch) {
      return { ok: true, ignored: `branch ${push.branch}` };
    }

    const id = await createDeployment({
      projectId: project.id,
      branch: push.branch,
      sha: push.sha,
    });
    runDeployment(id).catch((e) => app.log.error(e, "deploy failed"));
    return reply.code(202).send({ deployment: id, status: "queued" });
  });
}
