import type { PoolClient, QueryResultRow } from 'pg';

/** Anything that can run a parameterized query: the pool or a transaction client. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** The slice of the AppKit Lakebase plugin this app uses. */
export interface Lakebase extends Queryable {
  pool: { connect(): Promise<PoolClient> };
}

export type Tx = Queryable;

/** Run `fn` inside a transaction on a dedicated pooled connection. */
export async function withTransaction<T>(db: Lakebase, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** All app tables live in this schema, which the app's service principal owns. */
export const SCHEMA = 'cpm';
