// Prices for one item at every outlet, for GET /api/prices. docs/SPEC.md section 8. Server only.
//
// Two sources for official prices, chosen by choosePriceSource():
//   live      current_prices, bands from item_medians (src/lib/pricing.ts), no chips or StatCan.
//   pipeline  serving.price_comparisons (Databricks), with chips, nearest cheaper, estimates and StatCan.
// Pending reports, stock and "just confirmed" always come from the live views.
//
// The column-to-field mapping (liveFields, pipelineFields, liveExtras) is shared with the Outlet page
// (src/lib/outlet-data.ts), which reads the same views for every item at one outlet.

import { query } from "./db";
import { walkMinutes, type LatLng } from "./geo";
import { pctVsMedian, priceBand } from "./pricing";
import { choosePriceSource } from "./serving";
import type {
  Band,
  Item,
  LocationPrecision,
  PriceFields,
  PriceRow,
  PriceSource,
  PricesResponse,
  StatcanInfo,
  Stock,
} from "./types";
import { isVote, iso, num, text } from "./validate";

type Options = { item: Item; origin: LatLng | null; deviceId: string | undefined };

// ---------------------------------------------------------------------------------------------------------
// Shared with the Outlet page: what one (item, outlet) row looks like, whichever way it was queried.
// ---------------------------------------------------------------------------------------------------------

/** Live pending report and stock for one item at one outlet. */
export type LiveExtraCols = {
  pending_price_id: string | null;
  pending_price: string | null;
  pending_device_id: string | null;
  /** This device's vote on the pending report, if any (`$2` is the device id). */
  pending_my_vote: string | null;
  stock: Stock;
};

/** The live official price (current_prices) plus the item's campus median (item_medians). */
export type LivePriceCols = {
  price: string | null;
  source: PriceSource | null;
  confirmations: string | null;
  updated_at: Date | null;
};

/** serving.price_comparisons columns the app reads, plus the live price for "just confirmed". */
export type PipelinePriceCols = {
  /** Non-null when the pipeline has a row for this pair. */
  pc_key: string | null;
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
  est_low: string | null;
  est_high: string | null;
  live_price: string | null;
  live_updated_at: Date | null;
};

/** Live CTE bodies, filtered by `$1` on `key` ("item_id" for Results, "location_id" for the Outlet page). */
export function liveCtes(key: "item_id" | "location_id"): string {
  const other = key === "item_id" ? "location_id" : "item_id";
  return `
  cp as (select ${other} as k, price, source, confirmations, updated_at from current_prices where ${key} = $1),
  pp as (select ${other} as k, price_id, price, device_id from pending_prices where ${key} = $1),
  st as (select ${other} as k, stock from stock_status where ${key} = $1)`;
}

/** Pending and stock columns; needs `pp` and `st` from liveCtes joined on `k`, and the device id (or null) as `$2`. */
export const LIVE_EXTRA_COLUMNS = `
  pp.price_id as pending_price_id, pp.price as pending_price, pp.device_id as pending_device_id,
  (select v.vote from price_votes v where v.price_id = pp.price_id and v.device_id = $2::text) as pending_my_vote,
  coalesce(st.stock, 'in_stock') as stock`;

/** The pipeline columns PipelinePriceCols reads; needs `pc`, `nl` (nearest cheaper outlet) and `cp`. */
export const PIPELINE_COLUMNS = `
  pc.price, pc.source, pc.confirmations, pc.updated_at, pc.n_outlets, pc.campus_median,
  pc.band, pc.pct_vs_median, pc.chip,
  pc.nearest_cheaper_location_id, nl.name as nearest_cheaper_name,
  pc.nearest_cheaper_price, pc.nearest_cheaper_walk_min,
  pc.est_low, pc.est_high,
  cp.price as live_price, cp.updated_at as live_updated_at`;

/** Pending report (whether this device made it is decided here, so other devices' ids never leave) and stock. */
export function liveExtras(r: LiveExtraCols, deviceId: string | undefined): Pick<PriceFields, "stock" | "pending"> {
  const pendingPrice = num(r.pending_price);
  const pendingId = num(r.pending_price_id);
  return {
    stock: r.stock,
    pending:
      pendingPrice !== null && pendingId !== null
        ? {
            price_id: pendingId,
            price: pendingPrice,
            mine: deviceId !== undefined && r.pending_device_id === deviceId,
            my_vote: isVote(r.pending_my_vote) ? r.pending_my_vote : null,
          }
        : null,
  };
}

type PriceOnly = Omit<PriceFields, "stock" | "pending">;

/**
 * Live mode: the official price, and its band from the campus median. No chip, nearest cheaper or estimate.
 * The grocery baseline (`benchmark`) never gets a band: it's never ranked.
 */
export function liveFields(r: LivePriceCols, median: number | null, nOutlets: number, benchmark = false): PriceOnly {
  const price = num(r.price);
  return {
    price,
    source: price === null ? null : r.source,
    confirmations: num(r.confirmations) ?? 0,
    updated_at: price === null ? null : iso(r.updated_at),
    band: price === null || benchmark ? null : priceBand(price, median, nOutlets),
    pct_vs_median: price === null || benchmark ? null : pctVsMedian(price, median),
    chip: null,
    nearest_cheaper: null,
    just_confirmed: null,
    estimate: null,
  };
}

const BANDS: readonly string[] = ["good", "average", "high"];
const isBand = (b: string | null): b is Band => b !== null && BANDS.includes(b);

/** A live official price counts as "just confirmed" only if it is newer than the pipeline's row. */
const JUST_CONFIRMED_SLACK_MS = 1_000;

/** Pipeline mode: price, band, chip, nearest cheaper and estimate from Databricks; "just confirmed" from live. */
export function pipelineFields(r: PipelinePriceCols): PriceOnly {
  const inPipeline = r.pc_key !== null;
  const price = inPipeline ? num(r.price) : null;
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

  return {
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
  };
}

/** Log why a pipeline read failed (the code only), then the caller falls back to live (rule 10). */
export function logPipelineFallback(route: string, err: unknown) {
  const code = (err as { code?: unknown } | null)?.code;
  console.warn(`[${route}] pipeline read failed, using live prices${typeof code === "string" ? ` (${code})` : ""}`);
}

// ---------------------------------------------------------------------------------------------------------
// One item at every outlet
// ---------------------------------------------------------------------------------------------------------

/** Columns every row query returns: the outlet, plus live pending and stock. */
type BaseRow = LiveExtraCols & {
  location_id: string;
  name: string;
  area: string | null;
  address: string | null;
  hours: string | null;
  lat: number;
  lng: number;
  is_benchmark: boolean;
  location_precision: LocationPrecision;
};

const BASE_COLUMNS = `
  l.id as location_id, l.name, l.area, l.address, l.hours, l.lat, l.lng, l.is_benchmark, l.location_precision,
  ${LIVE_EXTRA_COLUMNS}`;

const BASE_JOINS = `
  left join pp on pp.k = l.id
  left join st on st.k = l.id`;

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
  return {
    outlet,
    walk_min: origin ? walkMinutes(origin, outlet) : null,
    ...liveExtras(r, deviceId),
  };
}

// Live ------------------------------------------------------------------------------------------------------

type LiveRow = BaseRow & LivePriceCols;

async function livePrices({ item, origin, deviceId }: Options): Promise<PricesResponse> {
  const [rows, medians] = await Promise.all([
    query<LiveRow>(
      "reader",
      `with ${liveCtes("item_id")}
       select ${BASE_COLUMNS}, cp.price, cp.source, cp.confirmations, cp.updated_at
       from locations l
       left join cp on cp.k = l.id
       ${BASE_JOINS}
       where cp.k is not null or pp.k is not null`,
      [item.id, deviceId ?? null],
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
    out.push({ ...baseRow(r, origin, deviceId), ...liveFields(r, median, nOutlets) });
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

// Pipeline (serving.price_comparisons) ----------------------------------------------------------------------

type PipelineRow = BaseRow &
  PipelinePriceCols & {
    statcan_kind: string | null;
    statcan_value: string | null;
    statcan_geo: string | null;
    statcan_ref_month: string | null;
    statcan_note: string | null;
  };

async function pipelinePrices({ item, origin, deviceId }: Options, computedAt: string): Promise<PricesResponse> {
  const rows = await query<PipelineRow>(
    "reader",
    `with pc as (select * from serving.price_comparisons where item_id = $1),
     ${liveCtes("item_id")}
     select ${BASE_COLUMNS},
            pc.location_id as pc_key,
            ${PIPELINE_COLUMNS},
            pc.statcan_kind, pc.statcan_value, pc.statcan_geo, pc.statcan_ref_month, pc.statcan_note
     from locations l
     left join pc on pc.location_id = l.id
     left join locations nl on nl.id = pc.nearest_cheaper_location_id
     left join cp on cp.k = l.id
     ${BASE_JOINS}
     where pc.location_id is not null or cp.k is not null or pp.k is not null`,
    [item.id, deviceId ?? null],
  );

  let nOutlets = 0;
  let median: number | null = null;
  let grocery: PricesResponse["grocery"] = null;
  let bc: StatcanInfo | null = null;
  const out: PriceRow[] = [];

  for (const r of rows) {
    const fields = pipelineFields(r);
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
      const groceryPrice = fields.price ?? num(r.live_price);
      if (groceryPrice !== null) {
        grocery = { location_id: r.location_id, name: r.name, price: groceryPrice, updated_at: iso(r.updated_at) };
      }
      continue;
    }

    out.push({ ...baseRow(r, origin, deviceId), ...fields });
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
      logPipelineFallback("prices", err);
    }
  }
  return livePrices(options);
}
