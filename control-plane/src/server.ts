import "dotenv/config";
import Fastify from "fastify";
import { getPool, pingDb } from "./lib/db.js";
import { webhookRoutes } from "./routes/webhook.js";
import { projectRoutes } from "./routes/projects.js";
import { deploymentRoutes } from "./routes/deployments.js";
import { logRoutes } from "./routes/logs.js";

const PORT = Number(process.env.PORT ?? 8787);
// Private by design: the orchestrator holds the Docker socket, Caddy admin, and
// secrets. Bind loopback; the dashboard/Caddy reach it locally on the box.
const HOST = process.env.HOST ?? "127.0.0.1";

const app = Fastify({ logger: true });

// Keep the RAW body around (as req.rawBody) so the webhook can verify GitHub's
// HMAC over the exact bytes — Fastify discards them after JSON parsing otherwise.
app.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (req, body, done) => {
    (req as unknown as { rawBody?: Buffer }).rawBody = body as Buffer;
    try {
      const buf = body as Buffer;
      done(null, buf.length ? JSON.parse(buf.toString("utf8")) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  },
);

// Liveness + DB reachability (can we read the `deploy` schema?).
app.get("/health", async () => ({
  status: "ok",
  service: "llama-apps-control-plane",
  db: await pingDb(),
}));

await app.register(webhookRoutes, { prefix: "/webhook" });
await app.register(projectRoutes, { prefix: "/projects" });
await app.register(deploymentRoutes, { prefix: "/deployments" });
await app.register(logRoutes, { prefix: "/logs" });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    app.log.info(`${sig} received — shutting down`);
    await app.close();
    await getPool().end();
    process.exit(0);
  });
}

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
