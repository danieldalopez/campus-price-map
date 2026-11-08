// GET /api/outlet/[id]: one outlet and every tracked item it sells. docs/SPEC.md section 8.

import { connection, type NextRequest } from "next/server";
import { loadOutletPage } from "@/lib/outlet-prices";
import { badRequest, databaseError, deviceIdSchema, errorResponse, locationIdSchema } from "@/lib/validate";

// No `export const runtime` (cacheComponents is on). connection() keeps this request-time, never prerendered.

export async function GET(request: NextRequest, ctx: RouteContext<"/api/outlet/[id]">) {
  await connection();
  const parsed = locationIdSchema.safeParse((await ctx.params).id);
  if (!parsed.success) return badRequest(parsed.error);
  const deviceId = deviceIdSchema.parse(request.headers.get("x-device-id") ?? undefined);

  try {
    const body = await loadOutletPage({ locationId: parsed.data, deviceId });
    if (!body) return errorResponse("We don't track that outlet.", 404);
    // Live reports change it at any time: never cached.
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return databaseError("outlet", err);
  }
}
