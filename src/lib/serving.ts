// The Databricks synced tables in the `serving` schema are optional at runtime (docs/SPEC.md rule 10):
// they may not exist, app_reader may not have been granted them yet, or they may be stale. Every check here
// answers "no" instead of throwing. Server only.

import { query } from "./db";

/** True if `serving.<table>` exists and app_reader can read it. */
export async function servingTableReadable(table: "price_comparisons" | "outlet_scores"): Promise<boolean> {
  try {
    const [row] = await query<{ ok: boolean }>(
      "reader",
      // has_table_privilege needs the table to exist, so check that first (to_regclass returns null).
      `select case when to_regclass($1) is null then false
                   else has_table_privilege(to_regclass($1), 'select') end as ok`,
      [`serving.${table}`],
    );
    return row?.ok === true;
  } catch {
    // e.g. "permission denied for schema serving" before 04_grants has run.
    return false;
  }
}

/** Pipeline output older than this is stale: fall back to the live views (section 8). */
export const PIPELINE_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export type PriceSourceChoice =
  | { use: "pipeline"; computedAt: string }
  | { use: "live"; reason: string };

const loggedReasons = new Set<string>();

/** Log why live mode was chosen, once per reason per cold start. */
function logOnce(reason: string) {
  if (loggedReasons.has(reason)) return;
  loggedReasons.add(reason);
  console.info(`[prices] using live prices: ${reason}`);
}

/**
 * Section 8: pipeline prices only when PRICE_SOURCE=pipeline, serving.price_comparisons exists and is
 * readable, and its newest computed_at is under 3 h old. Otherwise live.
 */
export async function choosePriceSource(): Promise<PriceSourceChoice> {
  const live = (reason: string): PriceSourceChoice => {
    logOnce(reason);
    return { use: "live", reason };
  };

  if ((process.env.PRICE_SOURCE ?? "live").trim().toLowerCase() !== "pipeline") {
    return live("PRICE_SOURCE is not 'pipeline'");
  }
  if (!(await servingTableReadable("price_comparisons"))) {
    return live("serving.price_comparisons is missing or not readable");
  }
  try {
    const [row] = await query<{ computed_at: Date | null }>(
      "reader",
      "select max(computed_at) as computed_at from serving.price_comparisons",
    );
    const at = row?.computed_at ?? null;
    if (!at) return live("serving.price_comparisons is empty");
    const age = Date.now() - at.getTime();
    if (age >= PIPELINE_MAX_AGE_MS) {
      return live(`serving.price_comparisons is stale (computed ${Math.round(age / 60_000)} min ago)`);
    }
    return { use: "pipeline", computedAt: at.toISOString() };
  } catch {
    return live("serving.price_comparisons could not be read");
  }
}
