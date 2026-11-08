// Test replacement for src/lib/db.ts (swapped in by register.ts). Same exports, but it connects to the local
// throwaway Postgres from pg.ts as app_reader / app_writer, without TLS. The real roles and grants from
// db/roles.sql apply, so a route that reads with the writer role fails here just as it would on Lakebase.
import pg from "pg";

export type DbRole = "reader" | "writer";

export class DbConfigError extends Error {}

const ENV_VAR: Record<DbRole, string> = { reader: "TEST_DATABASE_URL_READER", writer: "TEST_DATABASE_URL_WRITER" };
const pools: Partial<Record<DbRole, pg.Pool>> = {};
let down = false;

/** Make every query fail like an unreachable database (tests the routes' 503 path). */
export function setDatabaseDown(value: boolean) {
  down = value;
}

export async function query<T extends pg.QueryResultRow>(
  role: DbRole,
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  if (down) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  const url = process.env[ENV_VAR[role]];
  if (!url) throw new DbConfigError(`${ENV_VAR[role]} is not set`);
  pools[role] ??= new pg.Pool({ connectionString: url, max: 3 });
  return (await pools[role].query<T>(text, [...values])).rows;
}

export async function closePools() {
  await Promise.all(Object.values(pools).map((p) => p?.end()));
  for (const k of Object.keys(pools) as DbRole[]) delete pools[k];
}
