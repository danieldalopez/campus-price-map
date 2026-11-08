// POST /api/stock: "Sold out here?" and "It's back" (docs/SPEC.md sections 6 and 8, Step 9).
// In: { item_id, location_id, status: "sold_out" | "back", device_id }   Out: { stock }
//
// Insert only, as app_writer; the stock status is computed by the live `stock_status` view: SOLD OUT needs
// 2+ different students in the last 4 h, one report is only "may be sold out" for 2 h, and one "back"
// clears it. 10 inserts per device per minute across prices, votes and stock reports (G5).

import { connection } from "next/server";
import { z } from "zod";
import { DbConfigError, query } from "@/lib/db";
import { DEVICE_ID_PATTERN } from "@/lib/device";
import { INSERTS_PER_MINUTE, recentInserts } from "@/lib/limits";
import type { ApiError, Stock, StockResult } from "@/lib/types";

const NO_STORE = { "cache-control": "no-store" };

function fail(error: string, status: number, headers: Record<string, string> = {}): Response {
  const body: ApiError = { error };
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

const bodySchema = z.object({
  item_id: z.string({ error: "Pick the item first." }).regex(/^I\d{2}$/, "That isn't an item we track."),
  location_id: z
    .string({ error: "That outlet isn't on our map." })
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/, "That outlet isn't on our map."),
  status: z.enum(["sold_out", "back"], { error: "That report type isn't allowed." }),
  device_id: z
    .string({ error: "Reload the page and try again." })
    .regex(DEVICE_ID_PATTERN, "Reload the page and try again."),
});

function logKind(err: unknown): string {
  if (err instanceof DbConfigError) return err.message;
  const code = (err as { code?: unknown } | null)?.code;
  const name = err instanceof Error ? err.name : "unknown";
  return typeof code === "string" ? `${name} (${code})` : name;
}

export async function POST(request: Request) {
  await connection();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("That report didn't come through. Try again.", 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That report isn't valid.", 400);
  const { item_id: itemId, location_id: locationId, status, device_id: deviceId } = parsed.data;

  try {
    if ((await recentInserts(deviceId)) >= INSERTS_PER_MINUTE) {
      return fail("That's a lot of reports in a minute. Wait a moment and try again.", 429, { "retry-after": "60" });
    }
    await query("writer", "insert into stock_reports (item_id, location_id, status, device_id) values ($1, $2, $3, $4)", [
      itemId,
      locationId,
      status,
      deviceId,
    ]);
    const [row] = await query<{ stock: Stock }>(
      "reader",
      "select stock from stock_status where item_id = $1 and location_id = $2",
      [itemId, locationId],
    );
    const body: StockResult = { stock: row?.stock ?? "in_stock" };
    return Response.json(body, { status: 201, headers: NO_STORE });
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === "23503") return fail("That item or outlet isn't on our map.", 400);
    console.error(`[stock] database step failed: ${logKind(err)}`);
    return fail("The price database isn't reachable right now. Try again in a minute.", 503);
  }
}
