// Placeholder art until the AI Studio stickers land in public/items (Step 10). Decorative only: every tile
// and header also shows the item's name and size as text, and these are always aria-hidden.

import type { Item } from "./types";

const BY_WORD: [RegExp, string][] = [
  [/sparkling/i, "🫧"],
  [/\btea\b/i, "🍵"],
  [/iced|cold brew/i, "🧊"],
  [/bagel/i, "🥯"],
  [/muffin/i, "🧁"],
  [/wrap/i, "🌯"],
  [/sushi/i, "🍣"],
  [/chips/i, "🥔"],
  [/banana/i, "🍌"],
  [/apple/i, "🍎"],
];

const BY_CATEGORY: Record<string, string> = {
  "Energy drinks": "⚡",
  "Soft drinks": "🥤",
  Water: "💧",
  "Hot drinks": "☕",
  "Cold coffee": "🧊",
  "Breakfast and bakery": "🥐",
  "Lunch grab and go": "🥪",
  Snacks: "🍫",
  Fruit: "🍎",
};

export function itemEmoji(item: Pick<Item, "name" | "category">): string {
  for (const [pattern, emoji] of BY_WORD) if (pattern.test(item.name)) return emoji;
  return BY_CATEGORY[item.category] ?? "🏷️";
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
