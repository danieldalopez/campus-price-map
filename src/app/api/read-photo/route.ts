// POST /api/read-photo: Gemini reads a price tag, menu board, product or receipt (docs/SPEC.md section 9a).
// In: { image: base64 JPEG, hint?: "tag" | "product" | "receipt", device_id }   Out: PhotoDraft
//
// Before Gemini: the rate limits (10 reads per device per minute, GEMINI_DAILY_CAP a day in total, section 8),
// then one photo_reads row. The image is never stored or logged (G8): it goes to Gemini and is dropped.

import { connection } from "next/server";
import { z } from "zod";
import { DbConfigError } from "@/lib/db";
import { DEVICE_ID_PATTERN } from "@/lib/device";
import { GeminiConfigError, GeminiReadError, GeminiTimeoutError, readPhoto } from "@/lib/gemini";
import { dailyPhotoCap, photoReadCounts, PHOTO_READS_PER_MINUTE, recordPhotoRead } from "@/lib/limits";
import { IMAGE_MAX_BASE64, type ApiError, type PhotoDraft, type SnapItem } from "@/lib/snap";
import { loadSnapItems } from "@/lib/snap-data";

// No `export const runtime` (cacheComponents is on; route handlers already run on Node.js). Two Gemini
// attempts of up to 20 s each fit inside this.
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };
const COULDNT_READ = "Couldn't read it, pick your item";

function fail(error: string, status: number, headers: Record<string, string> = {}): Response {
  const body: ApiError = { error };
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

const bodySchema = z.object({
  image: z.string({ error: "That photo didn't come through. Try again." }).min(1, "That photo didn't come through. Try again."),
  hint: z.enum(["tag", "product", "receipt"]).optional(),
  device_id: z
    .string({ error: "Reload the page and try again." })
    .regex(DEVICE_ID_PATTERN, "Reload the page and try again."),
});

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// Every JPEG starts with the bytes FF D8 FF, which is "/9j/" in base64.
const JPEG_MAGIC = "/9j/";

function logKind(err: unknown): string {
  if (err instanceof DbConfigError) return err.message;
  if (err instanceof GeminiReadError) return err.message;
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
    return fail("That photo didn't come through. Try again.", 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That photo didn't come through. Try again.", 400);
  const { device_id: deviceId, hint } = parsed.data;

  // Measured on the base64 string, since that's what was sent (G5).
  const image = parsed.data.image.replace(/^data:image\/jpeg;base64,/, "");
  if (image.length > IMAGE_MAX_BASE64) return fail("That photo is too big, try again.", 413);
  if (!BASE64.test(image) || !image.startsWith(JPEG_MAGIC)) {
    return fail("That isn't a photo we can read. Try again or pick your item.", 400);
  }

  let items: SnapItem[];
  try {
    const counts = await photoReadCounts(deviceId);
    if (counts.deviceMinute >= PHOTO_READS_PER_MINUTE) {
      return fail("That's a lot of photos in a minute. Wait a moment, or pick your item.", 429, { "retry-after": "60" });
    }
    if (counts.today >= dailyPhotoCap()) {
      return fail("Photo reading is resting until tomorrow. Pick your item instead.", 429);
    }
    items = await loadSnapItems();
    await recordPhotoRead(deviceId);
  } catch (err) {
    console.error(`[read-photo] database step failed: ${logKind(err)}`);
    return fail("The price database isn't reachable right now. Try again in a minute.", 503);
  }

  try {
    const draft: PhotoDraft = await readPhoto(image, items, hint);
    return Response.json(draft, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof GeminiConfigError) {
      console.error("[read-photo] GEMINI_API_KEY is not set");
      return fail("Photo reading isn't available right now. Pick your item.", 503);
    }
    if (err instanceof GeminiTimeoutError) {
      console.error("[read-photo] gemini timed out twice");
      return fail(COULDNT_READ, 504);
    }
    // Only the kind of failure: never the image, the prompt or the key.
    console.error(`[read-photo] gemini failed: ${logKind(err)}`);
    return fail(COULDNT_READ, 502);
  }
}
