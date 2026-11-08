// GET /api/config: app_config for Worth the walk (docs/SPEC.md section 8).

import { connection } from "next/server";
import { loadConfig } from "@/lib/config";
import { databaseError } from "@/lib/validate";

// No `export const runtime` (cacheComponents is on). connection() keeps this request-time, never prerendered.

export async function GET() {
  await connection();
  try {
    const config = await loadConfig();
    // Changes rarely; a few minutes of caching in the browser is fine.
    return Response.json(config, { headers: { "cache-control": "private, max-age=300" } });
  } catch (err) {
    return databaseError("config", err);
  }
}
