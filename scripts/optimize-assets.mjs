// Convert the sticker art in assets/raw/ (SPEC section 9b) to 512 px WebP for the app.
//
//   node scripts/optimize-assets.mjs
//
// assets/raw/I01.png ... I21.png  ->  public/items/I01.webp ...
// assets/raw/logo.png, pending.png, ...  ->  public/stickers/logo.webp ...
// Items without their own art reuse a close one (ART_ALIAS in src/lib/item-art.ts), so nothing is copied for them.

import { readdir, mkdir } from "node:fs/promises";
import sharp from "sharp";

const RAW = "assets/raw";
await mkdir("public/items", { recursive: true });
await mkdir("public/stickers", { recursive: true });

for (const file of (await readdir(RAW)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort()) {
  const name = file.replace(/\.[^.]+$/, "");
  const out = /^I\d\d$/.test(name) ? `public/items/${name}.webp` : `public/stickers/${name}.webp`;
  const { size } = await sharp(`${RAW}/${file}`).resize(512, 512, { fit: "cover" }).webp({ quality: 82 }).toFile(out);
  console.log(`${out}  ${(size / 1024).toFixed(0)} KB`);
}
