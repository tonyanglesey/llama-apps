import { Pool } from "pg";

// Single pool to the operator's Postgres. State lives in the `deploy` schema of
// the `llama` DB (see llama_deploy_v0_schema.sql). search_path is pinned so all
// queries resolve there by default.
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const schema = process.env.PG_SCHEMA ?? "deploy";
    pool = new Pool({
      host: process.env.PG_HOST ?? "127.0.0.1",
      port: Number(process.env.PG_PORT ?? 5432),
      database: process.env.PG_DATABASE ?? "llama",
      user: process.env.PG_USER ?? "postgres",
      password: process.env.PG_PASSWORD,
      options: `-c search_path=${schema},public`,
    });
  }
  return pool;
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
  const schema = process.env.PG_SCHEMA ?? "deploy";
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
