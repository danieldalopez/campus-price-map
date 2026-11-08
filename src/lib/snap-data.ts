// Items and outlets for the Snap flow and the Gemini prompt, read from Lakebase as app_reader. Server only.

import { query } from "./db";
import type { SnapItem, SnapOutlet } from "./snap";

// The 23 items have fixed ids and change only when the seed does, so one read per server instance is
// enough for 10 minutes. That keeps a photo read to the rate limit queries plus the Gemini call.
const ITEMS_TTL_MS = 10 * 60_000;
let itemsCache: { at: number; items: SnapItem[] } | null = null;

export async function loadSnapItems(): Promise<SnapItem[]> {
  if (itemsCache && Date.now() - itemsCache.at < ITEMS_TTL_MS) return itemsCache.items;
  const items = await query<SnapItem>("reader", "select id, name, size, category from items order by id");
  itemsCache = { at: Date.now(), items };
  return items;
}

export async function loadSnapOutlets(): Promise<SnapOutlet[]> {
  return query<SnapOutlet>("reader", "select id, name, area, lat, lng from locations order by name");
}
