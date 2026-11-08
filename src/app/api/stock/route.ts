// POST /api/stock: a student says an item is sold out at an outlet, or that it's back (docs/SPEC.md sections 6
// and 8, Step 9). In: { item_id, location_id, status: "sold_out" | "back", device_id }   Out: { stock, recorded }
//
// Insert only, as app_writer. The stock itself is computed by the live `stock_status` view: 1 student in the
// last 2 h is maybe_sold_out, 2+ different students in the last 4 h is sold_out, and a 'back' clears both.
// Reports that would change nothing aren't stored and return the current stock with recorded: false:
// a second sold_out from the same device since the last 'back' (the view counts students, not taps), and a
// 'back' when nobody said it was sold out. 10 inserts per device per minute across prices, votes and stock
// reports (G5).

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
  item_id: z.string({ error: "That isn't an item we track." }).regex(/^I\d{2}$/, "That isn't an item we track."),
  location_id: z
    .string({ error: "That outlet isn't on our map." })
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/, "That outlet isn't on our map."),
  status: z.enum(["sold_out", "back"], { error: "Say whether it's sold out or back." }),
  device_id: z
    .string({ error: "Reload the page and try again." })
    .regex(DEVICE_ID_PATTERN, "Reload the page and try again."),
});

type Checks = { item_ok: boolean; location_ok: boolean; stock: Stock | null; mine: boolean };

function logKind(err: unknown): string {
  if (err instanceof DbConfigError) return err.message;
  const code = (err as { code?: unknown } | null)?.code;
  const name = err instanceof Error ? err.name : "unknown";
  return typeof code === "string" ? `${name} (${code})` : name;
}

async function readStock(itemId: string, locationId: string): Promise<Stock> {
  const [row] = await query<{ stock: Stock }>(
    "reader",
    "select stock from stock_status where item_id = $1 and location_id = $2",
    [itemId, locationId],
  );
  return row?.stock ?? "in_stock";
}

function result(stock: Stock, recorded: boolean): Response {
  const body: StockResult = { stock, recorded };
  return Response.json(body, { status: recorded ? 201 : 200, headers: NO_STORE });
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
    const [recent, [checks]] = await Promise.all([
      recentInserts(deviceId),
      // `mine`: this device already said sold out since the last 'back', inside the view's 4 h window.
      query<Checks>(
        "reader",
        `select exists (select 1 from items where id = $1)     as item_ok,
                exists (select 1 from locations where id = $2) as location_ok,
                (select stock from stock_status where item_id = $1 and location_id = $2) as stock,
                exists (
                  select 1 from stock_reports s
                  where s.item_id = $1 and s.location_id = $2 and s.device_id = $3 and s.status = 'sold_out'
                    and s.reported_at > now() - interval '4 hours'
                    and s.reported_at > coalesce(
                      (select max(b.reported_at) from stock_reports b
                       where b.item_id = $1 and b.location_id = $2 and b.status = 'back'),
                      '-infinity'::timestamptz)
                ) as mine`,
        [itemId, locationId, deviceId],
      ),
    ]);
    if (!checks?.item_ok) return fail("That isn't an item we track.", 400);
    if (!checks.location_ok) return fail("That outlet isn't on our map.", 400);

    const before: Stock = checks.stock ?? "in_stock";
    if (status === "sold_out" && checks.mine) return result(before, false);
    if (status === "back" && before === "in_stock") return result(before, false);
    if (recent >= INSERTS_PER_MINUTE) {
      return fail("That's a lot of reports in a minute. Wait a moment and try again.", 429, { "retry-after": "60" });
    }

    await query("writer", "insert into stock_reports (item_id, location_id, status, device_id) values ($1, $2, $3, $4)", [
      itemId,
      locationId,
      status,
      deviceId,
    ]);

    // Saved. If reading the stock back fails, say what this report alone would make it.
    let after: Stock = status === "back" ? "in_stock" : before === "in_stock" ? "maybe_sold_out" : before;
    try {
      after = await readStock(itemId, locationId);
    } catch (err) {
      console.error(`[stock] status read failed: ${logKind(err)}`);
    }
    return result(after, true);
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === "23503") return fail("That item or outlet isn't on our map.", 400);
    console.error(`[stock] database step failed: ${logKind(err)}`);
    return fail("The price database isn't reachable right now. Try again in a minute.", 503);
  }
}
