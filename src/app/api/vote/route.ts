// POST /api/vote: a student's Yes / No / Not sure on a pending price (docs/SPEC.md sections 6 and 8).
// In: { price_id, vote: "yes" | "no" | "unsure", device_id }   Out: { status, confirmations }
//
// Insert only, as app_writer; the price's status is computed by the live `price_status` view (section 6).
// You can't vote on your own report. A second vote from the same device changes nothing and returns the
// current status (unique (price_id, device_id)). 10 inserts per device per minute across prices, votes and
// stock reports (G5).

import { connection } from "next/server";
import { z } from "zod";
import { DbConfigError, query } from "@/lib/db";
import { DEVICE_ID_PATTERN } from "@/lib/device";
import { INSERTS_PER_MINUTE, recentInserts } from "@/lib/limits";
import type { PriceStatus } from "@/lib/snap";
import type { ApiError, VoteResult } from "@/lib/types";

const NO_STORE = { "cache-control": "no-store" };

function fail(error: string, status: number, headers: Record<string, string> = {}): Response {
  const body: ApiError = { error };
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

const bodySchema = z.object({
  price_id: z
    .number({ error: "That report isn't there anymore. Reload the page." })
    .int("That report isn't there anymore. Reload the page.")
    .positive("That report isn't there anymore. Reload the page."),
  vote: z.enum(["yes", "no", "unsure"], { error: "Pick Yes, No or Not sure." }),
  device_id: z
    .string({ error: "Reload the page and try again." })
    .regex(DEVICE_ID_PATTERN, "Reload the page and try again."),
});

type PriceRow = { device_id: string | null; status: PriceStatus; confirmations: string };

function logKind(err: unknown): string {
  if (err instanceof DbConfigError) return err.message;
  const code = (err as { code?: unknown } | null)?.code;
  const name = err instanceof Error ? err.name : "unknown";
  return typeof code === "string" ? `${name} (${code})` : name;
}

async function readStatus(priceId: number): Promise<PriceRow | null> {
  const [row] = await query<PriceRow>(
    "reader",
    "select device_id, status, confirmations from price_status where price_id = $1",
    [priceId],
  );
  return row ?? null;
}

function result(row: PriceRow, recorded: boolean): Response {
  const body: VoteResult = { status: row.status, confirmations: Number(row.confirmations), recorded };
  return Response.json(body, { status: recorded ? 201 : 200, headers: NO_STORE });
}

export async function POST(request: Request) {
  await connection();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("That vote didn't come through. Try again.", 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That vote isn't valid.", 400);
  const { price_id: priceId, vote, device_id: deviceId } = parsed.data;

  try {
    const [before, recent] = await Promise.all([readStatus(priceId), recentInserts(deviceId)]);
    if (!before) return fail("That report isn't there anymore. Reload the page.", 404);
    if (before.device_id === deviceId) return fail("You can't confirm your own price.", 403);
    // Only pending reports take votes; for anything else the answer is just where it stands now.
    if (before.status !== "pending") return result(before, false);
    if (recent >= INSERTS_PER_MINUTE) {
      return fail("That's a lot of votes in a minute. Wait a moment and try again.", 429, { "retry-after": "60" });
    }

    // A duplicate vote hits unique (price_id, device_id): not an error, just the current status (section 8).
    // Plain insert and catch 23505, because ON CONFLICT needs select on those columns and app_writer only
    // has select (id).
    let recorded = true;
    try {
      await query("writer", "insert into price_votes (price_id, device_id, vote) values ($1, $2, $3)", [
        priceId,
        deviceId,
        vote,
      ]);
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code !== "23505") throw err;
      recorded = false;
    }
    const after = (await readStatus(priceId)) ?? before;
    return result(after, recorded);
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === "23503") return fail("That report isn't there anymore. Reload the page.", 404);
    console.error(`[vote] database step failed: ${logKind(err)}`);
    return fail("The price database isn't reachable right now. Try again in a minute.", 503);
  }
}
