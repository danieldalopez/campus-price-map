// Multi-buy deals ("2 for $5.99"), from data/deals.csv. Server only.
//
// The deals come from the deal_* columns of data/raw/campus_food_prices.csv (the team's menu read, Nov 7),
// which the database seed doesn't load. They're bundled with the app like data/barcodes.csv: read once per
// server instance, no database or Databricks change.
//
// A deal is shown next to the normal price, never instead of it: it only helps if you buy that many, so
// rankings, bands, chips and Worth the walk keep using the single price.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Deal, PriceRow } from "./types";

const CSV_PATH = path.join(process.cwd(), "data", "deals.csv");

type DealRecord = { qty: number; price: number; description: string; reported_on: string };

let cache: Promise<Map<string, DealRecord>> | null = null;

const key = (itemId: string, locationId: string) => `${itemId}|${locationId}`;

async function readDeals(): Promise<Map<string, DealRecord>> {
  const map = new Map<string, DealRecord>();
  try {
    const text = await readFile(CSV_PATH, "utf8");
    const [header, ...lines] = text.trim().split(/\r?\n/);
    const cols = header.split(",");
    for (const line of lines) {
      const cells = line.split(",");
      const row = Object.fromEntries(cols.map((c, i) => [c, cells[i]?.trim() ?? ""]));
      const qty = Number(row.qty);
      const price = Number(row.deal_price);
      if (!/^I\d{2}$/.test(row.item_id) || !row.location_id || !(qty >= 2) || !(price > 0)) continue;
      map.set(key(row.item_id, row.location_id), {
        qty,
        price,
        description: row.description,
        reported_on: row.reported_on,
      });
    }
  } catch (err) {
    // No deals file is not an error: the app just shows no deals.
    console.warn(`[deals] couldn't read data/deals.csv: ${err instanceof Error ? err.name : "unknown"}`);
  }
  return map;
}

function deals(): Promise<Map<string, DealRecord>> {
  cache ??= readDeals();
  return cache;
}

const cents = (x: number) => Math.round(x * 100);

/**
 * The deal for this item at this outlet, if any. `cheapestElsewhere` is the lowest single official price at
 * any other outlet, to say "Cheapest on campus if you buy 2". `single` is this outlet's own single price.
 */
export async function dealFor(
  itemId: string,
  locationId: string,
  single: number | null,
  cheapestElsewhere: number | null,
): Promise<Deal | null> {
  const d = (await deals()).get(key(itemId, locationId));
  if (!d) return null;
  const each = Math.round((d.price / d.qty) * 100) / 100;
  // Compare whole baskets in cents so rounding "each" can't make a deal look better than it is.
  const saving = single === null ? null : (cents(single) * d.qty - cents(d.price)) / 100;
  return {
    qty: d.qty,
    price: d.price,
    each,
    saving: saving !== null && saving > 0 ? saving : null,
    cheapest_on_campus: cheapestElsewhere !== null && cents(d.price) < cents(cheapestElsewhere) * d.qty,
    reported_on: d.reported_on,
  };
}

export async function hasDeal(itemId: string, locationId: string): Promise<boolean> {
  return (await deals()).has(key(itemId, locationId));
}

/** Add `deal` to every Results row for one item. */
export async function withDeals<R extends Pick<PriceRow, "outlet" | "price">>(
  itemId: string,
  rows: R[],
): Promise<(R & { deal: Deal | null })[]> {
  const singles = rows.filter((r) => r.price !== null).map((r) => ({ id: r.outlet.id, price: r.price as number }));
  return Promise.all(
    rows.map(async (r) => {
      const others = singles.filter((s) => s.id !== r.outlet.id).map((s) => s.price);
      const cheapestElsewhere = others.length ? Math.min(...others) : null;
      return { ...r, deal: await dealFor(itemId, r.outlet.id, r.price, cheapestElsewhere) };
    }),
  );
}
