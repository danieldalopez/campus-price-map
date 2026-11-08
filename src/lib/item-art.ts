// Sticker art made in Google AI Studio (SPEC section 9b), converted by scripts/optimize-assets.mjs.
// Decorative only: every tile and header also shows the item's name and size as text, so the art is aria-hidden.

import type { Item } from "./types";

/** Items without their own sticker borrow a close one: the other Red Bull size, and a second protein bar. */
const ART_ALIAS: Record<string, string> = { I22: "I01", I23: "I18" };

export function itemArtSrc(item: Pick<Item, "id">): string {
  return `/items/${ART_ALIAS[item.id] ?? item.id}.webp`;
}

/** Home tile order: most bought first (SPEC section 7), then the rest in id order. */
const MOST_BOUGHT = ["I01", "I08", "I10", "I06", "I15", "I19"];

export function byPopularity<T extends Pick<Item, "id">>(items: readonly T[]): T[] {
  const rank = (id: string) => {
    const i = MOST_BOUGHT.indexOf(id);
    return i === -1 ? MOST_BOUGHT.length : i;
  };
  return [...items].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}
