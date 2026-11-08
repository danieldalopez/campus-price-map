// Prices for one item at every outlet, for GET /api/prices. docs/SPEC.md section 8. Server only.
//
// Two sources for official prices, chosen by choosePriceSource():
//   live      current_prices, bands from item_medians (src/lib/pricing.ts), no chips or StatCan.
//   pipeline  serving.price_comparisons (Databricks), with chips, nearest cheaper, estimates and StatCan.
// Pending reports, stock and "just confirmed" always come from the live views.

import { query } from "./db";
import { walkMinutes, type LatLng } from "./geo";
import { pctVsMedian, priceBand } from "./pricing";
import { choosePriceSource } from "./serving";
import type {
  Band,
  Item,
  LocationPrecision,
  PriceRow,
  PriceSource,
  PricesResponse,
  StatcanInfo,
  Stock,
} from "./types";
import { iso, num, text } from "./validate";

type Options = { item: Item; origin: LatLng | null; deviceId: string | undefined };

/** Columns every row query returns: the outlet, plus live pending and stock. */
type BaseRow = {
  location_id: string;
  name: string;
  area: string | null;
  address: string | null;
  hours: string | null;
  lat: number;
  lng: number;
  is_benchmark: boolean;
  location_precision: LocationPrecision;
  pending_price_id: string | null;
  pending_price: string | null;
  pending_device_id: string | null;
  stock: Stock;
};

// Live CTEs shared by both queries. $1 is the item id.
const LIVE_CTES = `
  cp as (select location_id, price, source, confirmations, updated_at from current_prices where item_id = $1),
  pp as (select location_id, price_id, price, device_id from pending_prices where item_id = $1),
  st as (select location_id, stock from stock_status where item_id = $1)`;

const BASE_COLUMNS = `
  l.id as location_id, l.name, l.area, l.address, l.hours, l.lat, l.lng, l.is_benchmark, l.location_precision,
  pp.price_id as pending_price_id, pp.price as pending_price, pp.device_id as pending_device_id,
  coalesce(st.stock, 'in_stock') as stock`;

const BASE_JOINS = `
  left join pp on pp.location_id = l.id
  left join st on st.location_id = l.id`;

function baseRow(r: BaseRow, origin: LatLng | null, deviceId: string | undefined) {
  const outlet = {
    id: r.location_id,
    name: r.name,
    area: text(r.area),
    address: text(r.address),
    hours: text(r.hours),
    lat: Number(r.lat),
    lng: Number(r.lng),
    location_precision: r.location_precision,
  };
  const pendingPrice = num(r.pending_price);
  const pendingId = num(r.pending_price_id);
  return {
    outlet,
    walk_min: origin ? walkMinutes(origin, outlet) : null,
    stock: r.stock,
    // Whether this device made the report is decided here, so other devices' ids never leave the server.
    pending:
      pendingPrice !== null && pendingId !== null
        ? { price_id: pendingId, price: pendingPrice, mine: deviceId !== undefined && r.pending_device_id === deviceId }
        : null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------------------------------------

type LiveRow = BaseRow & {
  price: string | null;
  source: PriceSource | null;
  confirmations: string | null;
  updated_at: Date | null;
};

async function livePrices({ item, origin, deviceId }: Options): Promise<PricesResponse> {
  const [rows, medians] = await Promise.all([
    query<LiveRow>(
      "reader",
      `with ${LIVE_CTES}
       select ${BASE_COLUMNS}, cp.price, cp.source, cp.confirmations, cp.updated_at
       from locations l
       left join cp on cp.location_id = l.id
       ${BASE_JOINS}
       where cp.location_id is not null or pp.location_id is not null`,
      [item.id],
    ),
    query<{ n_outlets: string; campus_median: string | null }>(
      "reader",
      "select n_outlets, campus_median from item_medians where item_id = $1",
      [item.id],
    ),
  ]);

  const nOutlets = num(medians[0]?.n_outlets) ?? 0;
  const median = num(medians[0]?.campus_median);

  let grocery: PricesResponse["grocery"] = null;
  const out: PriceRow[] = [];
  for (const r of rows) {
    const price = num(r.price);
    if (r.is_benchmark) {
      // The grocery baseline is never ranked or listed; it's only the "vs grocery" line.
      if (price !== null) grocery = { location_id: r.location_id, name: r.name, price, updated_at: iso(r.updated_at) };
      continue;
    }
    out.push({
      ...baseRow(r, origin, deviceId),
      price,
      source: price === null ? null : r.source,
      confirmations: num(r.confirmations) ?? 0,
      updated_at: price === null ? null : iso(r.updated_at),
      band: price === null ? null : priceBand(price, median, nOutlets),
      pct_vs_median: price === null ? null : pctVsMedian(price, median),
      chip: null,
      nearest_cheaper: null,
      just_confirmed: null,
      estimate: null,
    });
  }

  return {
    item,
    origin,
    n_outlets: nOutlets,
    campus_median: median,
    rows: out,
    grocery,
    bc: null,
    price_source_used: "live",
    computed_at: null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Pipeline (serving.price_comparisons)
// ---------------------------------------------------------------------------------------------------------

type PipelineRow = BaseRow & {
  pc_location_id: string | null;
  price: string | null;
  source: PriceSource | null;
  confirmations: string | null;
  updated_at: Date | string | null;
  n_outlets: string | null;
  campus_median: string | null;
  band: string | null;
  pct_vs_median: string | null;
  chip: string | null;
  nearest_cheaper_location_id: string | null;
  nearest_cheaper_name: string | null;
  nearest_cheaper_price: string | null;
  nearest_cheaper_walk_min: string | null;
  grocery_price: string | null;
  est_low: string | null;
  est_high: string | null;
  statcan_kind: string | null;
  statcan_value: string | null;
  statcan_geo: string | null;
  statcan_ref_month: string | null;
  statcan_note: string | null;
  computed_at: Date | string | null;
  live_price: string | null;
  live_updated_at: Date | null;
};

const BANDS: readonly string[] = ["good", "average", "high"];
const isBand = (b: string | null): b is Band => b !== null && BANDS.includes(b);

/** A live official price counts as "just confirmed" only if it is newer than the pipeline's row. */
const JUST_CONFIRMED_SLACK_MS = 1_000;

async function pipelinePrices({ item, origin, deviceId }: Options, computedAt: string): Promise<PricesResponse> {
  const rows = await query<PipelineRow>(
    "reader",
    `with pc as (select * from serving.price_comparisons where item_id = $1),
     ${LIVE_CTES}
     select ${BASE_COLUMNS},
            pc.location_id as pc_location_id,
            pc.price, pc.source, pc.confirmations, pc.updated_at, pc.n_outlets, pc.campus_median,
            pc.band, pc.pct_vs_median, pc.chip,
            pc.nearest_cheaper_location_id, nl.name as nearest_cheaper_name,
            pc.nearest_cheaper_price, pc.nearest_cheaper_walk_min, pc.grocery_price,
            pc.est_low, pc.est_high,
            pc.statcan_kind, pc.statcan_value, pc.statcan_geo, pc.statcan_ref_month, pc.statcan_note,
            pc.computed_at,
            cp.price as live_price, cp.updated_at as live_updated_at
     from locations l
     left join pc on pc.location_id = l.id
     left join locations nl on nl.id = pc.nearest_cheaper_location_id
     left join cp on cp.location_id = l.id
     ${BASE_JOINS}
     where pc.location_id is not null or cp.location_id is not null or pp.location_id is not null`,
    [item.id],
  );

  let nOutlets = 0;
  let median: number | null = null;
  let grocery: PricesResponse["grocery"] = null;
  let bc: StatcanInfo | null = null;
  const out: PriceRow[] = [];

  for (const r of rows) {
    const inPipeline = r.pc_location_id !== null;
    const price = inPipeline ? num(r.price) : null;
    nOutlets = Math.max(nOutlets, num(r.n_outlets) ?? 0);
    median ??= num(r.campus_median);
    if (!bc && (r.statcan_kind === "same_item" || r.statcan_kind === "ingredients")) {
      const value = num(r.statcan_value);
      if (value !== null) {
        bc = {
          kind: r.statcan_kind,
          value,
          geo: text(r.statcan_geo),
          ref_month: text(r.statcan_ref_month),
          note: text(r.statcan_note),
        };
      }
    }

    if (r.is_benchmark) {
      const groceryPrice = price ?? num(r.live_price);
      if (groceryPrice !== null) {
        grocery = { location_id: r.location_id, name: r.name, price: groceryPrice, updated_at: iso(r.updated_at) };
      }
      continue;
    }

    const updatedAt = price === null ? null : iso(r.updated_at);
    const livePrice = num(r.live_price);
    const liveAt = iso(r.live_updated_at);
    const newer =
      livePrice !== null &&
      liveAt !== null &&
      (updatedAt === null || Date.parse(liveAt) > Date.parse(updatedAt) + JUST_CONFIRMED_SLACK_MS);

    const estLow = num(r.est_low);
    const estHigh = num(r.est_high);
    const nearestPrice = num(r.nearest_cheaper_price);

    out.push({
      ...baseRow(r, origin, deviceId),
      price,
      source: price === null ? null : r.source,
      confirmations: num(r.confirmations) ?? 0,
      updated_at: updatedAt,
      band: price !== null && isBand(r.band) ? r.band : null,
      pct_vs_median: price === null ? null : num(r.pct_vs_median),
      chip: price === null ? null : text(r.chip),
      nearest_cheaper:
        price !== null && r.nearest_cheaper_location_id && nearestPrice !== null
          ? {
              location_id: r.nearest_cheaper_location_id,
              name: text(r.nearest_cheaper_name),
              price: nearestPrice,
              walk_min: num(r.nearest_cheaper_walk_min),
            }
          : null,
      just_confirmed: newer && livePrice !== null && liveAt !== null ? { price: livePrice, updated_at: liveAt } : null,
      estimate: price === null && estLow !== null && estHigh !== null ? { low: estLow, high: estHigh } : null,
    });
  }

  return {
    item,
    origin,
    n_outlets: nOutlets,
    campus_median: median,
    rows: out,
    grocery,
    bc,
    price_source_used: "pipeline",
    computed_at: computedAt,
  };
}

/** Section 8's source selection, then the rows. A pipeline failure falls back to live (rule 10). */
export async function loadPrices(options: Options): Promise<PricesResponse> {
  const choice = await choosePriceSource();
  if (choice.use === "pipeline") {
    try {
      return await pipelinePrices(options, choice.computedAt);
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      console.warn(`[prices] pipeline read failed, using live prices${typeof code === "string" ? ` (${code})` : ""}`);
    }
  }
  return livePrices(options);
}
