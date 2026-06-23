#!/usr/bin/env bash
#
# setup-app-box.sh — provision a bare Ubuntu/Debian box into a lla.ma Apps
# "app box": the host that builds repos and runs deploy containers behind Caddy.
#
# Installs and hardens, idempotently (safe to re-run):
#   - swap        (small boxes OOM during Nixpacks/Docker builds without it)
#   - Docker CE   (runs deploy containers)
#   - Nixpacks    (repo -> OCI image)
#   - Caddy       (front door: auto-HTTPS + JSON admin API on loopback :2019)
#   - ufw         (only 22/80/443 inbound; 2019 stays loopback-only)
#   - deploy dirs + a (disabled) systemd unit template for the control plane
#
# Usage (run as root on the box):
#   sudo DEPLOY_DOMAIN=apps.example.com ADMIN_EMAIL=you@example.com bash setup-app-box.sh
#
# Required:
#   DEPLOY_DOMAIN   apex used for deploy hostnames (e.g. apps.example.com)
#   ADMIN_EMAIL     contact for Let's Encrypt / ACME
#
# Optional (override inline):
#   PG_HOST=127.0.0.1  PG_PORT=5432   where the control plane's Postgres lives
#   CONTROL_PLANE_PORT=8787  SWAP_SIZE=2G  DEPLOY_USER=ubuntu
#
set -euo pipefail

# ----------------------------------------------------------------------------
# Config (override via env)
# ----------------------------------------------------------------------------
DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-}"                       # e.g. apps.example.com
ADMIN_EMAIL="${ADMIN_EMAIL:-}"                           # ACME / Let's Encrypt contact
PG_HOST="${PG_HOST:-127.0.0.1}"                          # Postgres host for the control plane
PG_PORT="${PG_PORT:-5432}"
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-8787}"         # Fastify control plane (loopback)
SWAP_SIZE="${SWAP_SIZE:-2G}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
APP_HOME="/var/lib/llama-apps"
CADDY_JSON="/etc/caddy/caddy.json"

log()  { printf '\033[1;36m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m  %s\n' "$*" >&2; exit 1; }

# ----------------------------------------------------------------------------
# Preflight
# ----------------------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "run as root (use: sudo bash $0)"
command -v apt-get >/dev/null || die "this script targets Ubuntu/Debian (no apt-get found)"
[ -n "$DEPLOY_DOMAIN" ] || die "set DEPLOY_DOMAIN (e.g. DEPLOY_DOMAIN=apps.example.com)"
[ -n "$ADMIN_EMAIL" ]   || die "set ADMIN_EMAIL (ACME contact, e.g. ADMIN_EMAIL=you@example.com)"
. /etc/os-release 2>/dev/null || true
log "provisioning ${PRETTY_NAME:-unknown OS} as an app box for *.${DEPLOY_DOMAIN}"
export DEBIAN_FRONTEND=noninteractive

# ----------------------------------------------------------------------------
# Base packages
# ----------------------------------------------------------------------------
log "apt update + base packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg jq git ufw \
  debian-keyring debian-archive-keyring apt-transport-https

# ----------------------------------------------------------------------------
# Swap (critical on small boxes — Nixpacks/Docker builds are memory-hungry)
# ----------------------------------------------------------------------------
if swapon --show=NAME --noheadings | grep -q '/swapfile'; then
  log "swap already active"
else
  log "creating ${SWAP_SIZE} swapfile"
  fallocate -l "$SWAP_SIZE" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# Favor RAM, lean on swap only under pressure; cache pages aggressively for builds.
cat > /etc/sysctl.d/99-llama-apps.conf <<'EOF'
vm.swappiness=10
vm.vfs_cache_pressure=50
EOF
sysctl --system >/dev/null

# ----------------------------------------------------------------------------
# Docker CE (official repo)
# ----------------------------------------------------------------------------
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  log "docker already installed"
else
  log "installing Docker CE"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
# let the deploy user drive docker without sudo (control plane runs as this user)
usermod -aG docker "$DEPLOY_USER" 2>/dev/null || warn "could not add $DEPLOY_USER to docker group"

# ----------------------------------------------------------------------------
# Nixpacks (repo -> image)
# ----------------------------------------------------------------------------
if command -v nixpacks >/dev/null; then
  log "nixpacks already installed ($(nixpacks --version 2>/dev/null || echo '?'))"
else
  log "installing Nixpacks"
  curl -sSL https://nixpacks.com/install.sh | bash
fi

# ----------------------------------------------------------------------------
# Caddy (official repo)
# ----------------------------------------------------------------------------
if command -v caddy >/dev/null; then
  log "caddy already installed ($(caddy version 2>/dev/null | head -1))"
else
  log "installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# Base Caddy config: srv0 on :80/:443 with an empty routes[] the control plane
# appends to via the admin API; admin bound to loopback; on-demand TLS asks the
# control plane (so randoms can't trigger cert issuance for arbitrary hosts).
log "writing $CADDY_JSON"
mkdir -p /etc/caddy
cat > "$CADDY_JSON" <<EOF
{
  "admin": { "listen": "127.0.0.1:2019" },
  "apps": {
    "http": {
      "servers": {
        "srv0": {
          "listen": [":443", ":80"],
          "routes": [],
          "automatic_https": { "disable": false }
        }
      }
    },
    "tls": {
      "automation": {
        "policies": [
          { "issuers": [ { "module": "acme", "email": "${ADMIN_EMAIL}" } ] }
        ],
        "on_demand": {
          "ask": "http://127.0.0.1:${CONTROL_PLANE_PORT}/internal/caddy/ask"
        }
      }
    }
  }
}
EOF
caddy validate --config "$CADDY_JSON" || die "caddy config failed validation"

# Run Caddy from our JSON (not the default Caddyfile) so srv0/routes is canonical.
log "pinning Caddy systemd unit to $CADDY_JSON"
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/override.conf <<EOF
[Service]
ExecStart=
ExecStart=/usr/bin/caddy run --environ --config ${CADDY_JSON}
ExecReload=
ExecReload=/usr/bin/caddy reload --config ${CADDY_JSON} --force
EOF
systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy

# ----------------------------------------------------------------------------
# Firewall — only SSH + web in. Caddy admin (2019) is loopback, never exposed.
# ----------------------------------------------------------------------------
log "configuring ufw"
ufw allow OpenSSH        >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null
ufw allow 80/tcp         >/dev/null
ufw allow 443/tcp        >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable        >/dev/null

# ----------------------------------------------------------------------------
# Deploy dirs + control-plane scaffolding (unit stays disabled — no code yet)
# ----------------------------------------------------------------------------
log "creating deploy dirs under $APP_HOME"
mkdir -p "$APP_HOME"/builds "$APP_HOME"/repos /etc/llama-apps
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$APP_HOME"

cat > /etc/llama-apps/control-plane.env.sample <<EOF
# Fill in, then save as /etc/llama-apps/control-plane.env (chmod 600)
PORT=${CONTROL_PLANE_PORT}
HOST=127.0.0.1
NODE_ENV=production

# State backend = the 'deploy' schema in your Postgres (apply control-plane/schema.sql).
PG_HOST=${PG_HOST}
PG_PORT=${PG_PORT}
PG_DATABASE=llama
PG_SCHEMA=deploy
PG_USER=postgres
PG_PASSWORD=__SET_ME__

# Caddy admin (loopback only)
CADDY_ADMIN=http://127.0.0.1:2019

# Deploy topology
DEPLOY_DOMAIN=${DEPLOY_DOMAIN}
CONTAINER_PORT=3000
BUILD_DIR=${APP_HOME}/builds
REPO_DIR=${APP_HOME}/repos

# GitHub webhook HMAC secret (must match the secret set on the repo webhook)
GITHUB_WEBHOOK_SECRET=__SET_ME__

# Optional: auto-refresh deployment thumbnails when a deploy goes live.
# SHOT_HOOK_CMD=node /path/to/dashboard/scripts/capture-shots.mjs
EOF
chmod 640 /etc/llama-apps/control-plane.env.sample

cat > /etc/systemd/system/llama-control-plane.service <<EOF
[Unit]
Description=lla.ma Apps control plane (Fastify)
After=network-online.target docker.service caddy.service
Wants=network-online.target

[Service]
User=${DEPLOY_USER}
SupplementaryGroups=docker
WorkingDirectory=${APP_HOME}/control-plane
EnvironmentFile=/etc/llama-apps/control-plane.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
# intentionally NOT enabled/started: control-plane code is deployed separately.

# ----------------------------------------------------------------------------
# Verify
# ----------------------------------------------------------------------------
echo
log "================= verification ================="
printf '  docker   : '; docker --version 2>/dev/null || echo MISSING
printf '  nixpacks : '; nixpacks --version 2>/dev/null || echo MISSING
printf '  caddy    : '; caddy version 2>/dev/null | head -1 || echo MISSING
printf '  caddy svc: '; systemctl is-active caddy || true
printf '  swap     : '; swapon --show=NAME,SIZE --noheadings | tr '\n' ' '; echo

echo "  docker hello-world:"
if docker run --rm hello-world >/dev/null 2>&1; then echo "    OK"; else warn "    docker run failed (check network / daemon)"; fi

echo "  caddy admin API (loopback) srv0.routes:"
if curl -fsS "http://127.0.0.1:2019/config/apps/http/servers/srv0/routes" >/dev/null 2>&1; then
  echo "    OK — admin API reachable, srv0/routes exists"
else
  warn "    admin API not reachable on 127.0.0.1:2019"
fi

echo "  admin port binding (must be loopback only):"
ss -tlnH 'sport = :2019' 2>/dev/null | awk '{print "    "$4}' || warn "    ss unavailable"

cat <<EOF

[setup] done. Remaining (manual — need the box + DNS):
  1. Cloud/host firewall: open TCP 80 + 443 to this box (in addition to ufw above).
  2. DNS: point your deploy hostnames at this box's public IP — either a wildcard
     A record  *.${DEPLOY_DOMAIN}  (needs a DNS provider that supports it, plus a
     DNS-01 wildcard cert), or explicit per-app A records (<app>.${DEPLOY_DOMAIN}).
     Caddy issues a per-host cert via HTTP-01 on first hit.
  3. Postgres: make your DB reachable from this box (PG_HOST=${PG_HOST}), apply the
     schema once:  psql ... -f control-plane/schema.sql
  4. Deploy control-plane code to ${APP_HOME}/control-plane (build it: npm ci && npm
     run build so dist/ exists), then:
        cp /etc/llama-apps/control-plane.env.sample /etc/llama-apps/control-plane.env
        # edit secrets, chmod 600
        systemctl enable --now llama-control-plane

Milestone 1 smoke test (prove the scary infra bit) — run a throwaway container
and route it through Caddy, then hit it over HTTPS:
  docker run -d --name hello -p 8080:80 nginxdemos/hello
  curl -X POST http://127.0.0.1:2019/config/apps/http/servers/srv0/routes \\
    -H 'Content-Type: application/json' \\
    -d '{"match":[{"host":["test.${DEPLOY_DOMAIN}"]}],"handle":[{"handler":"reverse_proxy","upstreams":[{"dial":"127.0.0.1:8080"}]}]}'
  curl -sI https://test.${DEPLOY_DOMAIN}     # expect HTTP/2 200 with a valid cert
EOF
