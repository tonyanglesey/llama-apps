# llama-apps control plane (Fastify)

The orchestrator: GitHub webhook → clone → Nixpacks build → `docker run` → Caddy route.
It holds the Docker socket, Caddy's admin API, and project secrets, so it runs
**private** (binds loopback) and separate from the browser-facing dashboard.

## Dev

```bash
pnpm install
cp .env.example .env        # set PG_PASSWORD (and point PG_* at your Postgres)
pnpm run dev
curl localhost:8787/health     # { status, db: { ok: true, projects: 0, ... } }
curl localhost:8787/projects   # reads the deploy schema -> { projects: [] }
```

State lives in the **`deploy` schema** of your Postgres (tables
`projects` / `deployments` / `domains` / `build_logs`). Create that schema before
first run — see the project README's note on the schema.

## Routes

| Route | Purpose |
|---|---|
| `GET /health` | liveness + DB reachability |
| `GET /projects` · `POST /projects` | project CRUD |
| `GET /deployments` · `GET /:id` · `POST /:id/rollback` | deployments |
| `POST /webhook` | GitHub push (HMAC-verified) → enqueue deploy |
| `GET /logs/:deploymentId` | SSE build-log stream |

## Prod

`pnpm build` → `node dist/server.js`. Run it behind a process manager (systemd,
pm2, …) as a service that:

- binds **loopback only** (`HOST=127.0.0.1`) — never expose it publicly,
- has access to the **Docker socket** (it shells out to `docker`),
- can reach **Caddy's admin API** on `127.0.0.1:2019`,
- connects to Postgres with `PG_SCHEMA=deploy`.

All configuration is environment-driven — see [`.env.example`](.env.example).
