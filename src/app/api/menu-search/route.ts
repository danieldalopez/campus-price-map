// GET /api/menu-search?q=ramen&lat=&lng=: every menu line on campus that matches, tracked or not.
// docs/SPEC.md section 7 ("Search"). Matching is src/lib/search.ts (searchMenu), over the campus menu kept in
// memory by src/lib/menu.ts. lat and lng are optional, rounded to 4 decimals, used for walk minutes only and
// never stored or logged.
//
// Menu lines are listed, never compared: rank, bands, chips and Worth the walk stay on the 23 tracked items,
// which are the same product everywhere.

import { connection, type NextRequest } from "next/server";
import { roundLatLng, walkMinutes } from "@/lib/geo";
import { loadCampusMenu } from "@/lib/menu";
import { isApproximate } from "@/lib/outlet";
import { groupByItemName, searchMenu } from "@/lib/search";
import type { MenuHit, MenuSearchResponse } from "@/lib/types";
import { badRequest, databaseError, menuSearchQuerySchema, searchParamsObject } from "@/lib/validate";

// No `export const runtime` (cacheComponents is on). connection() keeps this request-time, never prerendered.

export async function GET(request: NextRequest) {
  await connection();
  const parsed = menuSearchQuerySchema.safeParse(searchParamsObject(request.nextUrl, ["q", "lat", "lng"]));
  if (!parsed.success) return badRequest(parsed.error);
  const { q, lat, lng } = parsed.data;
  const origin = lat !== undefined && lng !== undefined ? roundLatLng({ lat, lng }) : null;

  try {
    const menu = await loadCampusMenu();
    const result = searchMenu(q, menu.index);
    const hits: MenuHit[] = result.lines.map((l) => ({
      id: l.id,
      location_id: l.location_id,
      outlet_name: l.outlet_name,
      area: l.area,
      is_benchmark: l.is_benchmark,
      approximate: isApproximate(l.location_precision),
      category: l.category,
      item: l.item,
      variant: l.variant,
      price: l.price,
      source: l.source,
      reported_on: l.reported_on,
      walk_min: origin ? walkMinutes(origin, l) : null,
    }));
    const body: MenuSearchResponse = {
      kind: result.kind,
      did_you_mean: result.kind === "typo" ? result.didYouMean : null,
      groups: groupByItemName(hits),
      shown: hits.length,
      total: result.total,
      origin,
    };
    // Depends on where the student is: not cached by the browser or the CDN.
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return databaseError("menu-search", err);
  }
}
