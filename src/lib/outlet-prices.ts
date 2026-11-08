// Every tracked item one outlet sells, for GET /api/outlet/[id]. docs/SPEC.md sections 7 and 8. Server only.
//
// Same source rules as /api/prices (src/lib/prices.ts):
//   live      current_prices, bands from item_medians, no chips or nearest cheaper.
//   pipeline  serving.price_comparisons (Databricks), with chips, nearest cheaper and estimates.
// Pending reports, stock and "just confirmed" always come from the live views.
// An item is listed if the outlet carries it (`carries`), has a price for it, or has a pending report.

import { loadOutlets, toItem, type ItemRow } from "./catalog";
import { query } from "./db";
import { pctVsMedian, priceBand } from "./pricing";
import { choosePriceSource } from "./serving";
import type { Band, OutletItemRow, OutletResponse, PriceSource, Stock } from "./types";
import { iso, num, text } from "./validate";

type Options = { locationId: string; deviceId: string | undefined };

/** Columns every row query returns: the item, plus live pending and stock. */
type BaseRow = ItemRow & {
  pending_price_id: string | null;
  pending_price: string | null;
  pending_device_id: string | null;
  stock: Stock;
};

// Live CTEs shared by both queries. $1 is the location id.
const LIVE_CTES = `
  cp as (select item_id, price, source, confirmations, updated_at from current_prices where location_id = $1),
  pp as (select item_id, price_id, price, device_id from pending_prices where location_id = $1),
  st as (select item_id, stock from stock_status where location_id = $1),
  ca as (select item_id from carries where location_id = $1)`;

const BASE_COLUMNS = `
  i.id, i.name, i.size, i.volume_ml, i.category, i.image, i.aliases,
  pp.price_id as pending_price_id, pp.price as pending_price, pp.device_id as pending_device_id,
  coalesce(st.stock, 'in_stock') as stock`;

const BASE_JOINS = `
  left join cp on cp.item_id = i.id
  left join pp on pp.item_id = i.id
  left join st on st.item_id = i.id
  left join ca on ca.item_id = i.id`;

function baseRow(r: BaseRow, deviceId: string | undefined) {
  const pendingPrice = num(r.pending_price);
  const pendingId = num(r.pending_price_id);
  return {
    item: toItem(r),
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
  n_outlets: string | null;
  campus_median: string | null;
};

async function liveItems({ locationId, deviceId }: Options): Promise<OutletItemRow[]> {
  const rows = await query<LiveRow>(
    "reader",
    `with ${LIVE_CTES}
     select ${BASE_COLUMNS}, cp.price, cp.source, cp.confirmations, cp.updated_at,
            m.n_outlets, m.campus_median
     from items i
     ${BASE_JOINS}
     left join item_medians m on m.item_id = i.id
     where cp.item_id is not null or pp.item_id is not null or ca.item_id is not null
     order by i.id`,
    [locationId],
  );
  return rows.map((r) => {
    const price = num(r.price);
    return {
      ...baseRow(r, deviceId),
      price,
      source: price === null ? null : r.source,
      confirmations: num(r.confirmations) ?? 0,
      updated_at: price === null ? null : iso(r.updated_at),
      band: price === null ? null : priceBand(price, num(r.campus_median), num(r.n_outlets) ?? 0),
      pct_vs_median: price === null ? null : pctVsMedian(price, num(r.campus_median)),
      chip: null,
      nearest_cheaper: null,
      just_confirmed: null,
      estimate: null,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Pipeline (serving.price_comparisons)
// ---------------------------------------------------------------------------------------------------------

type PipelineRow = BaseRow & {
  pc_item_id: string | null;
  price: string | null;
  source: PriceSource | null;
  confirmations: string | null;
  updated_at: Date | string | null;
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

const BANDS: readonly string[] = ["good", "average", "high"];
const isBand = (b: string | null): b is Band => b !== null && BANDS.includes(b);

/** A live official price counts as "just confirmed" only if it is newer than the pipeline's row. */
const JUST_CONFIRMED_SLACK_MS = 1_000;

async function pipelineItems({ locationId, deviceId }: Options): Promise<OutletItemRow[]> {
  const rows = await query<PipelineRow>(
    "reader",
    `with pc as (select * from serving.price_comparisons where location_id = $1),
     ${LIVE_CTES}
     select ${BASE_COLUMNS},
            pc.item_id as pc_item_id,
            pc.price, pc.source, pc.confirmations, pc.updated_at,
            pc.band, pc.pct_vs_median, pc.chip,
            pc.nearest_cheaper_location_id, nl.name as nearest_cheaper_name,
            pc.nearest_cheaper_price, pc.nearest_cheaper_walk_min,
            pc.est_low, pc.est_high,
            cp.price as live_price, cp.updated_at as live_updated_at
     from items i
     left join pc on pc.item_id = i.id
     left join locations nl on nl.id = pc.nearest_cheaper_location_id
     ${BASE_JOINS}
     where pc.item_id is not null or cp.item_id is not null or pp.item_id is not null or ca.item_id is not null
     order by i.id`,
    [locationId],
  );

  return rows.map((r) => {
    const price = r.pc_item_id !== null ? num(r.price) : null;
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
      ...baseRow(r, deviceId),
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
  });
}

/** The outlet and its items, or null if there's no such outlet. A pipeline failure falls back to live. */
export async function loadOutletPage(options: Options): Promise<OutletResponse | null> {
  const outlet = (await loadOutlets()).find((o) => o.id === options.locationId);
  if (!outlet) return null;

  const choice = await choosePriceSource();
  if (choice.use === "pipeline") {
    try {
      const items = await pipelineItems(options);
      return { outlet, items, price_source_used: "pipeline", computed_at: choice.computedAt };
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      console.warn(`[outlet] pipeline read failed, using live prices${typeof code === "string" ? ` (${code})` : ""}`);
    }
  }
  const items = await liveItems(options);
  return { outlet, items, price_source_used: "live", computed_at: null };
}
