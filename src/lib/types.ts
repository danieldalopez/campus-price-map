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

/** One outlet that sells the item: an official price, a pending report, or (pipeline) an estimate. */
export type PriceRow = {
  outlet: RowOutlet;
  /** The official price. Null when the outlet has only a pending report or an estimate. */
  price: number | null;
  source: PriceSource | null;
  confirmations: number;
  updated_at: string | null;
  /** About N minutes from the origin the request gave (haversine x 1.3 / 80 m per min, rounded up). */
  walk_min: number | null;
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
  pending: { price_id: number; price: number; mine: boolean } | null;
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
