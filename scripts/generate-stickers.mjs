// Generate the sticker art with the Gemini image API (docs/SPEC.md section 9b). No dependencies.
//
//   node --env-file=.env.local scripts/generate-stickers.mjs --only I01          1. make the style reference
//   node --env-file=.env.local scripts/generate-stickers.mjs                     2. everything else, styled like I01
//   node --env-file=.env.local scripts/generate-stickers.mjs --only I05 --force  redo one
//
// Writes PNGs to assets/raw/<name>.png (Step 10 converts them to 512 px WebP with sharp)
// and appends every prompt used to assets/PROMPTS.md for the Devpost.
// Existing PNGs are skipped unless --force. The API key is sent in a header and never printed.

import { readFile, writeFile, mkdir, appendFile, access } from "node:fs/promises";

const API = "https://generativelanguage.googleapis.com/v1beta";
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
const RAW = "assets/raw";
const REFERENCE = `${RAW}/I01.png`;

const args = process.argv.slice(2);
const force = args.includes("--force");
const onlyArg = args[args.indexOf("--only") + 1];
const only = args.includes("--only") && onlyArg ? new Set(onlyArg.split(",")) : null;

if (!key) {
  console.error("GEMINI_API_KEY is not set. Add it to .env.local and run with --env-file=.env.local");
  process.exit(1);
}

const MASTER = (subject) => `Die-cut vinyl sticker of ${subject}, centred, slight three-quarter view.
Thick white sticker border with a soft drop shadow.
Bold flat illustration, chunky black outlines, limited palette:
ink #1A1A1A, price-tag yellow #FFD23F, warm red #E4572E, teal #2A9D8F, cream #FFF8E7.
Light risograph grain, slight print misregistration.
No text, no letters, no logos, no brand marks.
Plain flat background #F4EEE2, nothing else in frame. Square.`;

// Generic on purpose: no real logos. The brand name lives in the UI text.
const SUBJECTS = [
  ["I01", "a slim tall energy drink can, blue and silver"],
  ["I02", "a tall wide energy drink can, black with a green stripe"],
  ["I03", "a slim energy drink can, white with a bright stripe"],
  ["I04", "a red soda can"],
  ["I05", "a red soda bottle"],
  ["I06", "a clear plastic water bottle with a blue cap"],
  ["I07", "a pastel sparkling water can with bubbles"],
  ["I08", "a small paper coffee cup with a lid and steam"],
  ["I09", "a medium paper coffee cup with a lid and steam"],
  ["I10", "a latte cup with a heart of foam"],
  ["I11", "a paper cup with a tea bag tag hanging out"],
  ["I12", "a clear iced coffee cup with ice and a straw"],
  ["I13", "a bagel with cream cheese"],
  ["I14", "a blueberry muffin"],
  ["I15", "a triangle sandwich in a plastic box"],
  ["I16", "a wrap cut in half"],
  ["I17", "a pack of sushi rolls in a clear box"],
  ["I18", "a protein bar half unwrapped"],
  ["I19", "a small bag of chips"],
  ["I20", "a banana"],
  ["I21", "a red apple"],
  ["logo", "a yellow price tag with a string, pinned to a folded paper map"],
  ["empty-map", "a folded paper map with a question mark pin"],
  ["pending", "an hourglass"],
  ["sold-out", "an empty shelf with a little sign (no text)"],
  ["savings", "a small pile of coins"],
  ["thanks", "a thumbs up hand"],
];

const exists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(name, subject, reference) {
  const prompt = reference
    ? `${MASTER(subject)}\nMatch the style of the attached sticker exactly: same border, outline weight, palette, grain and lighting. Only the subject changes.`
    : MASTER(subject);
  const parts = [{ text: prompt }];
  if (reference) parts.push({ inline_data: { mime_type: "image/png", data: reference.toString("base64") } });

  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    let res, json;
    try {
      res = await fetch(`${API}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
        }),
        signal: ctrl.signal,
      });
      json = await res.json().catch(() => ({}));
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      const img = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
      const data = img?.inlineData?.data ?? img?.inline_data?.data;
      if (!data) throw new Error(`no image in response (finishReason: ${json.candidates?.[0]?.finishReason ?? "unknown"})`);
      return { png: Buffer.from(data, "base64"), prompt };
    }

    const msg = `${res.status} ${json?.error?.status ?? ""}: ${json?.error?.message ?? "no message"}`;
    if (res.status === 429 && attempt < 3) {
      console.log(`  rate limited, waiting ${attempt * 20} s`);
      await sleep(attempt * 20_000);
      continue;
    }
    if (res.status === 429 || res.status === 403) {
      throw new Error(`${msg}\n  Image generation through the API usually needs billing on the key's Google Cloud project.\n  Turn billing on, or make the stickers in the AI Studio website instead.`);
    }
    if (res.status === 404) {
      throw new Error(`${msg}\n  Model "${model}" not found. Run scripts/gemini-check.mjs to list models, then set GEMINI_IMAGE_MODEL.`);
    }
    throw new Error(msg);
  }
}

await mkdir(RAW, { recursive: true });
const todo = SUBJECTS.filter(([name]) => !only || only.has(name));
const needsReference = todo.some(([name]) => name !== "I01");

let reference = null;
if (needsReference) {
  if (!(await exists(REFERENCE))) {
    console.error(`Make the style reference first and check it:\n  node --env-file=.env.local scripts/generate-stickers.mjs --only I01`);
    process.exit(1);
  }
  reference = await readFile(REFERENCE);
}

let made = 0;
for (const [name, subject] of todo) {
  const out = `${RAW}/${name}.png`;
  if (!force && (await exists(out))) {
    console.log(`skip  ${name} (exists, use --force to redo)`);
    continue;
  }
  process.stdout.write(`make  ${name}: ${subject} … `);
  const started = Date.now();
  try {
    const { png, prompt } = await generate(name, subject, name === "I01" ? null : reference);
    await writeFile(out, png);
    await appendFile(
      "assets/PROMPTS.md",
      `\n## ${name} · ${model} · ${new Date().toISOString()}${name === "I01" ? "" : " · reference: I01.png"}\n\n\`\`\`\n${prompt}\n\`\`\`\n`,
    );
    made++;
    console.log(`${Math.round(png.length / 1024)} KB in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } catch (err) {
    console.log("failed");
    console.error(`  ${err.message}`);
    process.exit(1);
  }
  await sleep(1500);
}
console.log(`\nDone: ${made} new image(s) in ${RAW}/. Prompts logged in assets/PROMPTS.md.`);
