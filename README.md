<div align="center">

# lla.ma Apps

**The self-hosted, push-to-deploy app platform — your own Vercel, on your own box.**

Connect a GitHub repo, `git push`, and it clones → builds → containerizes → routes
with automatic HTTPS. Real containers, a real server, a flat cost you control. No
serverless metering, no per-request anxiety, no vendor lock-in.

</div>

---

## Why

Vercel is lovely until the bill is metered and your app lives on infrastructure you
can't see. lla.ma Apps gives you the same push-to-deploy ergonomics on a box **you**
own: one mental model — **project → deployment → container** — with auto-HTTPS in front.

- **Push to deploy** — a GitHub webhook (HMAC-verified) kicks off clone → [Nixpacks](https://nixpacks.com)
  build → `docker run` → [Caddy](https://caddyserver.com) route, fully automated.
- **Automatic HTTPS** — Caddy provisions and renews certificates per host.
- **Live deploy state** — a projects dashboard reads deployments straight from the
  orchestrator; build-log streaming is on the roadmap.
- **Your box, your rules** — flat cost, real containers you can `docker exec` into,
  Postgres you can browse (with [lla.ma base](https://github.com/tonyanglesey/llama-base)).

---

## Architecture

Two pieces. The **control plane** is the orchestrator — it holds the Docker socket,
Caddy's admin API, and project secrets, so it runs **private** (binds loopback). The
**dashboard** is a thin Next.js client of it.

```
   ┌────────┐  webhook (HMAC)   ┌──────────────────────┐
   │ GitHub │ ────────────────▶ │   Fastify control    │  nixpacks build
   └────────┘                   │   plane (loopback)   │  docker run
                                │                      │  caddy admin API
   ┌───────────┐   API + SSE    │                      │
   │ Dashboard │ ◀────────────▶ │                      │ ◀──▶ Postgres (`deploy` schema)
   │ (Next.js) │                └──────────┬───────────┘
   └───────────┘                           │ manages
                                           ▼
                       ┌─────────────────────────────────────┐
   internet ──▶ Caddy ─┤ container  container  container ...  │
                (TLS)  └─────────────────────────────────────┘
```

The browser never talks to the control plane directly — Server Components and the
same-origin `app/api/*` route handlers proxy to it, keeping the orchestrator private.

---

## Quick start

> **Schema:** the control plane stores state in the **`deploy` schema** of your
> Postgres — tables `projects` / `deployments` / `domains` / `build_logs`. Create
> that schema before first run. *(A ready-made schema file ships in a follow-up; for
> now create the tables to match the columns used in `control-plane/src/lib/*`.)*

### 1. Control plane (the orchestrator)

Needs Node, Docker, Nixpacks, and Caddy available on the host.

```bash
cd control-plane
pnpm install
cp .env.example .env        # set PG_PASSWORD and point PG_* at your Postgres
pnpm run dev                # http://127.0.0.1:8787
curl localhost:8787/health  # { status: "ok", db: { ok: true, ... } }
```

### 2. Dashboard

```bash
npm install
echo "CONTROL_PLANE_URL=http://127.0.0.1:8787" > .env.local
npm run dev                 # http://127.0.0.1:3000
```

Until the control plane is reachable the dashboard shows a "Can't reach the control
plane" panel — start it (step 1) and the projects grid lights up.

> **Run it privately.** This console can trigger deploys and reach secrets. It ships
> **ungated** — keep it on loopback, behind your own reverse proxy, or on a VPN. (The
> hosted edition adds an account gate; the OSS build deliberately has no phone-home.)

---

## Configuration

All config is environment variables. Dashboard:

| Variable | Default | Description |
|---|---|---|
| `CONTROL_PLANE_URL` | `http://127.0.0.1:8787` | Where the control plane is reachable |

Control plane — see [`control-plane/.env.example`](control-plane/.env.example):
`PG_*` (Postgres + `deploy` schema), `CADDY_ADMIN` (loopback admin API),
`DEPLOY_DOMAIN`, `CONTAINER_PORT`, `GITHUB_WEBHOOK_SECRET`.

---

## How it's built

| Layer | Choice |
|---|---|
| Control plane | Fastify (TypeScript/ESM, Node) — the orchestrator |
| Dashboard | Next.js + React + Tailwind v4 — a thin client of the control plane |
| Build | Nixpacks (repo → OCI image) |
| Runtime | Docker |
| Routing / TLS | Caddy (admin API, auto-HTTPS) |
| State | Postgres (`deploy` schema) |
| Git | GitHub webhooks (HMAC-verified) |

The shared [`@lla-ma/ui`](https://www.npmjs.com/package/@lla-ma/ui) design system
supplies the header/footer shell and theme tokens.

---

## Roadmap

- [x] Webhook (HMAC) → clone → Nixpacks build → Docker run → Caddy route
- [x] Projects dashboard + new project + deploy
- [ ] Live build-log streaming (SSE)
- [ ] GitHub webhook auto-registration (true zero-click push-to-deploy)
- [ ] Rollback (re-point Caddy to a prior container)
- [ ] Env-var management UI
- [ ] **The agent layer** — build-failure triage and conversational ops ("roll it
  back", "scale it") driving the same API. The real differentiator; later.

**lla.ma Apps is free and self-hostable forever.** A hosted edition (**LLA.MA&nbsp;PRO**)
will add the things that need a service you don't run — managed builds, team access,
and a single pane that fuses app hosting with the [lla.ma base](https://github.com/tonyanglesey/llama-base)
database console under one login. The platform you self-host stays complete on its own.

---

## License

Apache-2.0 — see [LICENSE](LICENSE).
