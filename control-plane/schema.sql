-- lla.ma Apps — control-plane state schema (v0)
--
-- Apply once before first run:
--   psql "$DATABASE_URL" -f control-plane/schema.sql
-- (or:  psql -h $PG_HOST -p $PG_PORT -U $PG_USER -d $PG_DATABASE -f control-plane/schema.sql)
--
-- The control plane reads/writes everything in the `deploy` schema (it pins
-- search_path=deploy), so the tables live there — not in public. Single-tenant
-- now, multi-tenant-ready. IDs are generated app-side (nanoid) with Stripe-style
-- prefixes (proj_ / dpl_ / dom_ / ten_), so PKs are text, not uuid.

create schema if not exists deploy;
set search_path to deploy, public;

-- One row per tenant. For v0 there's exactly one — the operator (seeded below).
-- The control plane defaults TENANT_ID to 'ten_operator'.
create table if not exists tenants (
  id          text primary key,                 -- ten_xxx
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists projects (
  id                 text primary key,           -- proj_xxx
  tenant_id          text not null references tenants(id),
  name               text not null,
  repo_url           text not null,
  default_branch     text not null default 'main',
  framework          text,                        -- null = let Nixpacks detect
  production_domain  text,
  -- v0: plaintext jsonb is fine on your own box. Before SaaS, encrypt at rest
  -- (pgsodium / app-side AES) — env vars are the highest-value secret here.
  env                jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists deployments (
  id           text primary key,                 -- dpl_xxx
  project_id   text not null references projects(id) on delete cascade,
  tenant_id    text not null references tenants(id),
  git_sha      text not null,
  git_branch   text not null,
  status       text not null default 'queued',   -- queued|building|running|failed|cancelled
  container_id text,                             -- docker container id once running
  url          text,                             -- resolved deploy url
  error        text,                             -- short failure reason
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists deployments_project_created_idx
  on deployments (project_id, created_at desc);

create table if not exists domains (
  id          text primary key,                  -- dom_xxx
  project_id  text not null references projects(id) on delete cascade,
  tenant_id   text not null references tenants(id),
  hostname    text not null unique,
  is_primary  boolean not null default false,
  ssl_status  text not null default 'pending',   -- pending|active|failed
  created_at  timestamptz not null default now()
);

-- Append-only build/run output; streamed to the dashboard.
create table if not exists build_logs (
  id            bigint generated always as identity primary key,
  deployment_id text not null references deployments(id) on delete cascade,
  seq           int not null,                    -- ordering within a deployment
  stream        text not null default 'stdout',  -- stdout|stderr
  line          text not null,
  ts            timestamptz not null default now()
);
create index if not exists build_logs_deployment_seq_idx
  on build_logs (deployment_id, seq);

-- Seed the single v0 operator tenant (matches the control plane's default
-- TENANT_ID=ten_operator). Without this, the first project insert fails its FK.
insert into deploy.tenants (id, name)
values ('ten_operator', 'Operator')
on conflict (id) do nothing;

-- SaaS seam: going multi-tenant, enable RLS on every table above and gate by
--   tenant_id = current_setting('app.tenant_id', true)
-- Left off for v0 single-tenant.
