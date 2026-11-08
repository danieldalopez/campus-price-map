// GET /api/locations: every outlet with lat, lng, hours and its price tier (null = "?" until the pipeline's
// serving.outlet_scores exists). docs/SPEC.md section 8.

import { connection } from "next/server";
import { loadOutlets } from "@/lib/catalog";
import type { LocationsResponse } from "@/lib/types";
import { databaseError } from "@/lib/validate";

// No `export const runtime` (cacheComponents is on). connection() keeps this request-time, never prerendered.
// No input to validate.

export async function GET() {
  await connection();
  try {
    const body: LocationsResponse = { locations: await loadOutlets() };
    return Response.json(body, {
      headers: { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" },
    });
  } catch (err) {
    return databaseError("locations", err);
  }
}
