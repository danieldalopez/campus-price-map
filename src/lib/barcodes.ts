// Barcode lookup for GET /api/barcode (docs/SPEC.md sections 6 "Barcodes", 8 and G16). Server only.
//
// 1. The bundled Open Food Facts extract, data/barcodes.csv, read once per server instance and kept in memory.
//    A row with an item_id is "matched"; a row without one is "known".
// 2. Otherwise the Open Food Facts API, with a 4 s timeout. Its answer is cached in memory. A live answer is
//    only ever "known" or "unknown": it never maps to one of our items on its own (G16).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BARCODE_PATTERN, barcodeKeys, type BarcodeResult } from "./gtin";

export const barcodeQuerySchema = z.object({
  code: z
    .string({ error: "Scan a barcode first." })
    .trim()
    .regex(BARCODE_PATTERN, "That doesn't look like a barcode. Barcodes are 8 to 14 digits."),
});

// ---------------------------------------------------------------------------------------------------------
// data/barcodes.csv
// ---------------------------------------------------------------------------------------------------------

const CSV_PATH = path.join(process.cwd(), "data", "barcodes.csv");
const ITEM_ID = /^I\d{2}$/;

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF. Product names can hold commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** "Red Bull" + "Sugarfree" → "Red Bull Sugarfree"; no brand twice. Brands can be a comma list in OFF. */
export function displayName(name: string | null, brands: string | null): string | null {
  const n = name?.trim() || null;
  const brand = brands?.split(",")[0]?.trim() || null;
  if (n && brand && !n.toLowerCase().includes(brand.toLowerCase())) return `${brand} ${n}`;
  return n ?? brand;
}

function rowResult(cols: Map<string, number>, r: string[]): BarcodeResult {
  const get = (name: string) => (r[cols.get(name) ?? -1] ?? "").trim();
  const itemId = get("item_id");
  const productName = displayName(get("product_name"), get("brand"));
  const quantity = get("quantity");
  return {
    status: ITEM_ID.test(itemId) ? "matched" : "known",
    ...(ITEM_ID.test(itemId) ? { item_id: itemId } : {}),
    ...(productName ? { product_name: productName } : {}),
    ...(quantity ? { quantity } : {}),
  };
}

/** Every key of every row → its result. Built once, then reused by every request this instance serves. */
async function loadBundled(): Promise<Map<string, BarcodeResult>> {
  const rows = parseCsv(await readFile(CSV_PATH, "utf8"));
  const [header, ...body] = rows;
  const cols = new Map((header ?? []).map((h, i) => [h.trim().toLowerCase(), i]));
  const byKey = new Map<string, BarcodeResult>();
  const at = cols.get("barcode");
  if (at === undefined) throw new Error("data/barcodes.csv has no barcode column");
  for (const r of body) {
    const result = rowResult(cols, r);
    for (const key of barcodeKeys((r[at] ?? "").trim())) {
      // A matched row wins over a not tracked one if two rows ever share a key.
      if (!byKey.has(key) || result.status === "matched") byKey.set(key, result);
    }
  }
  return byKey;
}

let bundled: Promise<Map<string, BarcodeResult>> | null = null;

export async function lookupBundled(code: string): Promise<BarcodeResult | null> {
  bundled ??= loadBundled().catch((err: unknown) => {
    bundled = null; // try again on the next request
    throw err;
  });
  const byKey = await bundled;
  for (const key of barcodeKeys(code)) {
    const hit = byKey.get(key);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Open Food Facts API
// ---------------------------------------------------------------------------------------------------------

const OFF_USER_AGENT = "CampusPriceMap/0.1 (+https://github.com/danieldalopez/campus-price-map)";
const OFF_TIMEOUT_MS = 4_000;
const CACHE_MAX = 1_000;

const offSchema = z.object({
  status: z.union([z.number(), z.string()]).optional(),
  product: z
    .object({
      product_name: z.string().nullish(),
      brands: z.string().nullish(),
      quantity: z.string().nullish(),
    })
    .nullish(),
});

/** Live answers by first key. Map keeps insertion order, so the oldest goes first when it's full. */
const liveCache = new Map<string, BarcodeResult>();

function remember(key: string, result: BarcodeResult) {
  if (liveCache.size >= CACHE_MAX) {
    const oldest = liveCache.keys().next().value;
    if (oldest !== undefined) liveCache.delete(oldest);
  }
  liveCache.set(key, result);
}

/**
 * Ask Open Food Facts. `null` means we couldn't get an answer (timeout, network, their error): that isn't
 * cached, so the next scan tries again.
 */
async function fetchOpenFoodFacts(code: string): Promise<BarcodeResult | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,quantity`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": OFF_USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(OFF_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.warn(`[barcode] Open Food Facts didn't answer: ${err instanceof Error ? err.name : "unknown"}`);
    return null;
  }
  // 404 is their "product not found", a real answer.
  if (res.status === 404) return { status: "unknown" };
  if (!res.ok) {
    console.warn(`[barcode] Open Food Facts answered ${res.status}`);
    return null;
  }
  const parsed = offSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return null;
  const product = parsed.data.product;
  if (String(parsed.data.status ?? "") !== "1" || !product) return { status: "unknown" };
  const name = displayName(product.product_name ?? null, product.brands ?? null);
  // A product with no name or brand can't be shown as "That's …", so it's no better than unknown.
  if (!name) return { status: "unknown" };
  const quantity = product.quantity?.trim();
  return { status: "known", product_name: name, ...(quantity ? { quantity } : {}) };
}

/** Open Food Facts, through the in-memory cache. `null` when it couldn't answer this time. */
export async function lookupLive(code: string): Promise<BarcodeResult | null> {
  const key = barcodeKeys(code)[0] ?? code;
  const cached = liveCache.get(key);
  if (cached) return cached;
  const result = await fetchOpenFoodFacts(code);
  if (result) remember(key, result);
  return result;
}

export type BarcodeSource = "bundled" | "live" | "unavailable";

/** The bundled file first, then Open Food Facts. If neither can answer, it's unknown (and not cached). */
export async function lookupBarcode(code: string): Promise<{ result: BarcodeResult; source: BarcodeSource }> {
  const hit = await lookupBundled(code);
  if (hit) return { result: hit, source: "bundled" };
  const live = await lookupLive(code);
  return live ? { result: live, source: "live" } : { result: { status: "unknown" }, source: "unavailable" };
}
