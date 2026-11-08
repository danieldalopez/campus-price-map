// Gemini connection check. No dependencies (Node 20.6+ for --env-file).
//
//   node --env-file=.env.local scripts/gemini-check.mjs              text-only test
//   node --env-file=.env.local scripts/gemini-check.mjs tag.jpg      read a real price tag photo
//
// 1. Lists the Flash models this key can call, so GEMINI_MODEL can be checked.
// 2. Sends the read-photo prompt and JSON schema from docs/SPEC.md section 9a and prints the draft.
// The API key is sent in a header and never printed.

import { readFile } from "node:fs/promises";

const API = "https://generativelanguage.googleapis.com/v1beta";
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
const imagePath = process.argv[2];

if (!key) {
  console.error("GEMINI_API_KEY is not set. Add it to .env.local and run with --env-file=.env.local");
  process.exit(1);
}

const ITEMS = [
  ["I01", "Red Bull", "250 ml can"], ["I02", "Monster Energy", "473 ml can"], ["I03", "Celsius", "355 ml can"],
  ["I04", "Coca-Cola", "355 ml can"], ["I05", "Coca-Cola", "591 ml bottle"], ["I06", "Bottled water", "500 ml"],
  ["I07", "Sparkling water", "355 ml can"], ["I08", "Drip coffee", "small"], ["I09", "Drip coffee", "medium"],
  ["I10", "Latte", "medium"], ["I11", "Tea", "medium"], ["I12", "Iced coffee", "medium"],
  ["I13", "Bagel with cream cheese", "each"], ["I14", "Muffin", "each"], ["I15", "Pre-made sandwich", "each"],
  ["I16", "Pre-made wrap", "each"], ["I17", "Sushi roll pack", "each"], ["I18", "Protein bar", "one brand"],
  ["I19", "Chips", "single serve"], ["I20", "Banana", "each"], ["I21", "Apple", "each"],
];

const PROMPT = `You read photos taken by UBC students at campus food outlets.
1. Classify the photo: price_tag, menu_board, product, receipt, or other.
2. Return every item from ITEM LIST that is visible, with the price shown for it.
ITEM LIST (id: name, size):
${ITEMS.map(([id, name, size]) => `${id}: ${name}, ${size}`).join("\n")}
Rules:
- Use only item_id values from ITEM LIST. Anything else goes in "unmatched".
- price is the number printed in CAD for that item, before tax. If no price is visible, use null. Never guess a price.
- For receipts, use the amount paid per item and copy the store name into outlet_hint.
- For menu boards with sizes, pick the size that matches ITEM LIST (small or medium).
- confidence is 0 to 1 for the item match.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["price_tag", "menu_board", "product", "receipt", "other"] },
    outlet_hint: { type: "STRING", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          item_id: { type: "STRING" },
          price: { type: "NUMBER", nullable: true },
          size_text: { type: "STRING", nullable: true },
          confidence: { type: "NUMBER" },
        },
        required: ["item_id", "price", "confidence"],
      },
    },
    unmatched: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { text: { type: "STRING" }, price: { type: "NUMBER", nullable: true } },
        required: ["text"],
      },
    },
  },
  required: ["kind", "items", "unmatched"],
};

async function call(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.GEMINI_TIMEOUT_MS) || 20_000);
  try {
    const res = await fetch(`${API}/${path}`, {
      method: body ? "POST" : "GET",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status} ${json?.error?.status ?? ""}: ${json?.error?.message ?? "no message"}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// 1. Models
const list = await call("models?pageSize=200");
const flash = (list.models ?? [])
  .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /flash/i.test(m.name))
  .map((m) => m.name.replace("models/", ""));
console.log(`Key works. Flash models with generateContent (${flash.length}):`);
for (const name of flash) console.log(`  ${name === model ? "→" : " "} ${name}`);
if (!flash.includes(model)) {
  console.log(`\nGEMINI_MODEL "${model}" is not in that list. It may still be an alias; the next call will tell.`);
}
const imageModel = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
const imageModels = (list.models ?? []).map((m) => m.name.replace("models/", "")).filter((n) => /image/i.test(n));
console.log(`\nImage models listed for this key: ${imageModels.join(", ") || "none"}`);
console.log(
  imageModels.includes(imageModel)
    ? `GEMINI_IMAGE_MODEL "${imageModel}" is available (generating may still need billing).`
    : `GEMINI_IMAGE_MODEL "${imageModel}" is not listed. Set GEMINI_IMAGE_MODEL to one of the names above.`,
);

// 2. Read-photo call
const parts = [{ text: PROMPT }];
if (imagePath) {
  const bytes = await readFile(imagePath);
  const mime = /\.png$/i.test(imagePath) ? "image/png" : "image/jpeg";
  console.log(`\nSending ${imagePath} (${Math.round(bytes.length / 1024)} KB, ${Math.round((bytes.length * 4) / 3 / 1024)} KB as base64)`);
  parts.push({ inline_data: { mime_type: mime, data: bytes.toString("base64") } });
} else {
  parts.push({ text: "TEST WITHOUT A PHOTO. Treat this text as the photo: a shelf price tag that reads 'RED BULL ENERGY DRINK 250ML $3.49'." });
}

const started = Date.now();
const out = await call(`models/${model}:generateContent`, {
  contents: [{ role: "user", parts }],
  generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
});
const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
let draft;
try {
  draft = JSON.parse(text);
} catch {
  console.error("\nResponse was not valid JSON:\n", text.slice(0, 500));
  process.exit(1);
}

// Same server-side checks as /api/read-photo (G2, G3)
const ids = new Set(ITEMS.map(([id]) => id));
const kept = (draft.items ?? [])
  .filter((it) => ids.has(it.item_id) && (it.price == null || (it.price >= 0.25 && it.price <= 25)))
  .sort((a, b) => b.confidence - a.confidence);

console.log(`\n${model} answered in ${Date.now() - started} ms. Draft after allowlist and price checks:`);
console.log(JSON.stringify({ ...draft, items: kept }, null, 2));
if (out.usageMetadata) console.log(`\nTokens: ${out.usageMetadata.promptTokenCount} in, ${out.usageMetadata.candidatesTokenCount} out`);
