/**
 * The 21 tracked items, fixed IDs, from SPEC section 6. Step 1 stand-in until
 * /api/items (Step 4); the sheet's Items tab stays the source of truth.
 * `emoji` is a placeholder until the AI Studio stickers land in public/items
 * (Step 10). It is decorative only: the name and size are always shown as text.
 */
export type Item = {
  id: string;
  name: string;
  size: string;
  category: string;
  emoji: string;
};

export const ITEMS: Item[] = [
  { id: "I01", name: "Red Bull", size: "250 ml can", category: "Energy drinks", emoji: "⚡" },
  { id: "I02", name: "Monster Energy", size: "473 ml can", category: "Energy drinks", emoji: "⚡" },
  { id: "I03", name: "Celsius", size: "355 ml can", category: "Energy drinks", emoji: "⚡" },
  { id: "I04", name: "Coca-Cola", size: "355 ml can", category: "Soft drinks", emoji: "🥤" },
  { id: "I05", name: "Coca-Cola", size: "591 ml bottle", category: "Soft drinks", emoji: "🥤" },
  { id: "I06", name: "Bottled water", size: "500 ml", category: "Water", emoji: "💧" },
  { id: "I07", name: "Sparkling water", size: "355 ml can", category: "Water", emoji: "🫧" },
  { id: "I08", name: "Drip coffee", size: "small", category: "Hot drinks", emoji: "☕" },
  { id: "I09", name: "Drip coffee", size: "medium", category: "Hot drinks", emoji: "☕" },
  { id: "I10", name: "Latte", size: "medium", category: "Hot drinks", emoji: "☕" },
  { id: "I11", name: "Tea", size: "medium", category: "Hot drinks", emoji: "🍵" },
  { id: "I12", name: "Iced coffee", size: "medium", category: "Cold coffee", emoji: "🧊" },
  { id: "I13", name: "Bagel with cream cheese", size: "1 bagel", category: "Breakfast and bakery", emoji: "🥯" },
  { id: "I14", name: "Muffin", size: "1 muffin", category: "Breakfast and bakery", emoji: "🧁" },
  { id: "I15", name: "Pre-made sandwich", size: "1 pack", category: "Lunch grab and go", emoji: "🥪" },
  { id: "I16", name: "Pre-made wrap", size: "1 wrap", category: "Lunch grab and go", emoji: "🌯" },
  { id: "I17", name: "Sushi roll pack", size: "1 pack", category: "Lunch grab and go", emoji: "🍣" },
  { id: "I18", name: "Protein bar", size: "1 bar", category: "Snacks", emoji: "🍫" },
  { id: "I19", name: "Chips", size: "single serve", category: "Snacks", emoji: "🥔" },
  { id: "I20", name: "Banana", size: "1 banana", category: "Fruit", emoji: "🍌" },
  { id: "I21", name: "Apple", size: "1 apple", category: "Fruit", emoji: "🍎" },
];

/** Home tile order: most bought first (SPEC section 7), then the rest by ID. */
const MOST_BOUGHT = ["I01", "I09", "I10", "I06", "I15", "I19"];

export const ITEMS_BY_POPULARITY: Item[] = [
  ...MOST_BOUGHT.map((id) => ITEMS.find((i) => i.id === id)).filter(
    (i): i is Item => i !== undefined,
  ),
  ...ITEMS.filter((i) => !MOST_BOUGHT.includes(i.id)),
];
