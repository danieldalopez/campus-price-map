// Price decisions that depend on where the student is. docs/SPEC.md sections 7, 8 and 10.
// Used by /api/prices (live-mode bands) and by the Results page (decision line, Near you / Farther, sort).
//
// Only official prices take part. Rows with only a pending report or an estimate are listed, but never
// ranked, never in the decision line and never stamped CHEAPEST (G13).

import { formatPrice } from "./format";
import { walkLabel, walkMinutes, type LatLng } from "./geo";
import type { Band, PriceRow } from "./types";

/** "Near you" is about 3 min walk or less. */
export const NEAR_MINUTES = 3;
/** A Farther row is dimmed unless it saves at least this much. */
export const FARTHER_WORTH_SHOWING = 1.0;
/** Prices older than this are dimmed and say "may be out of date" (G7). */
export const STALE_DAYS = 14;

const toCents = (dollars: number) => Math.round(dollars * 100);

// ---------------------------------------------------------------------------------------------------------
// Price bands (live mode). Same rule as band_sql in databricks/src/price_engine.py:
//   t = max(10% of campus_median, $0.20); good if price <= median - t; high if price >= median + t;
//   else average; null if fewer than 3 outlets have an official price (and for the grocery baseline,
//   which callers never pass in).
// ---------------------------------------------------------------------------------------------------------

export const BAND_MIN_OUTLETS = 3;

/** Good / average / high against the campus median, in exact cents (the pipeline uses decimals). */
export function priceBand(price: number, campusMedian: number | null, nOutlets: number): Band | null {
  if (campusMedian === null || nOutlets < BAND_MIN_OUTLETS) return null;
  const p = toCents(price);
  const m = toCents(campusMedian);
  // In tenths of a cent: t = max(m / 10, 20) cents  ->  10t = max(m, 200).
  const t10 = Math.max(m, 200);
  if (10 * p <= 10 * m - t10) return "good";
  if (10 * p >= 10 * m + t10) return "high";
  return "average";
}

/** Percent above (+) or below (-) the campus median, one decimal. */
export function pctVsMedian(price: number, campusMedian: number | null): number | null {
  if (campusMedian === null || campusMedian <= 0) return null;
  return Math.round(((price - campusMedian) / campusMedian) * 1000) / 10;
}

// ---------------------------------------------------------------------------------------------------------
// Sorting and sections
// ---------------------------------------------------------------------------------------------------------

/** An official price the student can buy now: these are the only rows compared with each other. */
export function isComparable(row: PriceRow): row is PriceRow & { price: number } {
  return row.price !== null && row.stock !== "sold_out";
}

/** Recompute walk minutes from a new origin (the student moved more than 30 m). */
export function withWalkFrom(rows: PriceRow[], origin: LatLng): PriceRow[] {
  return rows.map((row) => ({ ...row, walk_min: walkMinutes(origin, row.outlet) }));
}

function group(row: PriceRow): number {
  if (row.price === null) return 2; // pending or estimate only: after every official price
  return row.stock === "sold_out" ? 1 : 0; // sold out sorts below in stock
}

/** Cheapest first; sold out below in stock; rows without an official price last (closest first). */
export function compareRows(a: PriceRow, b: PriceRow): number {
  const g = group(a) - group(b);
  if (g !== 0) return g;
  if (a.price !== null && b.price !== null && a.price !== b.price) return a.price - b.price;
  const walk = (a.walk_min ?? Infinity) - (b.walk_min ?? Infinity);
  if (walk !== 0 && Number.isFinite(walk)) return walk;
  return a.outlet.name.localeCompare(b.outlet.name);
}

export function isNear(row: PriceRow): boolean {
  return row.walk_min !== null && row.walk_min <= NEAR_MINUTES;
}

/**
 * The price the list ranks a row by: what you'd pay each, counting a multi-buy deal when it's cheaper than the
 * single price (data/deals.csv). Only the list order uses it; the decision line, CHEAPEST stamp and Worth the
 * walk compare single prices, because a deal only applies if you buy that many.
 */
export function listPrice(row: PriceRow): number | null {
  if (row.price === null) return null;
  return row.deal && row.deal.each < row.price ? row.deal.each : row.price;
}

/** Like compareRows, but a deal counts: "2 for $5.99" ranks as $3.00 each. */
export function compareForList(a: PriceRow, b: PriceRow): number {
  const g = group(a) - group(b);
  if (g !== 0) return g;
  const pa = listPrice(a);
  const pb = listPrice(b);
  if (pa !== null && pb !== null && pa !== pb) return pa - pb;
  return compareRows(a, b);
}

/** The best in-stock deal on the page: the lowest price each, if it beats every other outlet's single price. */
export function bestDeal(rows: PriceRow[]): (PriceRow & { deal: NonNullable<PriceRow["deal"]> }) | null {
  const deals = rows.filter(
    (r): r is PriceRow & { deal: NonNullable<PriceRow["deal"]> } =>
      !!r.deal && r.deal.cheapest_on_campus && r.stock !== "sold_out",
  );
  return deals.sort((a, b) => a.deal.each - b.deal.each)[0] ?? null;
}

export type Sections = { near: PriceRow[]; farther: PriceRow[] };

/** Near you (about 3 min or less) and Farther, each sorted with compareForList (deals count). */
export function splitSections(rows: PriceRow[]): Sections {
  const sorted = [...rows].sort(compareForList);
  return { near: sorted.filter(isNear), farther: sorted.filter((r) => !isNear(r)) };
}

/** The cheapest official, in-stock row (closest on a tie), if at least 2 outlets have a price to compare. */
export function cheapestRow(rows: PriceRow[]): PriceRow | null {
  const comparable = rows.filter(isComparable);
  if (comparable.length < 2) return null;
  return [...comparable].sort(compareRows)[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------------
// Decision line
// ---------------------------------------------------------------------------------------------------------

export type Decision =
  | {
      kind: "save";
      /** Dollars saved compared with the closest outlet that has the item. */
      saving: number;
      at: PriceRow & { price: number };
      closest: PriceRow & { price: number };
      /** "near": among Near you rows. "campus": nothing is near, so among every outlet. */
      scope: "near" | "campus";
    }
  | { kind: "closest_is_cheapest"; closest: PriceRow & { price: number }; scope: "near" | "campus" }
  | { kind: "none" };

function byWalkThenPrice(a: PriceRow & { price: number }, b: PriceRow & { price: number }): number {
  const walk = (a.walk_min ?? Infinity) - (b.walk_min ?? Infinity);
  if (walk !== 0 && Number.isFinite(walk)) return walk;
  return a.price - b.price || a.outlet.name.localeCompare(b.outlet.name);
}

/**
 * Compare the closest outlet that has the item with the cheapest one near you. If nothing is within about
 * 3 min, compare with the cheapest anywhere (the walk time is in the sentence).
 */
export function decide(rows: PriceRow[]): Decision {
  const comparable = rows.filter(isComparable);
  if (comparable.length === 0) return { kind: "none" };
  const closest = [...comparable].sort(byWalkThenPrice)[0];
  const near = comparable.filter(isNear);
  const scope = near.length > 0 ? "near" : "campus";
  const pool = scope === "near" ? near : comparable;
  const best = [...pool].sort(compareRows)[0];
  const saving = (toCents(closest.price) - toCents(best.price)) / 100;
  if (saving <= 0 || best.outlet.id === closest.outlet.id) {
    return { kind: "closest_is_cheapest", closest, scope };
  }
  return { kind: "save", saving, at: best, closest, scope };
}

/** "You'd save $0.80 at Harvest Market, about 2 min walk" or "The closest one is also the cheapest near you." */
export function decisionText(d: Decision): string {
  switch (d.kind) {
    case "save":
      return `You'd save ${formatPrice(d.saving)} at ${d.at.outlet.name}, ${walkLabel(d.at.walk_min ?? 0)}`;
    case "closest_is_cheapest":
      return d.scope === "near"
        ? "The closest one is also the cheapest near you."
        : "The closest one is also the cheapest on campus.";
    case "none":
      return "No confirmed price for this item yet.";
  }
}

/**
 * The price a Farther row has to beat to stand out: the cheapest near you if anything is near,
 * otherwise the closest outlet's price.
 */
export function referencePrice(d: Decision): number | null {
  switch (d.kind) {
    case "save":
      return d.scope === "near" ? d.at.price : d.closest.price;
    case "closest_is_cheapest":
      return d.closest.price;
    case "none":
      return null;
  }
}

/** Farther rows are dimmed unless they save $1.00 or more compared with the reference price. */
export function fartherStandsOut(row: PriceRow, reference: number | null): boolean {
  if (!isComparable(row) || reference === null) return false;
  return toCents(reference) - toCents(row.price) >= toCents(FARTHER_WORTH_SHOWING);
}

// ---------------------------------------------------------------------------------------------------------
// Freshness line (G7: every price shows its source and age)
// ---------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "America/Vancouver",
});

/** "just now", "20 min ago", "3 h ago", "yesterday", "Nov 7". */
export function timeAgo(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < DAY_MS) return `${Math.floor(ms / 3_600_000)} h ago`;
  if (ms < 2 * DAY_MS) return "yesterday";
  return shortDate.format(new Date(iso));
}

export type Freshness = { text: string; stale: boolean };

/**
 * "Confirmed by 2 students · 20 min ago", "From our price walk · Nov 7", "Menu price · Nov 7",
 * "Our price" (the seed prices) or "Grocery baseline". Older than 14 days: stale.
 */
export function freshness(
  row: Pick<PriceRow, "source" | "confirmations" | "updated_at">,
  now: number,
): Freshness | null {
  if (!row.source || !row.updated_at) return null;
  const at = row.updated_at;
  const stale = now - Date.parse(at) > STALE_DAYS * DAY_MS;
  let text: string;
  switch (row.source) {
    case "seed":
      text = "Our price";
      break;
    case "menu":
      text = `Menu price · ${shortDate.format(new Date(at))}`;
      break;
    case "walk":
      text = `From our price walk · ${shortDate.format(new Date(at))}`;
      break;
    case "grocery":
      text = "Grocery baseline";
      break;
    default: {
      // The reporter plus everyone who confirmed it.
      const students = row.confirmations + 1;
      text = `Confirmed by ${students} ${students === 1 ? "student" : "students"} · ${timeAgo(at, now)}`;
    }
  }
  return { text: stale ? `${text} · may be out of date` : text, stale };
}

/** "$1.10 more than Save-On-Foods (Wesbrook Village)" or "$0.20 less than …" or "Same price as …". */
export function groceryText(campusPrice: number, grocery: { name: string; price: number }): string {
  const diff = (toCents(campusPrice) - toCents(grocery.price)) / 100;
  if (diff === 0) return `Same price as ${grocery.name}`;
  return `${formatPrice(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${grocery.name}`;
}
