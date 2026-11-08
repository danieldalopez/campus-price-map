// Forgiving item search. docs/SPEC.md section 7 ("Search").
//
// "Redbull", "red-bull" and "rdbull" all find Red Bull: both sides are normalised, aliases come from
// `items.aliases`, and small typos are tolerated. Matching order: exact (name or alias), prefix, contains,
// category words, then typos (Damerau-Levenshtein distance 1 for 4 to 7 letters, 2 for 8 or more).
//
// No imports on purpose: tests/search.test.ts runs this file directly with Node's built-in TypeScript
// support (`node --test`), so it must be plain, erasable TypeScript with nothing to resolve.

export type SearchItem = {
  id: string;
  name: string;
  size: string;
  category: string;
  aliases: readonly string[];
};

export type SearchResult<T extends SearchItem> =
  /** The query is blank (or only punctuation). */
  | { kind: "empty"; items: [] }
  /** Exact, prefix, contains or category matches, best first. */
  | { kind: "match"; items: T[] }
  /** Only typo matches: show "Did you mean <didYouMean.name>?" as the first result. */
  | { kind: "typo"; items: T[]; didYouMean: T }
  /** Nothing matched: show the item tiles with "We don't track that yet". */
  | { kind: "none"; items: [] };

/** Lowercase, strip accents, drop everything that isn't a letter or a digit. "Red-Bull" -> "redbull". */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Damerau-Levenshtein distance (optimal string alignment: insertions, deletions, substitutions and
 * swaps of two neighbouring letters each cost 1).
 */
export function damerauLevenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** How many typos a query of this many letters may have: 0 under 4, 1 for 4 to 7, 2 for 8 or more. */
export function typoBudget(length: number): number {
  if (length >= 8) return 2;
  if (length >= 4) return 1;
  return 0;
}

/**
 * Words that mean a whole category (besides the category's own name and words). "coffee" lists every hot
 * drink and cold coffee (I08 to I12).
 */
const CATEGORY_WORDS: Record<string, readonly string[]> = {
  coffee: ["Hot drinks", "Cold coffee"],
  energy: ["Energy drinks"],
  energydrink: ["Energy drinks"],
  drink: ["Energy drinks", "Soft drinks", "Water", "Hot drinks", "Cold coffee"],
  softdrink: ["Soft drinks"],
  hotdrink: ["Hot drinks"],
  snack: ["Snacks"],
  lunch: ["Lunch grab and go"],
  breakfast: ["Breakfast and bakery"],
  bakery: ["Breakfast and bakery"],
  fruit: ["Fruit"],
};

/** Contains matches need at least this many letters, so "a" doesn't list everything. */
const MIN_CONTAINS = 3;

const TIER = { exact: 0, prefix: 1, contains: 2, category: 3 } as const;

type Keys = { names: string[]; category: string; categoryWords: string[] };

function keysFor(item: SearchItem): Keys {
  const names = [item.name, `${item.name} ${item.size}`, ...item.aliases].map(normalise).filter(Boolean);
  return {
    names: [...new Set(names)],
    category: normalise(item.category),
    categoryWords: item.category.split(/\s+/).map(normalise).filter(Boolean),
  };
}

/** A plural "s" is dropped for category words: "snacks" and "drinks" work like "snack" and "drink". */
function singular(q: string): string {
  return q.length > 3 && q.endsWith("s") ? q.slice(0, -1) : q;
}

/** 0 exact, 1 prefix, 2 contains, 3 category; null if none of these. */
function rank(q: string, item: SearchItem, keys: Keys): number | null {
  if (keys.names.some((k) => k === q)) return TIER.exact;
  if (keys.names.some((k) => k.startsWith(q))) return TIER.prefix;
  if (q.length >= MIN_CONTAINS && keys.names.some((k) => k.includes(q))) return TIER.contains;

  const word = singular(q);
  const cat = keys.category;
  if (cat === q || cat.startsWith(q) || (q.length >= MIN_CONTAINS && cat.includes(q))) return TIER.category;
  if (keys.categoryWords.some((w) => w === q || singular(w) === word)) return TIER.category;
  if ((CATEGORY_WORDS[q] ?? CATEGORY_WORDS[word])?.includes(item.category)) return TIER.category;
  return null;
}

/** Smallest typo distance between the query and the item's name or aliases. */
function typoDistance(q: string, keys: Keys, budget: number): number {
  let best = Infinity;
  for (const k of keys.names) {
    // Lengths differing by more than the budget can't be within it; skip the work.
    if (Math.abs(k.length - q.length) > budget) continue;
    best = Math.min(best, damerauLevenshtein(q, k));
  }
  return best;
}

/**
 * Search `items` (kept in the order given for ties, e.g. most bought first).
 * Returns the matches best first, or the typo matches with a "Did you mean", or nothing.
 */
export function searchItems<T extends SearchItem>(query: string, items: readonly T[]): SearchResult<T> {
  const q = normalise(query);
  if (!q) return { kind: "empty", items: [] };

  const ranked: { item: T; score: number; order: number }[] = [];
  const typos: { item: T; distance: number; order: number }[] = [];
  const budget = typoBudget(q.length);

  items.forEach((item, order) => {
    const keys = keysFor(item);
    const score = rank(q, item, keys);
    if (score !== null) {
      ranked.push({ item, score, order });
      return;
    }
    if (budget > 0) {
      const distance = typoDistance(q, keys, budget);
      if (distance <= budget) typos.push({ item, distance, order });
    }
  });

  if (ranked.length > 0) {
    ranked.sort((a, b) => a.score - b.score || a.order - b.order);
    return { kind: "match", items: ranked.map((r) => r.item) };
  }
  if (typos.length > 0) {
    typos.sort((a, b) => a.distance - b.distance || a.order - b.order);
    const found = typos.map((t) => t.item);
    return { kind: "typo", items: found, didYouMean: found[0] };
  }
  return { kind: "none", items: [] };
}

/** Split `items.aliases` ("redbull|red bull|rb") into a list. */
export function parseAliases(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean);
}
