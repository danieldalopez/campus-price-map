// GET /api/prices?item=I01&lat=&lng=: one item at every outlet that sells it. docs/SPEC.md section 8.
// lat and lng are optional; the browser rounds them to 4 decimals and so does this route (G15). They are
// used for walk minutes and never stored or logged.

import { connection, type NextRequest } from "next/server";
import { loadItem } from "@/lib/catalog";
import { roundLatLng } from "@/lib/geo";
import { loadPrices } from "@/lib/prices";
import type { PricesResponse } from "@/lib/types";
import {
  badRequest,
  databaseError,
  deviceIdSchema,
  errorResponse,
  pricesQuerySchema,
  searchParamsObject,
} from "@/lib/validate";

// No `export const runtime` (cacheComponents is on). connection() keeps this request-time, never prerendered.

export async function GET(request: NextRequest) {
  await connection();
  const parsed = pricesQuerySchema.safeParse(searchParamsObject(request.nextUrl, ["item", "lat", "lng"]));
  if (!parsed.success) return badRequest(parsed.error);
  const { item: itemId, lat, lng } = parsed.data;
  const origin = lat !== undefined && lng !== undefined ? roundLatLng({ lat, lng }) : null;
  const deviceId = deviceIdSchema.parse(request.headers.get("x-device-id") ?? undefined);

  try {
    const item = await loadItem(itemId);
    if (!item) return errorResponse("We don't track that item yet.", 404);
    const body: PricesResponse = await loadPrices({ item, origin, deviceId });
    // Depends on the student's position and on live reports: never cached.
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return databaseError("prices", err);
  }
}
