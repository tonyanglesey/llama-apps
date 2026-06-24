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

## Where it runs

The control plane builds and runs your apps as Docker containers — so **Docker (and
nixpacks) must be installed wherever the control plane runs.** That one choice decides
how much sits on your laptop and what your deploy URLs look like:

| Topology | Control plane + Docker on… | Your laptop runs | Deploy URLs |
|---|---|---|---|
| **All-local** | your laptop | everything | `http://127.0.0.1:<port>` |
| **Your own box** | a server you own | just the dashboard (`CONTROL_PLANE_URL` → the box) | `https://<app>.<your-domain>` |
| **Cloud** (paid) | lla.ma's servers | just sign in | managed `https://<app>.<domain>` |

**All-local** is the zero-infrastructure way to try it — the trade is Docker on your
machine and localhost URLs. Point the dashboard at a **box you own** instead and your
laptop needs no Docker; add Caddy + a wildcard DNS record and you get real
`https://<app>.<your-domain>` deploys ([Going public](#going-public-optional)). The
**cloud** tier is the same dashboard with lla.ma running the box, Docker, TLS and DNS
for you. It's open-core: you can always self-host the whole thing for free.

---

## Quick start (local)

Run the whole stack on your machine — dashboard + control plane + Docker — with one
command. Nothing is hosted by lla.ma: every server is yours, configured in `.env`.

**Prerequisites**

- **Node** 20+
- **Docker** running — builds run as real containers on this machine
- **[Nixpacks](https://nixpacks.com)** (`brew install nixpacks`) — turns a repo into an image
- A **Postgres** you control (local or remote) — the control plane stores state here

**1. Point the control plane at your database.** It's the *only* part that uses Postgres:

```bash
cd control-plane && npm install
cp .env.example .env      # set PG_* (host / port / db / user / password)
cd ..
```

The `deploy` schema (tables `projects` / `deployments` / `domains` / `build_logs` +
a seeded operator tenant) is **created automatically on first run** — no manual
`psql` step.

**2. Point the dashboard at the control plane.** The default is correct for local:

```bash
npm install
cp .env.example .env      # CONTROL_PLANE_URL=http://127.0.0.1:8787 (default)
```

> **Two `.env` files, on purpose.** The dashboard's `.env` only holds
> `CONTROL_PLANE_URL`. Your **database** goes in **`control-plane/.env`** (`PG_*`) —
> the dashboard never touches Postgres.

**3. Run both together:**

```bash
npm run dev               # control plane (:8787) + dashboard (:3000), one process
```

Open <http://localhost:3000>. With no Caddy configured, deploys run as local
containers reachable at `http://127.0.0.1:<port>` — no public domain or TLS needed.
Run just one side with `npm run dev:web` (dashboard) or `npm run dev` inside
`control-plane/`.

> **Run it privately.** This console can trigger deploys and reach secrets. It ships
> **ungated** — keep it on loopback, behind your own reverse proxy, or on a VPN. (The
> hosted edition adds an account gate; the OSS build deliberately has no phone-home.)

## Going public (optional)

Local mode serves deploys at `http://127.0.0.1:<port>`. To serve real
`https://<app>.<domain>`, run **[Caddy](https://caddyserver.com)** and set
`CADDY_ADMIN` + `DEPLOY_DOMAIN` in `control-plane/.env` — the control plane then
registers each host and Caddy provisions TLS automatically.

To stand up a server end to end, [`infra/setup-app-box.sh`](infra/setup-app-box.sh)
bootstraps a bare Ubuntu/Debian host — swap, Docker, Nixpacks, Caddy (loopback admin
+ auto-HTTPS), a firewall, and a control-plane systemd unit:

```bash
sudo DEPLOY_DOMAIN=apps.example.com ADMIN_EMAIL=you@example.com bash infra/setup-app-box.sh
```

Drop in the control-plane code and start the service (the schema self-applies on
boot). Full walkthrough + the manual DNS/firewall steps: [`infra/README.md`](infra/README.md).

---

## Configuration

All config is environment variables. Dashboard:

| Variable | Default | Description |
|---|---|---|
| `CONTROL_PLANE_URL` | `http://127.0.0.1:8787` | Where the control plane is reachable |

Control plane — see [`control-plane/.env.example`](control-plane/.env.example):

| Variable | Required | Description |
|---|---|---|
| `PG_*` | **yes** | Postgres connection (state lives in the `deploy` schema) |
| `CONTAINER_PORT` | yes | Port your apps listen on inside the container |
| `CADDY_ADMIN` | no | Caddy admin API. **Unset = local mode** (`http://127.0.0.1:<port>` URLs, no public TLS) |
| `DEPLOY_DOMAIN` | no | Apex for public hostnames; only used with `CADDY_ADMIN` |
| `GITHUB_WEBHOOK_SECRET` / `GITHUB_TOKEN` | no | Push-to-deploy webhooks and private repos |
| `SHOT_HOOK_CMD` | no | Auto-refresh deployment thumbnails (see below) |

---

## Deployment thumbnails

The projects grid shows a preview image per project (the "Vercel preview" look).
These are captured by screenshotting each project's live deployment:

```bash
npm run shots                                    # capture all running deployments
npm run shots -- --project proj_xxx              # capture just one
```

It reads the project → URL map from the control plane (`CONTROL_PLANE_URL`),
screenshots each `running` deployment over HTTPS, and writes
`public/shots/<projectId>.jpg` (gitignored — they're generated artifacts).
Projects whose latest deploy `failed`, or that have no public `https://` URL, are
skipped. The dashboard falls back to a "no preview yet" placeholder until a shot
exists.

**Auto-refresh on deploy:** set `SHOT_HOOK_CMD` on the control plane to the capture
command, and it runs (detached, best-effort) whenever a deployment goes live, so the
thumbnail for that project refreshes automatically:

```bash
# in the control plane's environment
SHOT_HOOK_CMD=node /path/to/dashboard/scripts/capture-shots.mjs
```

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

### Repo layout — two apps, one repo

This repo is a small monorepo holding **two separate applications** plus the box
provisioning kit:

```
llama-apps/
  app/  lib/  scripts/   the DASHBOARD  — Next.js, browser-facing (the only public surface)
  control-plane/         the CONTROL PLANE — Fastify orchestrator, its own package + process
  infra/                 setup-app-box.sh + Caddy config — provisions a box to run both
```

The **control plane is its own app**, not a module of the dashboard. It has its own
`control-plane/package.json`, its own dependencies, its own `tsc` build (`dist/`),
its own `.env`, and it runs as its **own process/service** (the
`llama-control-plane` systemd unit) bound to loopback `:8787`. The dashboard's root
`tsconfig.json` even excludes it so each builds independently.

**Why split them.** The control plane holds the Docker socket, Caddy's admin API,
and project secrets — root-equivalent power — so it must run **private**. The
dashboard is the only piece meant to face a browser. They never share a process:

```
browser ──▶ dashboard (Next.js)  ──HTTP──▶  control plane (Fastify, loopback :8787)
            app/api/* proxies              docker · nixpacks · caddy admin · Postgres
```

The dashboard (and its `app/api/*` route handlers) reach the control plane at
`CONTROL_PLANE_URL`; the browser never touches the control plane directly.

**Deploying them** (see [`infra/`](infra/)): both ship from this one repo, but land
as two things on the box — the control-plane folder built and run as the
`llama-control-plane` service (private), and the dashboard run/served separately as
the browser-facing surface. Same single repo, two independently-running apps.

> They live together for convenience (one clone, one version), but nothing stops
> them being split into separate repos later — they only ever talk over HTTP.

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
