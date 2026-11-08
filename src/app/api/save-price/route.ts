// POST /api/save-price: a student's price report (docs/SPEC.md section 8). Insert only, as app_writer.
// In: { item_id, location_id, price, source: "photo" | "receipt" | "typed", device_id }   Out: { id, status }
// "receipt" is "I bought it" with a receipt photo (Step 8); "typed" is a price the student typed or fixed.
//
// $0.25 to $25 only; `needs_review` when the price is over 3x the item's campus median (G3), which then
// needs 2 confirmations to go official. 10 inserts per device per minute across prices, votes and stock
// reports (G5). The status comes from the live `price_status` view.

import { connection } from "next/server";
import { z } from "zod";
import { DbConfigError, query } from "@/lib/db";
import { DEVICE_ID_PATTERN } from "@/lib/device";
import { INSERTS_PER_MINUTE, recentInserts } from "@/lib/limits";
import { PRICE_MAX, PRICE_MIN, roundToCents, type ApiError, type PriceStatus, type SaveResult } from "@/lib/snap";

const NO_STORE = { "cache-control": "no-store" };
const RANGE = `Prices must be between $${PRICE_MIN.toFixed(2)} and $${PRICE_MAX}.`;

function fail(error: string, status: number, headers: Record<string, string> = {}): Response {
  const body: ApiError = { error };
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

const bodySchema = z.object({
  item_id: z.string({ error: "Pick the item first." }).regex(/^I\d{2}$/, "That isn't an item we track."),
  location_id: z
    .string({ error: "Pick the outlet you're at." })
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/, "Pick the outlet you're at."),
  // Rounded to cents before the range check, so 3.249 is saved as 3.25.
  price: z
    .number({ error: "Type the price, like 3.25." })
    .transform(roundToCents)
    .pipe(z.number().min(PRICE_MIN, RANGE).max(PRICE_MAX, RANGE)),
  source: z.enum(["photo", "receipt", "typed"], { error: "That report type isn't allowed." }),
  device_id: z
    .string({ error: "Reload the page and try again." })
    .regex(DEVICE_ID_PATTERN, "Reload the page and try again."),
});

type Checks = { item_ok: boolean; location_ok: boolean; campus_median: string | null };

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
  const { item_id: itemId, location_id: locationId, price, source, device_id: deviceId } = parsed.data;

  let id: number;
  try {
    const [recent, [checks]] = await Promise.all([
      recentInserts(deviceId),
      query<Checks>(
        "reader",
        `select exists (select 1 from items where id = $1)     as item_ok,
                exists (select 1 from locations where id = $2) as location_ok,
                (select campus_median from item_medians where item_id = $1) as campus_median`,
        [itemId, locationId],
      ),
    ]);
    if (recent >= INSERTS_PER_MINUTE) {
      return fail("That's a lot of reports in a minute. Wait a moment and try again.", 429, { "retry-after": "60" });
    }
    if (!checks?.item_ok) return fail("That isn't an item we track.", 400);
    if (!checks.location_ok) return fail("That outlet isn't on our map. Pick it from the list.", 400);

    const median = checks.campus_median === null ? null : Number(checks.campus_median);
    const needsReview = median !== null && Number.isFinite(median) && price > 3 * median;

    const [row] = await query<{ id: string }>(
      "writer",
      `insert into prices (item_id, location_id, price, source, device_id, needs_review)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [itemId, locationId, price.toFixed(2), source, deviceId, needsReview],
    );
    if (!row) throw new Error("insert returned no id");
    id = Number(row.id);
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === "23503") return fail("That item or outlet isn't on our map.", 400);
    if (code === "23514") return fail(RANGE, 400);
    console.error(`[save-price] database step failed: ${logKind(err)}`);
    return fail("The price database isn't reachable right now. Try again in a minute.", 503);
  }

  // The row is saved. If reading its status fails, a new student report is pending unless another student
  // already reported the same price, so say pending rather than turn a saved report into an error.
  let status: PriceStatus = "pending";
  try {
    const [row] = await query<{ status: PriceStatus }>("reader", "select status from price_status where price_id = $1", [id]);
    if (row) status = row.status;
  } catch (err) {
    console.error(`[save-price] status read failed: ${logKind(err)}`);
  }

  const body: SaveResult = { id, status };
  return Response.json(body, { status: 201, headers: NO_STORE });
}
