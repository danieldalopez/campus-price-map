// Input validation and response helpers for the API routes (docs/SPEC.md rule 7: zod for every input).
// Server only.

import { z } from "zod";
import { DbConfigError } from "./db";
import type { ApiError } from "./types";

export const itemIdSchema = z
  .string({ error: "Pick an item to see its prices." })
  .trim()
  .regex(/^I\d{2}$/, "That isn't an item we track.");

const coordinate = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,3}(\.\d+)?$/, "Location must be a number.")
    .transform(Number)
    .pipe(z.number().min(min, "That location isn't valid.").max(max, "That location isn't valid."));

/** GET /api/prices?item=I01&lat=49.2666&lng=-123.2499. lat and lng come together or not at all. */
export const pricesQuerySchema = z
  .object({
    item: itemIdSchema,
    lat: coordinate(-90, 90).optional(),
    lng: coordinate(-180, 180).optional(),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), {
    message: "Send both lat and lng, or neither.",
  });

/** GET /api/menu-search?q=ramen&lat=49.2666&lng=-123.2499. lat and lng come together or not at all. */
export const menuSearchQuerySchema = z
  .object({
    q: z
      .string({ error: "Type what you want to find." })
      .trim()
      .min(1, "Type what you want to find.")
      .max(60, "That search is too long. Try a word or two."),
    lat: coordinate(-90, 90).optional(),
    lng: coordinate(-180, 180).optional(),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), {
    message: "Send both lat and lng, or neither.",
  });

/** The device's random id (src/lib/device.ts, Step 6), sent as a header so it never sits in a URL. */
export const deviceIdSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}$/)
  .optional()
  .catch(undefined);

/** Every query parameter as a string, or undefined when it's missing or empty. */
export function searchParamsObject(url: URL, names: readonly string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const name of names) {
    const value = url.searchParams.get(name);
    out[name] = value === null || value.trim() === "" ? undefined : value;
  }
  return out;
}

const NO_STORE = { "cache-control": "no-store" };

/** `{ error: "plain sentence for the user" }` with the right status code. */
export function errorResponse(message: string, status: number): Response {
  const body: ApiError = { error: message };
  return Response.json(body, { status, headers: NO_STORE });
}

/** The first zod issue as the user-facing sentence. */
export function badRequest(error: z.ZodError): Response {
  return errorResponse(error.issues[0]?.message ?? "That request isn't valid.", 400);
}

/** Log the kind of failure only (never a connection string), and tell the user to try again. */
export function databaseError(route: string, err: unknown): Response {
  const kind = err instanceof DbConfigError ? err.message : err instanceof Error ? err.name : "unknown";
  const code = (err as { code?: unknown } | null)?.code;
  console.error(`[${route}] database query failed: ${kind}${typeof code === "string" ? ` (${code})` : ""}`);
  return errorResponse("The price database isn't reachable right now. Try again in a minute.", 503);
}

// ---------------------------------------------------------------------------------------------------------
// Database values: `pg` returns numeric and bigint columns as strings, timestamps as Date.
// ---------------------------------------------------------------------------------------------------------

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function iso(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string" && v !== "") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

export function text(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** An outlet id: the `locations.id` slug, e.g. "blue-chip-cafe". */
export const locationIdSchema = z
  .string({ error: "Pick an outlet to see its prices." })
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "That isn't an outlet we track.");
