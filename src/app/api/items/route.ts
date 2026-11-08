// GET /api/items: the 23 tracked items with their image path and search aliases. docs/SPEC.md section 8.

import { connection } from "next/server";
import { loadItems } from "@/lib/catalog";
import type { ItemsResponse } from "@/lib/types";
import { databaseError } from "@/lib/validate";

// No `export const runtime` (cacheComponents is on). connection() keeps this request-time, never prerendered.
// No input to validate. Items change only with a new seed, so the CDN may keep them for a few minutes.

export async function GET() {
  await connection();
  try {
    const body: ItemsResponse = { items: await loadItems() };
    return Response.json(body, {
      headers: { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" },
    });
  } catch (err) {
    return databaseError("items", err);
  }
}
