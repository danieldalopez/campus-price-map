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

// ---------------------------------------------------------------------------------------------------------
// Menu search: every menu line on campus, tracked or not (GET /api/menu-search, docs/SPEC.md section 7).
//
// Same normalisation, plural rule and typo budget as the item search above, applied word by word, because
// menu names are longer ("Pork Shoyu Ramen"): a query matches the start of a word, so "tea" finds "Green
// Tea" but not "Steak". Order: item names (word start, then contains for 4+ letters), then typos in item
// names ("Did you mean ramen?"), then the menu's own section names ("Sushi"), cheapest first in each.
// ---------------------------------------------------------------------------------------------------------

/** What menu search needs from a line. */
export type MenuSearchLine = { item: string; variant: string | null; category: string; price: number };

type MenuKeys = {
  /** The whole item name, normalised: "porkshoyuramen". */
  name: string;
  /** Item name words as written ("Ramen") and normalised ("ramen"), in step. */
  rawWords: string[];
  words: string[];
  /** Item name plus variant words, for multi-word queries ("latte 16oz"). */
  wordsWithVariant: string[];
  category: string;
  categoryWords: string[];
};

/** Lines with their search keys worked out once (the server keeps this for every line on campus). */
export type MenuIndex<T extends MenuSearchLine> = { entries: { line: T; keys: MenuKeys; order: number }[] };

export type MenuSearchResult<T extends MenuSearchLine> =
  /** The query is shorter than MENU_MIN_QUERY letters or digits. */
  | { kind: "empty"; lines: []; total: 0 }
  /** "match": item names matched. "category": only the menu's section names did. */
  | { kind: "match" | "category"; lines: T[]; total: number }
  /** Only near misses: show "Did you mean <didYouMean>?". */
  | { kind: "typo"; lines: T[]; total: number; didYouMean: string }
  | { kind: "none"; lines: []; total: 0 };

/** About 30 lines is what fits under the search field without becoming a wall. */
export const MENU_SEARCH_LIMIT = 30;
/** One letter would match half the campus. */
export const MENU_MIN_QUERY = 2;
/** Contains matches inside a word ("cake" in "Cheesecake") need at least this many letters. */
const MENU_MIN_CONTAINS = 4;

/** "Pork Shoyu Ramen (Large)" -> ["Pork", "Shoyu", "Ramen", "Large"]. Apostrophes stay inside a word. */
function splitWords(text: string): string[] {
  return text.split(/[^\p{L}\p{N}']+/u).filter((w) => normalise(w) !== "");
}

function menuKeys(line: MenuSearchLine): MenuKeys {
  const rawWords = splitWords(line.item);
  const words = rawWords.map(normalise);
  return {
    name: normalise(line.item),
    rawWords,
    words,
    wordsWithVariant: [...words, ...splitWords(line.variant ?? "").map(normalise)],
    category: normalise(line.category),
    categoryWords: splitWords(line.category).map(normalise),
  };
}

/** Work out every line's search keys once. Keeps the order given (it breaks price ties). */
export function prepareMenu<T extends MenuSearchLine>(lines: readonly T[]): MenuIndex<T> {
  return { entries: lines.map((line, order) => ({ line, keys: menuKeys(line), order })) };
}

/** A query word matches a word that starts with it, or with its singular ("cookies" finds "Cookie"). */
function startsAnyWord(queryWord: string, words: readonly string[]): boolean {
  const one = singular(queryWord);
  return words.some((w) => w.startsWith(queryWord) || w.startsWith(one));
}

/** 0: every query word starts a word of the name (the variant counts for multi-word queries). 1: the whole
 *  query is inside the name (4+ letters). null: neither. */
function menuRank(q: string, queryWords: readonly string[], k: MenuKeys): number | null {
  if (k.name.startsWith(q)) return 0;
  if (queryWords.length === 1) {
    if (startsAnyWord(queryWords[0], k.words)) return 0;
  } else if (
    queryWords.every((qw) => startsAnyWord(qw, k.wordsWithVariant)) &&
    queryWords.some((qw) => startsAnyWord(qw, k.words))
  ) {
    return 0;
  }
  if (q.length >= MENU_MIN_CONTAINS && k.name.includes(q)) return 1;
  return null;
}

/** The closest name word within the typo budget of `queryWord`, as written, with its distance. */
function closestWord(queryWord: string, k: MenuKeys): { word: string; distance: number } | null {
  const budget = typoBudget(queryWord.length);
  if (budget === 0) return null;
  let best: { word: string; distance: number } | null = null;
  for (let i = 0; i < k.words.length; i++) {
    const w = k.words[i];
    if (Math.abs(w.length - queryWord.length) > budget) continue;
    const distance = damerauLevenshtein(queryWord, w);
    if (distance <= budget && (best === null || distance < best.distance)) {
      best = { word: k.rawWords[i].toLowerCase(), distance };
    }
  }
  return best;
}

/** Every query word starts a word of the name or is a near miss of one, and at least one is a near miss.
 *  Returns what each query word was taken to mean, or null. */
function menuTypo(queryWords: readonly string[], k: MenuKeys): { meant: string[]; distance: number } | null {
  const meant: string[] = [];
  let distance = 0;
  for (const qw of queryWords) {
    if (startsAnyWord(qw, k.words)) {
      meant.push(qw);
      continue;
    }
    const near = closestWord(qw, k);
    if (!near) return null;
    meant.push(near.word);
    distance += near.distance;
  }
  return distance > 0 ? { meant, distance } : null;
}

function inCategory(q: string, queryWords: readonly string[], k: MenuKeys): boolean {
  if (queryWords.every((qw) => startsAnyWord(qw, k.categoryWords))) return true;
  return q.length >= MENU_MIN_CONTAINS && k.category.includes(q);
}

type Ranked<T> = { line: T; rank: number; order: number };

function cheapestFirst<T extends MenuSearchLine>(a: Ranked<T>, b: Ranked<T>): number {
  return a.rank - b.rank || a.line.price - b.line.price || a.order - b.order;
}

/**
 * Search every menu line. Returns at most `limit` lines, best tier first and cheapest first within it, plus
 * how many matched in total.
 */
export function searchMenu<T extends MenuSearchLine>(
  query: string,
  index: MenuIndex<T>,
  limit = MENU_SEARCH_LIMIT,
): MenuSearchResult<T> {
  const q = normalise(query);
  if (q.length < MENU_MIN_QUERY) return { kind: "empty", lines: [], total: 0 };
  const queryWords = splitWords(query).map(normalise);
  if (queryWords.length === 0) queryWords.push(q);

  const finish = (found: Ranked<T>[]) => found.sort(cheapestFirst).slice(0, limit).map((r) => r.line);

  // 1. Item names.
  const named: Ranked<T>[] = [];
  for (const { line, keys, order } of index.entries) {
    const rank = menuRank(q, queryWords, keys);
    if (rank !== null) named.push({ line, rank, order });
  }
  if (named.length > 0) return { kind: "match", lines: finish(named), total: named.length };

  // 2. Near misses in item names. The suggestion is what most of the closest lines were taken to mean.
  const typos: Ranked<T>[] = [];
  const votes = new Map<string, { count: number; distance: number }>();
  for (const { line, keys, order } of index.entries) {
    const typo = menuTypo(queryWords, keys);
    if (!typo) continue;
    typos.push({ line, rank: typo.distance, order });
    const meant = typo.meant.join(" ");
    const v = votes.get(meant) ?? { count: 0, distance: typo.distance };
    votes.set(meant, { count: v.count + 1, distance: Math.min(v.distance, typo.distance) });
  }
  if (typos.length > 0) {
    const [didYouMean] = [...votes.entries()].sort(
      (a, b) => a[1].distance - b[1].distance || b[1].count - a[1].count || a[0].localeCompare(b[0]),
    )[0];
    return { kind: "typo", lines: finish(typos), total: typos.length, didYouMean };
  }

  // 3. The menu's own section names ("Sushi", "Breakfast Pastries").
  const sections: Ranked<T>[] = [];
  for (const { line, keys, order } of index.entries) {
    if (inCategory(q, queryWords, keys)) sections.push({ line, rank: 0, order });
  }
  if (sections.length > 0) return { kind: "category", lines: finish(sections), total: sections.length };

  return { kind: "none", lines: [], total: 0 };
}

/**
 * Group lines by item name (case, accents and punctuation ignored), keeping their order: the group whose
 * best line comes first comes first. The group is named after its first line.
 */
export function groupByItemName<T extends { item: string }>(lines: readonly T[]): { name: string; lines: T[] }[] {
  const groups = new Map<string, { name: string; lines: T[] }>();
  for (const line of lines) {
    const key = normalise(line.item);
    const group = groups.get(key);
    if (group) group.lines.push(line);
    else groups.set(key, { name: line.item.trim(), lines: [line] });
  }
  return [...groups.values()];
}
