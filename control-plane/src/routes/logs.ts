import type { FastifyInstance, FastifyRequest } from "fastify";
import { getPool } from "../lib/db.js";

const TERMINAL = new Set(["running", "failed", "cancelled"]);
const POLL_MS = 600;
const HEARTBEAT_MS = 15_000;

// GET /logs/:deploymentId — Server-Sent Events stream of a deployment's build
// logs. Replays the persisted rows in order, then follows live (polling by seq)
// until the deployment reaches a terminal state. Honors Last-Event-ID (the row
// seq) so a dropped connection resumes instead of replaying from the top.
export async function logRoutes(app: FastifyInstance) {
  app.get("/:deploymentId", async (req: FastifyRequest, reply) => {
    const { deploymentId } = req.params as { deploymentId: string };
    const pool = getPool();

    const exists = await pool.query(
      "select 1 from deploy.deployments where id = $1",
      [deploymentId],
    );
    if (!exists.rows[0]) {
      return reply.code(404).send({ error: "deployment not found" });
    }

    // Take over the raw response for SSE.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // ask any proxy not to buffer
    });

    const lastId = req.headers["last-event-id"];
    let lastSeq = typeof lastId === "string" ? Number(lastId) : -1;
    if (!Number.isFinite(lastSeq)) lastSeq = -1;

    let closed = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const beat = setInterval(() => {
      if (!closed) res.write(": keep-alive\n\n");
    }, HEARTBEAT_MS);

    const stop = () => {
      if (closed) return;
      closed = true;
      clearInterval(beat);
      clearInterval(poll);
    };
    req.raw.on("close", stop);

    async function flushNewLines(): Promise<void> {
      const { rows } = await pool.query(
        "select seq, stream, line, ts from deploy.build_logs where deployment_id = $1 and seq > $2 order by seq",
        [deploymentId, lastSeq],
      );
      for (const l of rows) {
        if (closed) return;
        lastSeq = l.seq;
        res.write(`id: ${l.seq}\n`);
        res.write(
          `data: ${JSON.stringify({ seq: l.seq, stream: l.stream, line: l.line, ts: l.ts })}\n\n`,
        );
      }
    }

    async function tick(): Promise<void> {
      if (closed) return;
      try {
        await flushNewLines();
        const st = await pool.query(
          "select status from deploy.deployments where id = $1",
          [deploymentId],
        );
        const status: string | undefined = st.rows[0]?.status;
        if (status && TERMINAL.has(status)) {
          await flushNewLines(); // catch lines written just after the status flipped
          if (!closed) {
            res.write("event: done\n");
            res.write(`data: ${JSON.stringify({ status })}\n\n`);
          }
          stop();
          res.end();
        }
      } catch (err) {
        app.log.error(err, "sse log poll failed");
      }
    }

    poll = setInterval(tick, POLL_MS);
    await tick(); // immediate replay
  });
}
