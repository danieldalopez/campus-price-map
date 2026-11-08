// GET /api/health: prove the pipe from Vercel to Lakebase. docs/SPEC.md sections 8 and 13 (Step 3).
// { db: "ok", ms, locations: [5 names], pipeline: { computed_at, rows } | null }

import { connection } from "next/server";
import { DbConfigError, query } from "@/lib/db";

// No `export const runtime`: with cacheComponents on, Next 16 rejects it, and route handlers already run on
// Node.js (which `pg` needs). `connection()` marks this handler request-time, so it's never prerendered.

type PipelineStatus = { computed_at: string | null; rows: number } | null;

/** The Databricks synced table may not exist yet (rule 10): report null, never fail. */
async function pipelineStatus(): Promise<PipelineStatus> {
  try {
    const [found] = await query<{ exists: boolean }>(
      "reader",
      "select to_regclass('serving.price_comparisons') is not null as exists",
    );
    if (!found?.exists) return null;
    const [row] = await query<{ computed_at: Date | null; rows: string }>(
      "reader",
      "select max(computed_at) as computed_at, count(*) as rows from serving.price_comparisons",
    );
    return { computed_at: row?.computed_at ? row.computed_at.toISOString() : null, rows: Number(row?.rows ?? 0) };
  } catch {
    return null;
  }
}

export async function GET() {
  await connection();
  const started = Date.now();
  try {
    const rows = await query<{ name: string }>("reader", "select name from locations order by name limit 5");
    const pipeline = await pipelineStatus();
    return Response.json(
      { db: "ok", ms: Date.now() - started, locations: rows.map((r) => r.name), pipeline },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    // Log the kind of failure only: no connection strings, no stack with config in it.
    const kind = err instanceof DbConfigError ? err.message : err instanceof Error ? err.name : "unknown";
    console.error(`[health] database check failed: ${kind}`);
    return Response.json(
      { error: "The price database isn't reachable right now. Try again in a minute.", ms: Date.now() - started },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
