import { Pool } from "pg";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// llama-apps owns a fixed `deploy` schema — its tables live there, never in
// `public`, so it coexists cleanly with anything else in the database. The name
// is intentionally NOT configurable: the queries qualify `deploy.*` and cloud
// uses the same schema, so keeping it fixed preserves OSS↔cloud parity.
const DEPLOY_SCHEMA = "deploy";

// Single pool to the operator's Postgres. State lives in the `deploy` schema of
// the configured DB (see schema.sql). search_path is pinned so all queries
// resolve there by default.
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.PG_HOST ?? "127.0.0.1",
      port: Number(process.env.PG_PORT ?? 5432),
      database: process.env.PG_DATABASE ?? "llama",
      user: process.env.PG_USER ?? "postgres",
      password: process.env.PG_PASSWORD,
      options: `-c search_path=${DEPLOY_SCHEMA},public`,
    });
  }
  return pool;
}

// Locate schema.sql whether we're running from src (tsx dev) or dist (built),
// or from the package root via cwd. First hit wins.
function findSchemaFile(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.cwd(), "schema.sql"),
    path.join(here, "schema.sql"),
    path.join(here, "..", "schema.sql"),
    path.join(here, "..", "..", "schema.sql"),
    path.join(here, "..", "..", "..", "schema.sql"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Apply the deploy-schema DDL on startup if it isn't there yet, so DB setup is
 * just "point PG_* at a Postgres" — no manual `psql -f schema.sql`. schema.sql is
 * idempotent (create ... if not exists; seed uses on conflict do nothing), so
 * this is safe; we still skip it when the tables already exist.
 */
export async function ensureSchema(): Promise<{ created: boolean }> {
  const { rows } = await getPool().query<{ t: string | null }>(
    "select to_regclass('deploy.projects')::text as t",
  );
  if (rows[0]?.t) return { created: false };

  const file = findSchemaFile();
  if (!file) {
    throw new Error("schema.sql not found next to the control plane");
  }
  await getPool().query(readFileSync(file, "utf8"));
  return { created: true };
}

export interface DbPing {
  ok: boolean;
  schema: string;
  now?: string;
  projects?: number;
  error?: string;
}

// Proves connectivity AND that we can read the deploy schema.
export async function pingDb(): Promise<DbPing> {
  const schema = DEPLOY_SCHEMA;
  try {
    const { rows } = await getPool().query<{
      now: string;
      schema: string;
      projects: string;
    }>(
      "select now()::text as now, current_schema() as schema, (select count(*) from deploy.projects)::text as projects",
    );
    return {
      ok: true,
      schema: rows[0].schema ?? schema,
      now: rows[0].now,
      projects: Number(rows[0].projects),
    };
  } catch (err) {
    return { ok: false, schema, error: (err as Error).message };
  }
}
