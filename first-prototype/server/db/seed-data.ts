// Sample data for the prototype. Prices, hours and coordinates are illustrative,
// not real quotes from these outlets. Barcodes in the 200-299 EAN prefix range are
// reserved for in-store use, so they never collide with real products; Red Bull
// 250 ml uses its real EAN so a physical can scans.

import type { Category, Item, Outlet } from '../../shared/types';

export const OUTLETS: Outlet[] = [
  { id: 'the-nest', name: 'The Nest', area: 'AMS Student Nest, main floor', lat: 49.26665, lng: -123.25003, hours: 'Mon–Fri 7am–9pm · Sat–Sun 9am–6pm' },
  { id: 'harvest-market', name: 'Harvest Market', area: 'AMS Student Nest, lower level', lat: 49.26641, lng: -123.24962, hours: 'Mon–Fri 8am–8pm · Sat–Sun 10am–6pm' },
  { id: 'intl-food-village', name: 'International Food Village', area: 'Student Union Blvd', lat: 49.26705, lng: -123.24905, hours: 'Mon–Fri 10am–7pm' },
  { id: 'mercante', name: 'Mercante', area: 'Ponderosa Commons', lat: 49.26452, lng: -123.25534, hours: 'Daily 7:30am–10pm' },
  { id: 'ikes-cafe', name: "Ike's Café", area: 'Irving K. Barber Learning Centre', lat: 49.26774, lng: -123.25262, hours: 'Mon–Fri 7:30am–6pm' },
  { id: 'university-village', name: 'University Village', area: 'University Blvd', lat: 49.26648, lng: -123.24228, hours: 'Daily 8am–11pm' },
  { id: 'wesbrook-village', name: 'Wesbrook Village', area: 'Wesbrook Mall', lat: 49.25562, lng: -123.23642, hours: 'Daily 7am–11pm' },
];

interface SeedItem extends Item {
  /** Typical campus price in cents; outlet prices vary around it. */
  baseCents: number;
}

const item = (
  id: string,
  name: string,
  size: string,
  category: Category,
  icon: string,
  baseCents: number,
  barcode: string | null,
): SeedItem => ({ id, name, size, category, icon, baseCents, barcode });

export const ITEMS: SeedItem[] = [
  item('red-bull-250', 'Red Bull', '250 ml can', 'energy', '⚡', 349, '9002490100070'),
  item('monster-473', 'Monster Energy', '473 ml can', 'energy', '⚡', 379, '2000000000017'),
  item('celsius-355', 'Celsius', '355 ml can', 'energy', '⚡', 369, '2000000000024'),
  item('coke-355', 'Coca-Cola', '355 ml can', 'drinks', '🥤', 179, '2000000000031'),
  item('coke-591', 'Coca-Cola', '591 ml bottle', 'drinks', '🥤', 289, '2000000000048'),
  item('water-591', 'Bottled water', '591 ml bottle', 'drinks', '💧', 219, '2000000000055'),
  item('sparkling-355', 'Sparkling water', '355 ml can', 'drinks', '🫧', 159, '2000000000062'),
  item('drip-12', 'Drip coffee', '12 oz', 'coffee', '☕', 239, null),
  item('latte-12', 'Latte', '12 oz', 'coffee', '☕', 489, null),
  item('americano-12', 'Americano', '12 oz', 'coffee', '☕', 349, null),
  item('chai-12', 'Chai latte', '12 oz', 'coffee', '🍵', 479, null),
  item('bagel-cc', 'Bagel with cream cheese', 'each', 'food', '🥯', 349, null),
  item('turkey-sandwich', 'Turkey sandwich', 'each', 'food', '🥪', 849, null),
  item('caesar-wrap', 'Chicken Caesar wrap', 'each', 'food', '🌯', 899, null),
  item('california-roll', 'California roll', '8 pieces', 'food', '🍣', 749, null),
  item('blueberry-muffin', 'Blueberry muffin', 'each', 'food', '🧁', 329, null),
  item('chips-40', "Potato chips", '40 g bag', 'snacks', '🥔', 199, '2000000000079'),
  item('clif-68', 'Clif Bar', '68 g', 'snacks', '🍫', 289, '2000000000086'),
  item('kind-40', 'KIND bar', '40 g', 'snacks', '🥜', 299, '2000000000093'),
  item('banana', 'Banana', 'each', 'snacks', '🍌', 79, null),
  item('apple', 'Apple', 'each', 'snacks', '🍎', 119, null),
];

/** Which outlets sell which categories (plus explicit extras/omissions). */
const SELLS: Record<string, { categories: Category[]; except?: string[]; also?: string[] }> = {
  'the-nest': { categories: ['energy', 'drinks', 'coffee', 'food', 'snacks'], except: ['banana'] },
  'harvest-market': { categories: ['energy', 'drinks', 'snacks', 'food'], except: ['bagel-cc', 'blueberry-muffin'], also: ['drip-12'] },
  'intl-food-village': { categories: ['drinks', 'food'], except: ['bagel-cc', 'blueberry-muffin', 'sparkling-355'] },
  mercante: { categories: ['coffee', 'drinks', 'food', 'snacks', 'energy'], except: ['california-roll', 'celsius-355'] },
  'ikes-cafe': { categories: ['coffee'], also: ['bagel-cc', 'blueberry-muffin', 'water-591', 'coke-355', 'clif-68', 'banana'] },
  'university-village': { categories: ['energy', 'drinks', 'snacks', 'food'], except: ['blueberry-muffin'], also: ['drip-12', 'latte-12'] },
  'wesbrook-village': { categories: ['energy', 'drinks', 'snacks', 'food'], also: ['drip-12', 'americano-12'] },
};

/** Outlet price multipliers: grocery-style outlets run cheaper, cafés pricier. */
const OUTLET_FACTOR: Record<string, number> = {
  'the-nest': 1.04,
  'harvest-market': 0.93,
  'intl-food-village': 0.97,
  mercante: 1.08,
  'ikes-cafe': 1.06,
  'university-village': 0.95,
  'wesbrook-village': 0.89,
};

/** Small deterministic per-pair noise so each item has its own winner. */
function jitter(itemId: string, outletId: string): number {
  let h = 2166136261;
  for (const ch of `${itemId}|${outletId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000 - 0.5; // -0.5 .. 0.5
}

/** Round to a shelf-looking price ending in 9 (or 5 for small amounts). */
function shelfPrice(cents: number): number {
  if (cents < 150) return Math.max(49, Math.round(cents / 5) * 5);
  return Math.round(cents / 10) * 10 - 1;
}

export interface SeedPrice {
  itemId: string;
  outletId: string;
  priceCents: number;
  confirmedBy: number;
  /** Minutes before seeding that the price was last confirmed. */
  ageMinutes: number;
}

export function seedPrices(): SeedPrice[] {
  const prices: SeedPrice[] = [];
  for (const outlet of OUTLETS) {
    const rule = SELLS[outlet.id];
    for (const it of ITEMS) {
      const sells =
        (rule.categories.includes(it.category) && !rule.except?.includes(it.id)) || rule.also?.includes(it.id);
      if (!sells) continue;
      const j = jitter(it.id, outlet.id);
      const cents = shelfPrice(it.baseCents * OUTLET_FACTOR[outlet.id] * (1 + j * 0.16));
      const ageSeed = Math.abs(Math.round(j * 10000));
      // Mostly fresh (minutes to days); a few are older than two weeks to show fading.
      const ageMinutes = ageSeed % 17 === 0 ? 60 * 24 * 20 : (ageSeed % 2880) + 12;
      prices.push({ itemId: it.id, outletId: outlet.id, priceCents: cents, confirmedBy: 1 + (ageSeed % 5), ageMinutes });
    }
  }
  return prices;
}

/** Seeded pending proposals from other (fictional) students, so confirm prompts appear in the demo. */
export const SEED_PROPOSALS: Array<{ itemId: string; outletId: string; deltaCents: number; studentId: string; required: number; reasons: string[]; ageMinutes: number }> = [
  { itemId: 'red-bull-250', outletId: 'the-nest', deltaCents: -20, studentId: 'seed-student-01', required: 2, reasons: ['Scanned item, new or changed price'], ageMinutes: 18 },
  { itemId: 'latte-12', outletId: 'mercante', deltaCents: 30, studentId: 'seed-student-02', required: 3, reasons: ['Typed price with no scan or receipt'], ageMinutes: 42 },
  { itemId: 'drip-12', outletId: 'harvest-market', deltaCents: -10, studentId: 'seed-student-03', required: 1, reasons: ['Receipt photo attached'], ageMinutes: 9 },
];

/** A seeded "possibly sold out" report. */
export const SEED_STOCK = [{ itemId: 'celsius-355', outletId: 'harvest-market', studentId: 'seed-student-04', ageMinutes: 15 }];

/** Sample "BC average" values for items with a genuine like-for-like match. Clearly flagged as sample data. */
export const BC_AVERAGES: Array<{ itemId: string; label: string; priceCents: number; refPeriod: string }> = [
  { itemId: 'coke-355', label: 'Soft drink, 355 ml can (BC average)', priceCents: 165, refPeriod: 'Sample period' },
  { itemId: 'water-591', label: 'Bottled water, 591 ml (BC average)', priceCents: 199, refPeriod: 'Sample period' },
  { itemId: 'red-bull-250', label: 'Energy drink, 250 ml can (BC average)', priceCents: 329, refPeriod: 'Sample period' },
];

/** Weekly search volume per item, for the "you just helped N students" thank you. */
export function seedWeeklySearches(itemId: string): number {
  const popular: Record<string, number> = { 'red-bull-250': 40, 'drip-12': 64, 'latte-12': 51, 'coke-355': 33, 'monster-473': 27 };
  return popular[itemId] ?? 8 + Math.round((jitter(itemId, 'searches') + 0.5) * 18);
}
