// Shapes and limits shared by the Snap flow (docs/SPEC.md sections 7, 8 and 9a), the browser and the API.
// No server imports here: the /snap page imports this file too.

/** Prices outside this range are refused (guardrail G3). */
export const PRICE_MIN = 0.25;
export const PRICE_MAX = 25;

/**
 * The server rejects an `image` base64 string longer than this (G5). Vercel refuses request bodies over
 * 4.5 MB, so this leaves room for the JSON around it. The phone aims for 2.5 MB (src/lib/image.ts).
 */
export const IMAGE_MAX_BASE64 = 3_500_000;

/** One tracked item, as the Snap screen and the Gemini prompt need it. */
export type SnapItem = { id: string; name: string; size: string; category: string };

/** One outlet for the "Where are you?" picker. */
export type SnapOutlet = { id: string; name: string; area: string | null; lat: number; lng: number };

export type PhotoKind = "price_tag" | "menu_board" | "product" | "receipt" | "other";

/** What `/api/read-photo` returns: Gemini's reading after the server's checks (section 9a). */
export type PhotoDraft = {
  kind: PhotoKind;
  outlet_hint: string | null;
  /** Only the 23 tracked ids, sorted by confidence, one per item. `price` is null when none was visible. */
  items: { item_id: string; price: number | null; size_text: string | null; confidence: number }[];
  /** Things on the photo we don't track. */
  unmatched: { text: string; price: number | null }[];
};

export type PriceStatus = "pending" | "official" | "rejected";

/** What `/api/save-price` returns. */
export type SaveResult = { id: number; status: PriceStatus };

/** `{ error: "plain sentence for the user" }` (section 8). */
export type ApiError = { error: string };

/** Cents-exact: 3.4899999 → 3.49. */
export function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export function priceInRange(n: number): boolean {
  return Number.isFinite(n) && n >= PRICE_MIN && n <= PRICE_MAX;
}

/** "3.25", "$3.25", "3,25" → 3.25. Anything else → null. */
export function parsePriceInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$\s*/, "").replace(",", ".");
  if (!/^\d{1,2}(\.\d{0,2})?$|^\.\d{1,2}$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? roundToCents(n) : null;
}
