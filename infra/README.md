# lla.ma Apps — infra

Provisions an **app box**: the host that builds your repos and runs deploy
containers behind Caddy with automatic HTTPS. Targets a bare Ubuntu/Debian server.

```
  internet ──▶ Caddy (TLS) ─▶ Docker containers
                    │ admin API 127.0.0.1:2019
                    ▼
              control plane (Fastify, loopback :8787) ──▶ Postgres (`deploy` schema)
```

## Files

| File | What |
|---|---|
| `setup-app-box.sh` | Idempotent bootstrap: swap, Docker, Nixpacks, Caddy (loopback admin), ufw, deploy dirs, a control-plane systemd template. Run as root on the box. |
| `caddy.base.json` | Reference copy of the base Caddy config the script writes to `/etc/caddy/caddy.json`. |

## Provision the box

Stand up a small Ubuntu/Debian server (2 GB RAM is enough; the script adds swap
for builds). Then, as root on the box:

```bash
sudo DEPLOY_DOMAIN=apps.example.com ADMIN_EMAIL=you@example.com bash setup-app-box.sh
```

`DEPLOY_DOMAIN` (the apex for deploy hostnames) and `ADMIN_EMAIL` (ACME contact)
are required. Override Postgres location and more inline, e.g.
`sudo DEPLOY_DOMAIN=apps.example.com ADMIN_EMAIL=you@example.com PG_HOST=10.0.0.5 bash setup-app-box.sh`.

## Manual steps the script can't do (need the box + DNS)

1. **Host/cloud firewall:** open TCP **80** and **443** to the box (in addition to
   the `ufw` rules the script sets). Easy to forget on cloud providers.
2. **DNS:** point your deploy hostnames at the box's public IP — either a wildcard
   `*.${DEPLOY_DOMAIN}` (needs a provider that supports it + a DNS-01 wildcard cert,
   used for preview-per-branch later) or explicit per-app A records
   (`<app>.${DEPLOY_DOMAIN}`). Caddy issues a per-host cert via HTTP-01 on first hit.
3. **Postgres reachability:** make your database reachable from the box, and apply
   the state schema once:
   ```bash
   psql -h $PG_HOST -p $PG_PORT -U $PG_USER -d $PG_DATABASE -f ../control-plane/schema.sql
   ```
4. **Deploy the control plane** to `/var/lib/llama-apps/control-plane` (build it so
   `dist/` exists: `npm ci && npm run build`), fill
   `/etc/llama-apps/control-plane.env` (from the `.sample` the script wrote), then
   `systemctl enable --now llama-control-plane`.

## Security notes (baked into the bootstrap)

- Caddy admin API binds **127.0.0.1:2019 only** — never public. Verified at the end
  of the script (`ss` on `:2019` must show loopback).
- ufw allows only 22/80/443 inbound; everything else denied.
- On-demand TLS issuance is gated by an **ask** endpoint on the control plane, so
  arbitrary hostnames can't trigger cert issuance.
- Docker socket = root-equivalent. Acceptable single-operator; revisit (rootless /
  sandboxed builds) only if this ever goes multi-tenant.
- Project env vars are secrets: injected at container runtime and scrubbed from
  build logs before they're persisted.

## Verify (Milestone 1 — prove the scary infra bit first)

After the bootstrap + DNS, hand-place one container and route it through Caddy:

```bash
docker run -d --name hello -p 8080:80 nginxdemos/hello
curl -X POST http://127.0.0.1:2019/config/apps/http/servers/srv0/routes \
  -H 'Content-Type: application/json' \
  -d '{"match":[{"host":["test.apps.example.com"]}],"handle":[{"handler":"reverse_proxy","upstreams":[{"dial":"127.0.0.1:8080"}]}]}'
curl -sI https://test.apps.example.com     # expect HTTP/2 200 with a valid Let's Encrypt cert
```

That confirms Caddy + container + auto-HTTPS end to end, before any control-plane code.
