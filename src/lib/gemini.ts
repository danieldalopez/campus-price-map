// Reads a campus photo with Gemini (docs/SPEC.md section 9a). Server only: the key never reaches the browser.
//
// One call reads any photo (price tag, menu board, product, receipt). Gemini only suggests (G1): the server
// keeps the 23 tracked ids (G2) and prices from $0.25 to $25 (G3), and the student confirms every line.
// The image is passed straight to Gemini and dropped: never stored, never logged (G8).

import { ApiError as GeminiApiError, GoogleGenAI, Type, type Schema } from "@google/genai";
import { z } from "zod";
import { priceInRange, roundToCents, type PhotoDraft, type PhotoKind, type SnapItem } from "./snap";

/** GEMINI_API_KEY isn't set. */
export class GeminiConfigError extends Error {}
/** Gemini didn't answer within the time limit, twice. */
export class GeminiTimeoutError extends Error {}
/** Gemini answered with an error or with something that isn't the draft. */
export class GeminiReadError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

/** Each attempt gets 20 s. The first call to a cold free-tier key has taken longer, so a timeout retries once. */
const TIMEOUT_MS = 20_000;

/** Swapping models is this one env var (section 5). */
function model(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
}

let client: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiConfigError("GEMINI_API_KEY is not set");
  // SDK 3 defaults to the v1 API, where the `gemini-flash-latest` alias and JSON mode schemas aren't served
  // (404). v1beta is what AI Studio keys and scripts/gemini-check.mjs use.
  client = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });
  return client;
}

export type PhotoHint = "tag" | "product" | "receipt";

const HINT_WORDS: Record<PhotoHint, string> = { tag: "a price tag", product: "a product", receipt: "a receipt" };

/** The section 9a prompt, word for word, with the item list from the `items` table. */
export function buildPrompt(items: readonly SnapItem[], hint?: PhotoHint): string {
  const list = items.map((i) => `${i.id}: ${i.name}, ${i.size}`).join("\n");
  const prompt = `You read photos taken by UBC students at campus food outlets.
1. Classify the photo: price_tag, menu_board, product, receipt, or other.
2. Return every item from ITEM LIST that is visible, with the price shown for it.
ITEM LIST (id: name, size):
${list}
Rules:
- Use only item_id values from ITEM LIST. Anything else goes in "unmatched".
- price is the number printed in CAD for that item, before tax. If no price is visible, use null. Never guess a price.
- For receipts, use the amount paid per item and copy the store name into outlet_hint.
- For menu boards with sizes, pick the size that matches ITEM LIST (small or medium).
- confidence is 0 to 1 for the item match.`;
  // Only when the caller says what the photo is (the receipt sheet in Step 8). The Snap page sends no hint.
  return hint ? `${prompt}\nThe student says this photo shows ${HINT_WORDS[hint]}.` : prompt;
}

const KINDS: readonly PhotoKind[] = ["price_tag", "menu_board", "product", "receipt", "other"];

/** The section 9a schema, as Gemini's JSON mode response schema. */
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    kind: { type: Type.STRING, enum: [...KINDS] },
    outlet_hint: { type: Type.STRING, nullable: true },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          item_id: { type: Type.STRING },
          price: { type: Type.NUMBER, nullable: true },
          size_text: { type: Type.STRING, nullable: true },
          confidence: { type: Type.NUMBER },
        },
        required: ["item_id", "price", "confidence"],
        propertyOrdering: ["item_id", "price", "size_text", "confidence"],
      },
    },
    unmatched: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { text: { type: Type.STRING }, price: { type: Type.NUMBER, nullable: true } },
        required: ["text"],
        propertyOrdering: ["text", "price"],
      },
    },
  },
  required: ["kind", "items", "unmatched"],
  propertyOrdering: ["kind", "outlet_hint", "items", "unmatched"],
};

// What Gemini sends back, read leniently: a malformed line is dropped, not the whole reading.
const maybeNumber = z.number().nullish().catch(null);
const maybeText = z.string().nullish().catch(null);
const rawDraftSchema = z.object({
  kind: z.enum(KINDS).catch("other"),
  outlet_hint: maybeText,
  items: z.array(z.unknown()).catch([]),
  unmatched: z.array(z.unknown()).catch([]),
});
const rawItemSchema = z.object({
  item_id: z.string(),
  price: maybeNumber,
  size_text: maybeText,
  confidence: maybeNumber,
});
const rawUnmatchedSchema = z.object({ text: z.string(), price: maybeNumber });

const cleanPrice = (p: number | null | undefined): number | null =>
  typeof p === "number" && priceInRange(p) ? roundToCents(p) : null;
const cleanText = (t: string | null | undefined, max: number): string | null => {
  const s = (t ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return s === "" ? null : s;
};

/** Section 9a, after Gemini: drop ids not in the table, drop prices outside $0.25 to $25, sort by confidence. */
export function cleanDraft(raw: unknown, allowedIds: ReadonlySet<string>): PhotoDraft {
  const parsed = rawDraftSchema.safeParse(raw);
  if (!parsed.success) throw new GeminiReadError("Gemini's answer wasn't a draft");
  const draft = parsed.data;

  const best = new Map<string, PhotoDraft["items"][number]>();
  for (const line of draft.items) {
    const r = rawItemSchema.safeParse(line);
    if (!r.success) continue;
    const id = r.data.item_id.trim().toUpperCase();
    if (!allowedIds.has(id)) continue;
    const confidence = Math.min(1, Math.max(0, r.data.confidence ?? 0));
    const item = { item_id: id, price: cleanPrice(r.data.price), size_text: cleanText(r.data.size_text, 40), confidence };
    // One card per item: keep the most confident line, preferring one with a price on a tie.
    const prev = best.get(id);
    if (!prev || confidence > prev.confidence || (confidence === prev.confidence && prev.price === null)) {
      best.set(id, item);
    }
  }

  const unmatched: PhotoDraft["unmatched"] = [];
  for (const line of draft.unmatched) {
    const r = rawUnmatchedSchema.safeParse(line);
    const text = r.success ? cleanText(r.data.text, 60) : null;
    if (r.success && text) unmatched.push({ text, price: cleanPrice(r.data.price) });
    if (unmatched.length === 8) break;
  }

  return {
    kind: draft.kind,
    outlet_hint: cleanText(draft.outlet_hint, 80),
    items: [...best.values()].sort((a, b) => b.confidence - a.confidence),
    unmatched,
  };
}

/** One Gemini call, cut off after TIMEOUT_MS. Returns the raw JSON text. */
async function callOnce(imageBase64: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  try {
    const response = await gemini().models.generateContent({
      model: model(),
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: "image/jpeg", data: imageBase64 } }, { text: prompt }],
        },
      ],
      // JSON mode with the response schema. Temperature, top_p and top_k stay at the model's defaults.
      config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, abortSignal: controller.signal },
    });
    const text = response.text;
    if (!text) throw new GeminiReadError("Gemini returned no text");
    return text;
  } catch (err) {
    if (timedOut) throw new GeminiTimeoutError(`No answer within ${TIMEOUT_MS / 1000} s`);
    if (err instanceof GeminiReadError || err instanceof GeminiConfigError) throw err;
    if (err instanceof GeminiApiError) throw new GeminiReadError(`Gemini API error ${err.status}`, err.status);
    throw new GeminiReadError(err instanceof Error ? err.name : "Gemini call failed");
  } finally {
    clearTimeout(timer);
  }
}

/** Read one photo. Retries once if the first attempt times out. */
export async function readPhoto(
  imageBase64: string,
  items: readonly SnapItem[],
  hint?: PhotoHint,
): Promise<PhotoDraft> {
  const prompt = buildPrompt(items, hint);
  let text: string;
  try {
    text = await callOnce(imageBase64, prompt);
  } catch (err) {
    if (!(err instanceof GeminiTimeoutError)) throw err;
    text = await callOnce(imageBase64, prompt);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GeminiReadError("Gemini's answer wasn't JSON");
  }
  return cleanDraft(json, new Set(items.map((i) => i.id)));
}
