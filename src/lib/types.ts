// Shapes the read API returns (docs/SPEC.md section 8). Shared by the route handlers and the browser.
// JSON field names are snake_case, as in the spec.

/** A tracked item (`items` table). */
export type Item = {
  id: string;
  name: string;
  size: string;
  category: string;
  /** "/items/I01.webp". The stickers land in Step 10; until then the tiles show a placeholder. */
  image: string | null;
  volume_ml: number | null;
  /** Search aliases, from `items.aliases` (pipe separated in the database). */
  aliases: string[];
};

export type ItemsResponse = { items: Item[] };

/** Price tier from serving.outlet_scores; null shows as "?" (no tier yet). */
export type Tier = "$" | "$$" | "$$$";
export type TierBasis = "measured" | "estimated";
export type LocationPrecision = "exact" | "building" | "area";

/** One campus outlet (`locations` table), with its tier when the pipeline has one. */
export type Outlet = {
  id: string;
  name: string;
  area: string | null;
  operator: string;
  type: string;
  address: string | null;
  /** As listed, e.g. "M-F: 7 am - 7 pm; Sat-Sun: 9 am - 5 pm". */
  hours: string | null;
  lat: number;
  lng: number;
  /** Save-On-Foods Wesbrook: the grocery baseline, never ranked. */
  is_benchmark: boolean;
  /** "building" or "area": shown as "approximate location". */
  location_precision: LocationPrecision;
  tier: Tier | null;
  tier_basis: TierBasis | null;
};

export type LocationsResponse = { locations: Outlet[] };

export type Band = "good" | "average" | "high";
export type Stock = "in_stock" | "maybe_sold_out" | "sold_out";
export type PriceSource = "walk" | "menu" | "grocery" | "seed" | "photo" | "receipt" | "typed";

export type RowOutlet = Pick<
  Outlet,
  "id" | "name" | "area" | "address" | "hours" | "lat" | "lng" | "location_precision"
>;

/**
 * One item at one outlet: an official price, a pending report, or (pipeline) an estimate. Shared by Results
 * (one item at every outlet, `PriceRow`) and the Outlet page (every item at one outlet, `OutletItemRow`).
 */
export type PriceFields = {
  /** The official price. Null when the outlet has only a pending report or an estimate. */
  price: number | null;
  source: PriceSource | null;
  confirmations: number;
  updated_at: string | null;
  stock: Stock;
  band: Band | null;
  pct_vs_median: number | null;
  /** Pipeline only: "Cheapest on campus", "2nd cheapest of 6", "$0.40 above campus average". */
  chip: string | null;
  nearest_cheaper: { location_id: string; name: string | null; price: number; walk_min: number | null } | null;
  /** Pipeline only: a live official price newer than the pipeline's row. */
  just_confirmed: { price: number; updated_at: string } | null;
  /** Pipeline only, and only when `price` is null: the model's 80% interval. Never shown as a price. */
  estimate: { low: number; high: number } | null;
  /** The newest pending report. `my_vote` is this device's vote on it, if it voted (Step 7). */
  pending: { price_id: number; price: number; mine: boolean; my_vote: Vote | null } | null;
};

/** One outlet that sells the item (Results). */
export type PriceRow = PriceFields & {
  outlet: RowOutlet;
  /** About N minutes from the origin the request gave (haversine x 1.3 / 80 m per min, rounded up). */
  walk_min: number | null;
};

/** One tracked item at the outlet (Outlet page). */
export type OutletItemRow = PriceFields & { item: Item };

/** One line of an outlet's menu (`menu_items`), tracked or not. */
export type MenuLine = {
  id: number;
  item: string;
  variant: string | null;
  price: number;
  /** `menu` (read off the menu, dated) or `seed` (AI-estimated prototype price, shown as real). */
  source: PriceSource;
  /** The day it was read, as noon in Vancouver (ISO), so it formats as the same date everywhere. */
  reported_on: string;
  /** The tracked items this line counts as (e.g. ["I08"]); empty for most lines. */
  item_ids: string[];
};

export type MenuCategory = { category: string; lines: MenuLine[] };

/** GET /api/outlet/[id]. */
export type OutletResponse = {
  outlet: Outlet;
  /** Tracked items with a price, pending report or estimate here; compared across campus. */
  items: OutletItemRow[];
  /** Every menu line, grouped by the menu's own categories, in the order the menu lists them. */
  menu: MenuCategory[];
  price_source_used: "live" | "pipeline";
  computed_at: string | null;
};

/** One menu line that matched a search, with its outlet. */
export type MenuHit = {
  id: number;
  location_id: string;
  outlet_name: string;
  area: string | null;
  /** The grocery baseline: labelled, never called cheapest. */
  is_benchmark: boolean;
  approximate: boolean;
  category: string;
  item: string;
  variant: string | null;
  price: number;
  source: PriceSource;
  reported_on: string;
  /** About N minutes from the lat/lng the request gave, or null without one. */
  walk_min: number | null;
};

/** GET /api/menu-search?q=&lat=&lng=. */
export type MenuSearchResponse = {
  /** "match": item names matched. "typo": only near misses (see did_you_mean). "category": only menu
   *  sections matched. "none": nothing. "empty": the query is too short to search menus. */
  kind: "empty" | "match" | "typo" | "category" | "none";
  did_you_mean: string | null;
  /** Matching lines grouped by item name; cheapest first. */
  groups: { name: string; lines: MenuHit[] }[];
  /** Lines shown (capped) and lines that matched in total. */
  shown: number;
  total: number;
  origin: { lat: number; lng: number } | null;
};

/** StatCan comparison for the item (pipeline only). */
export type StatcanInfo = {
  kind: "same_item" | "ingredients";
  value: number;
  geo: string | null;
  ref_month: string | null;
  note: string | null;
};

export type PricesResponse = {
  item: Item;
  /** The origin walk minutes were measured from (rounded to 4 decimals), or null if none was sent. */
  origin: { lat: number; lng: number } | null;
  /** Over non-benchmark outlets with an official price. */
  n_outlets: number;
  campus_median: number | null;
  rows: PriceRow[];
  /** The grocery baseline (Save-On-Foods Wesbrook), when it has the item. Never in `rows`. */
  grocery: { location_id: string; name: string; price: number; updated_at: string | null } | null;
  bc: StatcanInfo | null;
  price_source_used: "live" | "pipeline";
  computed_at: string | null;
};

/** Every error response: one plain sentence for the user. */
export type ApiError = { error: string };

export type Vote = "yes" | "no" | "unsure";

/** POST /api/vote. `recorded` is false when nothing changed (already voted, or no longer pending). */
export type VoteResult = { status: "pending" | "official" | "rejected"; confirmations: number; recorded: boolean };
