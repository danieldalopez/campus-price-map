// Lakebase (Postgres) access for API routes. docs/SPEC.md section 5.
// Server only: import from route handlers (they run on Node.js; with cacheComponents, don't set `runtime`).
//
// One pool per role, created once per server instance and reused across requests. Lakebase scales to
// zero, so the first connection after a quiet spell can fail while it wakes: `query` retries once.

import { Pool, type QueryResultRow } from "pg";

export type DbRole = "reader" | "writer";

const ENV_VAR: Record<DbRole, string> = {
  reader: "DATABASE_URL_READER",
  writer: "DATABASE_URL_WRITER",
};

/** Thrown when the connection string for a role isn't configured. */
export class DbConfigError extends Error {}

// Survive hot reloads in `next dev` without opening a new pool on every edit.
const store = globalThis as typeof globalThis & { __cpmPools?: Partial<Record<DbRole, Pool>> };
const pools: Partial<Record<DbRole, Pool>> = (store.__cpmPools ??= {});

function pool(role: DbRole): Pool {
  const existing = pools[role];
  if (existing) return existing;

  const raw = process.env[ENV_VAR[role]];
  if (!raw) throw new DbConfigError(`${ENV_VAR[role]} is not set`);

  // TLS is always on and verified. sslmode is dropped from the URL so it can't override the setting below.
  const url = new URL(raw);
  url.searchParams.delete("sslmode");

  const created = new Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: 3,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  });
  // An idle connection dropped by the server (e.g. Lakebase scaling to zero) must not crash the process.
  created.on("error", () => {});
  pools[role] = created;
  return created;
}

const RETRYABLE_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND",
  "57P01", "57P03", "08000", "08001", "08003", "08006",
]);

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
  return /connection terminated|timeout exceeded when trying to connect/i.test(err.message);
}

/** Run one parameterised query as `role`, retrying once on a connection error. */
export async function query<T extends QueryResultRow>(
  role: DbRole,
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  try {
    return (await pool(role).query<T>(text, [...values])).rows;
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 750));
    return (await pool(role).query<T>(text, [...values])).rows;
  }
}
