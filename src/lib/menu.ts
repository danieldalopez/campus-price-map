// Every menu line on campus (`menu_items`, tracked or not) with its outlet. docs/SPEC.md sections 6 and 7.
// Server only. Used by the Outlet page's "Full menu" and by GET /api/menu-search.
//
// Menus don't change while the app runs (app_writer can't write menu_items), so the whole table (about
// 1,700 lines) is loaded once per server instance, prepared for search, and kept for a few minutes.
// Concurrent requests share one load; a failed load isn't kept, so the next request tries again.

import { query } from "./db";
import { prepareMenu, type MenuIndex } from "./search";
import type { LocationPrecision, MenuCategory, MenuLine, PriceSource } from "./types";
import { num, text } from "./validate";

const CACHE_MS = 5 * 60_000;

/** A menu line plus what search results need about its outlet. */
export type CampusMenuLine = MenuLine & {
  location_id: string;
  category: string;
  outlet_name: string;
  area: string | null;
  lat: number;
  lng: number;
  is_benchmark: boolean;
  location_precision: LocationPrecision;
};

type Row = {
  id: string;
  location_id: string;
  category: string | null;
  item: string;
  variant: string | null;
  price: string;
  source: PriceSource;
  reported_on: string;
  item_ids: string;
  outlet_name: string;
  area: string | null;
  lat: number;
  lng: number;
  is_benchmark: boolean;
  location_precision: LocationPrecision;
};

export type CampusMenu = {
  index: MenuIndex<CampusMenuLine>;
  /** Each outlet's lines in menu order (the order they were read off the menu). */
  byOutlet: Map<string, CampusMenuLine[]>;
};

/**
 * `reported_on` is a date. As noon in Vancouver it formats as that same day in any time zone, so a server in
 * UTC and a phone in Vancouver agree on "Nov 7".
 */
function noonInVancouver(day: string): string {
  return `${day}T20:00:00.000Z`;
}

function toLine(r: Row): CampusMenuLine | null {
  const price = num(r.price);
  if (price === null) return null;
  return {
    id: Number(r.id),
    item: r.item.trim(),
    variant: text(r.variant?.trim()),
    price,
    source: r.source,
    reported_on: noonInVancouver(r.reported_on),
    item_ids: r.item_ids.split("|").map((s) => s.trim()).filter(Boolean),
    location_id: r.location_id,
    category: text(r.category?.trim()) ?? "Menu",
    outlet_name: r.outlet_name,
    area: text(r.area),
    lat: Number(r.lat),
    lng: Number(r.lng),
    is_benchmark: r.is_benchmark,
    location_precision: r.location_precision,
  };
}

async function load(): Promise<CampusMenu> {
  const rows = await query<Row>(
    "reader",
    // reported_on as text: pg would turn a date into midnight in the server's time zone.
    `select m.id, m.location_id, m.category, m.item, m.variant, m.price, m.source,
            m.reported_on::text as reported_on, m.item_ids,
            l.name as outlet_name, l.area, l.lat, l.lng, l.is_benchmark, l.location_precision
     from menu_items m
     join locations l on l.id = m.location_id
     order by l.name, m.id`,
  );
  const lines = rows.map(toLine).filter((l): l is CampusMenuLine => l !== null);
  const byOutlet = new Map<string, CampusMenuLine[]>();
  for (const line of lines) {
    const list = byOutlet.get(line.location_id);
    if (list) list.push(line);
    else byOutlet.set(line.location_id, [line]);
  }
  for (const list of byOutlet.values()) list.sort((a, b) => a.id - b.id);
  return { index: prepareMenu(lines), byOutlet };
}

let cached: { at: number; menu: CampusMenu } | null = null;
let loading: Promise<CampusMenu> | null = null;

/** Every menu line on campus, from memory when the copy is under 5 minutes old. */
export async function loadCampusMenu(): Promise<CampusMenu> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.menu;
  loading ??= load()
    .then((menu) => {
      cached = { at: Date.now(), menu };
      return menu;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** One outlet's menu, grouped by the menu's own sections, sections and lines in the order the menu lists them. */
export function groupByCategory(lines: readonly CampusMenuLine[]): MenuCategory[] {
  const groups = new Map<string, MenuLine[]>();
  for (const { id, item, variant, price, source, reported_on, item_ids, category } of lines) {
    const line: MenuLine = { id, item, variant, price, source, reported_on, item_ids };
    const list = groups.get(category);
    if (list) list.push(line);
    else groups.set(category, [line]);
  }
  return [...groups].map(([category, list]) => ({ category, lines: list }));
}
