// GET /api/outlet/[id]: one outlet, its tracked items (compared across campus) and its full menu.
// docs/SPEC.md sections 7 ("Outlet") and 8. Same price source selection as /api/prices.

import { connection, type NextRequest } from "next/server";
import { loadOutletPage } from "@/lib/outlet-data";
import { badRequest, databaseError, deviceIdSchema, errorResponse, locationIdSchema } from "@/lib/validate";

// No `export const runtime` (cacheComponents is on). connection() keeps this request-time, never prerendered.

export async function GET(request: NextRequest, ctx: RouteContext<"/api/outlet/[id]">) {
  await connection();
  const parsed = locationIdSchema.safeParse((await ctx.params).id);
  if (!parsed.success) return badRequest(parsed.error);
  // Only used to mark "Your report" on pending lines; sent as a header so it never sits in a URL.
  const deviceId = deviceIdSchema.parse(request.headers.get("x-device-id") ?? undefined);

  try {
    const body = await loadOutletPage(parsed.data, deviceId);
    if (!body) return errorResponse("We don't know that outlet.", 404);
    // Live reports change what it shows: never cached.
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return databaseError("outlet", err);
  }
}
