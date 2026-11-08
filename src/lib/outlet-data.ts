// Everything the Outlet page shows, for GET /api/outlet/[id]. docs/SPEC.md sections 7 and 8. Server only.
//
// Tracked items: the same source selection as /api/prices (section 8). Pipeline: price, band, chip and
// nearest cheaper from serving.price_comparisons. Live: current_prices, bands from item_medians, no chip or
// nearest cheaper. Pending reports, stock and "just confirmed" are always live. The column mapping is the
// one Results uses (src/lib/prices.ts), so both pages say the same thing about the same price.
//
// An item is listed if the outlet carries it (`carries`), has a price for it, or has a pending report.
//
// Full menu: every menu_items line for the outlet, from the cached campus menu (src/lib/menu.ts).

import { shownSize } from "./item-size";
import { loadOutlet } from "./catalog";
import { query } from "./db";
import { dealFor, hasDeal } from "./deals";
import { groupByCategory, loadCampusMenu } from "./menu";
import {
  LIVE_EXTRA_COLUMNS,
  PIPELINE_COLUMNS,
  liveCtes,
  liveExtras,
  liveFields,
  logPipelineFallback,
  pipelineFields,
  type LiveExtraCols,
  type LivePriceCols,
  type PipelinePriceCols,
} from "./prices";
import { parseAliases } from "./search";
import { choosePriceSource } from "./serving";
import type { Item, Outlet, OutletItemRow, OutletResponse } from "./types";
import { num, text } from "./validate";

type ItemCols = {
  item_id: string;
  item_name: string;
  size: string;
  volume_ml: number | null;
  category: string;
  image: string | null;
  aliases: string | null;
};

// `k` in the live CTEs is the item id here (they're filtered on location_id = $1).
const ITEM_COLUMNS = `
  i.id as item_id, i.name as item_name, i.size, i.volume_ml, i.category, i.image, i.aliases,
  ${LIVE_EXTRA_COLUMNS}`;

// What the outlet sells, even without a price yet ("No confirmed price yet", or an estimate in pipeline mode).
const CARRIES_CTE = `ca as (select item_id as k from carries where location_id = $1)`;

const ITEM_JOINS = `
  left join pp on pp.k = i.id
  left join st on st.k = i.id
  left join lc on lc.k = i.id
  left join ca on ca.k = i.id`;

function toItem(r: ItemCols): Item {
  return {
    id: r.item_id,
    name: r.item_name,
    size: shownSize(r.item_id, r.size),
    category: r.category,
    image: text(r.image),
    volume_ml: num(r.volume_ml),
    // The stored size stays searchable ("drip coffee small") now that the shown one reads differently.
    aliases: [...parseAliases(r.aliases), `${r.item_name} ${r.size}`],
  };
}

type LiveRow = ItemCols & LiveExtraCols & LivePriceCols & { n_outlets: string | null; campus_median: string | null };

async function liveItems(outlet: Outlet, deviceId: string | undefined): Promise<OutletItemRow[]> {
  const rows = await query<LiveRow>(
    "reader",
    `with ${liveCtes("location_id")}, ${CARRIES_CTE}
     select ${ITEM_COLUMNS}, cp.price, cp.source, cp.confirmations, cp.updated_at, m.n_outlets, m.campus_median
     from items i
     left join cp on cp.k = i.id
     left join item_medians m on m.item_id = i.id
     ${ITEM_JOINS}
     where cp.k is not null or pp.k is not null or ca.k is not null
     order by i.id`,
    [outlet.id, deviceId ?? null],
  );
  return rows.map((r) => ({
    item: toItem(r),
    ...liveFields(r, num(r.campus_median), num(r.n_outlets) ?? 0, outlet.is_benchmark),
    ...liveExtras(r, deviceId),
  }));
}

type PipelineRow = ItemCols & LiveExtraCols & PipelinePriceCols;

async function pipelineItems(outlet: Outlet, deviceId: string | undefined): Promise<OutletItemRow[]> {
  const rows = await query<PipelineRow>(
    "reader",
    `with pc as (select * from serving.price_comparisons where location_id = $1),
     ${liveCtes("location_id")}, ${CARRIES_CTE}
     select ${ITEM_COLUMNS}, pc.item_id as pc_key, ${PIPELINE_COLUMNS}
     from items i
     left join pc on pc.item_id = i.id
     left join locations nl on nl.id = pc.nearest_cheaper_location_id
     left join cp on cp.k = i.id
     ${ITEM_JOINS}
     where pc.item_id is not null or cp.k is not null or pp.k is not null or ca.k is not null
     order by i.id`,
    [outlet.id, deviceId ?? null],
  );
  return rows.map((r) => ({ item: toItem(r), ...pipelineFields(r), ...liveExtras(r, deviceId) }));
}

/** Multi-buy deals (data/deals.csv), each compared with the cheapest single price at any other outlet. */
async function addDeals(locationId: string, items: OutletItemRow[]): Promise<OutletItemRow[]> {
  return Promise.all(
    items.map(async (row) => {
      if (!(await hasDeal(row.item.id, locationId))) return { ...row, deal: null };
      const [m] = await query<{ min: string | null }>(
        "reader",
        `select min(c.price) as min from current_prices c join locations l on l.id = c.location_id
         where c.item_id = $1 and c.location_id <> $2 and not l.is_benchmark`,
        [row.item.id, locationId],
      );
      return { ...row, deal: await dealFor(row.item.id, locationId, row.price, num(m?.min)) };
    }),
  );
}

/** The outlet page, or null if there is no outlet with this id. */
export async function loadOutletPage(id: string, deviceId: string | undefined): Promise<OutletResponse | null> {
  const outlet = await loadOutlet(id);
  if (!outlet) return null;

  const [choice, menu] = await Promise.all([choosePriceSource(), loadCampusMenu()]);
  const lines = menu.byOutlet.get(outlet.id) ?? [];

  let items: OutletItemRow[] | null = null;
  let computedAt: string | null = null;
  if (choice.use === "pipeline") {
    try {
      items = await pipelineItems(outlet, deviceId);
      computedAt = choice.computedAt;
    } catch (err) {
      logPipelineFallback("outlet", err);
    }
  }
  const source = items === null ? "live" : "pipeline";
  items ??= await liveItems(outlet, deviceId);
  items = await addDeals(outlet.id, items);

  return {
    outlet,
    items,
    menu: groupByCategory(lines),
    price_source_used: source,
    computed_at: computedAt,
  };
}
