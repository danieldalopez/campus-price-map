// GET /api/barcode?code=0180854000101: what a scanned barcode is. docs/SPEC.md section 8.
// { status: "matched" | "known" | "unknown", item_id?, product_name?, quantity? }
// The bundled Open Food Facts extract first, then the Open Food Facts API (src/lib/barcodes.ts). A live answer
// is never matched to an item (G16).

import { connection, type NextRequest } from "next/server";
import { barcodeQuerySchema, lookupBarcode } from "@/lib/barcodes";
import type { BarcodeResult } from "@/lib/gtin";
import { badRequest, errorResponse, searchParamsObject } from "@/lib/validate";

// No `export const runtime` (cacheComponents is on). connection() keeps this request-time, never prerendered.

export async function GET(request: NextRequest) {
  await connection();
  const parsed = barcodeQuerySchema.safeParse(searchParamsObject(request.nextUrl, ["code"]));
  if (!parsed.success) return badRequest(parsed.error);

  try {
    const { result, source } = await lookupBarcode(parsed.data.code);
    const body: BarcodeResult = result;
    // A product's barcode doesn't change. Bundled answers only change with a deploy; live ones are kept shorter;
    // "Open Food Facts didn't answer" isn't kept at all, so the next scan asks again.
    const cache =
      source === "bundled" ? "public, max-age=86400" : source === "live" ? "public, max-age=3600" : "no-store";
    return Response.json(body, { headers: { "cache-control": cache } });
  } catch (err) {
    console.error(`[barcode] lookup failed: ${err instanceof Error ? err.name : "unknown"}`);
    return errorResponse("We couldn't look that barcode up right now. Try again in a moment.", 500);
  }
}
