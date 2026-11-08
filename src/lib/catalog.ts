// Items and outlets from Lakebase, shaped for the API (docs/SPEC.md sections 6 and 8). Server only.

import { query } from "./db";
import { parseAliases } from "./search";
import { servingTableReadable } from "./serving";
import type { Item, LocationPrecision, Outlet, Tier, TierBasis } from "./types";
import { num, text } from "./validate";

type ItemRow = {
  id: string;
  name: string;
  size: string;
  volume_ml: number | null;
  category: string;
  image: string | null;
  aliases: string | null;
};

const ITEM_COLUMNS = "id, name, size, volume_ml, category, image, aliases";

function toItem(r: ItemRow): Item {
  return {
    id: r.id,
    name: r.name,
    size: r.size,
    category: r.category,
    image: text(r.image),
    volume_ml: num(r.volume_ml),
    aliases: parseAliases(r.aliases),
  };
}

export async function loadItems(): Promise<Item[]> {
  const rows = await query<ItemRow>("reader", `select ${ITEM_COLUMNS} from items order by id`);
  return rows.map(toItem);
}

export async function loadItem(id: string): Promise<Item | null> {
  const [row] = await query<ItemRow>("reader", `select ${ITEM_COLUMNS} from items where id = $1`, [id]);
  return row ? toItem(row) : null;
}

type LocationRow = {
  id: string;
  name: string;
  area: string | null;
  operator: string;
  type: string;
  address: string | null;
  hours: string | null;
  lat: number;
  lng: number;
  is_benchmark: boolean;
  location_precision: LocationPrecision;
};

type ScoreRow = { location_id: string; tier: string | null; tier_basis: string | null };

const TIERS: readonly string[] = ["$", "$$", "$$$"];
const isTier = (t: string | null): t is Tier => t !== null && TIERS.includes(t);
const isBasis = (b: string | null): b is TierBasis => b === "measured" || b === "estimated";

/** Tiers from serving.outlet_scores when the pipeline has synced it; otherwise every outlet shows "?". */
async function loadTiers(): Promise<Map<string, ScoreRow>> {
  if (!(await servingTableReadable("outlet_scores"))) return new Map();
  try {
    const rows = await query<ScoreRow>("reader", "select location_id, tier, tier_basis from serving.outlet_scores");
    return new Map(rows.map((r) => [r.location_id, r]));
  } catch {
    return new Map();
  }
}

export async function loadOutlets(): Promise<Outlet[]> {
  const [rows, tiers] = await Promise.all([
    query<LocationRow>(
      "reader",
      `select id, name, area, operator, type, address, hours, lat, lng, is_benchmark, location_precision
       from locations order by name`,
    ),
    loadTiers(),
  ]);
  return rows.map((r) => {
    const score = tiers.get(r.id);
    const tier = score && isTier(score.tier) && !r.is_benchmark ? score.tier : null;
    return {
      id: r.id,
      name: r.name,
      area: text(r.area),
      operator: r.operator,
      type: r.type,
      address: text(r.address),
      hours: text(r.hours),
      lat: Number(r.lat),
      lng: Number(r.lng),
      is_benchmark: r.is_benchmark,
      location_precision: r.location_precision,
      tier,
      tier_basis: tier && score && isBasis(score.tier_basis) ? score.tier_basis : null,
    };
  });
}
