# Campus Price Map

Find where the exact thing you buy every day is cheapest on UBC campus, close to where you are.

Built at HackCamp 2026 (nwPlus, UBC Vancouver) by Sergio Lopez and Sebastian Salomon Wong. All code written after 12:00 PM, Sat Nov 7, 2026. Repo is public.

> **Claude Code: this file is the spec.** Read it fully before every task. Work through section 13 one step at a time. If a request conflicts with this file, ask before building.

Version 13, Sun Nov 8. Changes from version 12:
- **Step 10 finished.** `src/lib/sounds.ts` synthesises the five sounds with Web Audio: snap (shutter), slap (report saved), cha-ching (results show a cheaper spot), thud (sold out, or a report voted down) and chime (a price confirmed, or "It's back"). The sound on/off button (`SoundToggle`) is in the home, Results and Outlet headers, remembered on the phone, and off by default when the phone asks for reduced motion. Read aloud (`src/lib/speech.ts`, `ReadAloud`) on Results reads the decision line, the top 3 outlets and the Worth the walk saving. Every sound comes with text on screen.
- **Location button, blocked:** a tap while off always asks again (the phone shows a prompt if it still may). If the phone has blocked the site, a note gives that phone's steps (iPhone, Android or other), fades after 8 s or on ✕, and location turns on by itself once it's allowed and the student comes back. Browsers never let a site show the prompt again after "Don't Allow"; that's why the note exists.
- **Row actions tidied:** "Wrong price?" is its own line under the price details, and "I bought it here" and "Sold out here?" sit side by side as two equal buttons.

Version 12, Sun Nov 8. Changes from version 11:
- **Build status** added at the top of section 13, so sessions skip finished work. Section 7 rows now list "Wrong price?", "I bought it here" and the Sold out buttons as built.

Version 11, Sun Nov 8. Changes from version 10:
- **"Wrong price?"** under every official price on Results and the Outlet page. It opens the "I bought it" sheet in a second mode: "What's the price here?", empty rather than prefilled, with an optional price-tag photo (`/api/read-photo` with `hint: "tag"`). It has the same save and safeguards: within $0.10 of the shown price it counts as a confirmation; otherwise it's a pending report that only changes the price once a second student confirms it.

Version 10, Sun Nov 8. Changes from version 9:
- **Sold out (Step 9) is built:** "Sold out here?" with a confirm step, and "It's back", under every item on Results and the Outlet page, through `POST /api/stock`. The rules are unchanged (`stock_status`): one report means "may be sold out" for 2 h, 2 different students in 4 h means SOLD OUT, and one "back" clears it.
- **Location button on the home map**, above the zoom buttons: tap to turn location on (the browser asks the first time) and centre the map on you; tap again to turn it off. Off is remembered on the phone, so the app doesn't switch it back on by itself. Section 7 "Location".

Version 9, Sun Nov 8. Changes from version 8:
- **"I bought it" asks, never forces, and keeps a "last confirmed" time on every price.** After a student taps Directions, the app asks once, a few minutes later or when they're at the outlet, "Did you buy it?". They can type what they paid, which is prefilled with the shown price so confirming is one tap, add a receipt photo, or tap "Not now". A report within $0.10 of the official price confirms it: the price shows "✓ Confirmed by a student · 20 min ago" and no pending line. A different price still waits for a second student, as before. Section 7 "I bought it", Step 8.

Version 8, Sun Nov 8, early morning. Changes from version 7:
- **Step 11 (polish and accessibility pass) and Step 15 (Directions on every Results row) are dropped** as not a priority. Directions stays on the Outlet page and the Worth the walk card. Section 15's credits still apply (OpenStreetMap attribution is on the map; Open Food Facts and StatCan need crediting wherever their data shows).

Version 7, Sun Nov 8, morning. Changes from version 6:
- **Worth the walk is about the money, not the student's time.** The point is that a few extra minutes, repeated every time you buy it, add up: "6 extra minutes there and back saves $1.00 every time: $65 a term, $520 over a degree." No wage, no time cost, no net, no "not worth it" verdict, and no break-even wage in the app. The best option is the **biggest saving** within `worth_max_extra_min`, not the highest net. Savings under `even_band` ($0.10) each time aren't suggested. The card starts at 5 purchases a week (once every school day), shown and changeable. Section 7 card, section 10, G14, Step 14, D8.

Version 6, Sun Nov 8, early morning. Changes from version 5:
- **Walking directions open in Google Maps.** A **Directions** button opens Google Maps with walking directions to the outlet. The app no longer draws routes: no `/api/route`, no OpenRouteService calls from the app, no RouteLayer or RouteSteps, no rerouting or arrival sheet. Distances in the app stay the section 7 estimate. (`scripts/build-walk-matrix.mjs` can still use OpenRouteService once, offline, for outlet to outlet walking times in Databricks.) Section 7 "Directions", Step 15.

Version 5, Sat Nov 7, late night. Changes from version 4:
- **Worth the walk?** Every result now answers whether walking to the cheaper outlet pays off once you count your time, and what it adds up to over a term, a year or a degree. The economics are computed in Databricks (`gold_walk_worth`), and the app runs the same formula live from the student's position (section 10, section 7).
- **The app is the map.** Full-screen map home, a live location dot, and walking routes drawn in the app from OpenRouteService (free, no card). No Google Maps API and no hand-off to another app.
- **Forgiving search:** "Redbull", "red-bull" and "rdbull" all find Red Bull (aliases, normalisation, small typo tolerance).
- **Barcode scanner is back, as a full-screen centred camera.** Open Food Facts gives a bundled barcode file plus a live fallback through our server. It identifies the item only; the price still comes from a photo or the student. Lowest build priority.
- **Everything is free:** Gemini free tier (key confirmed working, `gemini-flash-latest` read a test tag in 2.8 s), stickers made in the AI Studio website, OpenRouteService free key, Vercel Hobby, Databricks Free Edition.
- New config table `app_config` (wage, weeks per term, thresholds), read by both the app and Databricks so the numbers always agree.

Version 4, Sat Nov 7, night. Changes from version 3 (9:30 PM):
- **Databricks is the price comparison engine.** Every comparison (rank, gap to campus median, cheapest outlet, nearest cheaper outlet, grocery and StatCan comparisons, good / average / high price bands, chip labels) is computed in a Lakeflow pipeline and served back through one Lakebase synced table, `serving.price_comparisons` (section 10).
- Two synced tables instead of three, so fewer sync pipelines compete for Free Edition limits.
- App database roles must be native Postgres password roles. Lakebase OAuth tokens expire after 1 hour, so a static `DATABASE_URL` built on one breaks mid-demo.
- `device_id` is `text`, not `uuid` (Lakehouse Sync can't carry `uuid`).
- Verification rule fixed: a 1 yes / 1 no tie no longer makes a price official.
- "Just confirmed" line covers the gap between a live confirmation and the next pipeline refresh.
- Photo size limit measured on the base64 body, not the JPEG.
- `/api/read-photo` is rate limited (it was open, so anyone could spend our Gemini quota).
- Thank you toasts no longer cite search counts (we never log searches).
- "On your way" renamed "Near you": we know where the student is, not where they're going.
- Databricks code ships as a bundle (`databricks.yml`) so it deploys from the repo with one command.
- Every price gets a band: good, average or high (within ±10%, minimum $0.20, of the campus median), always shown as an icon and a word as well as a colour.
- StatCan is loaded from files we downloaded, not from the internet: the full tables 18-10-0245-01 and 18-10-0004-01 with BC rows (checked against the raw data), plus 9 Canada-level CSVs for the pitch. There's no soda match, and fruit needs an assumed weight (section 10, G9).
- Outlet scores now come from a Bayesian hierarchical price model built for sparse data. It also estimates prices we haven't collected yet, clearly labelled and gated by leave-one-out validation (section 10, G13). New `carries` table and outlet `type` / `operator` values feed it.

---

## 1. Product in 30 seconds

- **Problem:** UBC students who buy the same coffee or energy drink most days can't tell which outlet sells it cheapest, so they overpay without knowing by how much.
- **Promise:** open the map, search an item (or snap or scan it) and see where it's cheapest near you, whether the walk is worth it, and get walking directions there in Google Maps.
- **Pitch:** Campus guides tell you which places are cheap. We tell you where the exact thing you buy every day is cheapest, a short walk from where you are.
- **User:** the daily buyer, on a phone, walking between classes, one hand free.
- **Never write in UI or copy:** "the only app", "nobody does this", invented stats. Campus Nutrition exists; our difference is item level and live.

## 2. Rules for Claude Code

1. One step per prompt (section 13). Stop at that step's **Show me** and wait.
2. Commit after every working step: `git commit -m "step N: <what>"`, then push. Every push deploys to Vercel.
3. Mobile first: design and test at 390 x 844. Every screen works without the map (list view).
4. The browser never talks to the database, Gemini or Databricks. Browser → `/api/*` → Lakebase, Gemini or Genie.
5. Secrets only in env vars or Databricks secrets. Never in client code, logs, commits or error messages.
6. Only the libraries in section 3. No state library, no UI kit, no Google Maps APIs (a plain Google Maps directions link is fine, section 7).
7. TypeScript strict. Validate every API input with `zod`. No `any` in `src/app/api` or `src/lib`.
8. API routes that use `pg` do **not** set `export const runtime`: the app has `cacheComponents` on, Next 16 rejects that line under it, and route handlers already run on Node.js. Instead they `await connection()` (from `next/server`) first, so they run at request time and are never prerendered with build-time data.
9. **Leaflet:** load the map component with `dynamic(() => import(...), { ssr: false })`, import `leaflet/dist/leaflet.css` once, and draw pins with `L.divIcon` (no default marker images). This avoids the blank map and broken icon bugs.
10. **Anything from Databricks is optional at runtime.** The synced tables (`serving.price_comparisons`, `serving.outlet_scores`) and Genie may not exist, or may be stale. If missing or stale (section 8), fall back to the live views and hide the features that need them (chips, tiers, BC stamp). Never crash on it.
11. **Databricks CLI:** always pass `--profile campus-price-map`. Never run a command that creates, deletes or changes something in the workspace or in Lakebase without asking first. Read-only commands are fine.
12. Unsure? Ask one question instead of guessing.

## 3. Stack

| Layer | Choice |
|---|---|
| App | Next.js, App Router, TypeScript, `src/` dir, Tailwind |
| Map | `leaflet` + `react-leaflet`, OpenStreetMap tiles, client only (rule 9) |
| Database | Databricks Lakebase (Postgres 17, autoscaling project) through `pg`, SSL required |
| Data engine | Lakeflow Declarative Pipeline (the price engine) + notebooks + one Job + Lakebase synced tables, deployed as a Databricks bundle (section 10) |
| Plain English questions | Databricks Genie space; Genie Conversation API from `/api/ask` (stretch) |
| AI | `@google/genai` (Gemini API) for reading photos |
| Auth | `@auth0/nextjs-auth0`, latest version, Google login (Step 12 only). Follow the SDK's README; older tutorials use a different setup. |
| Read aloud | Web Speech API (`speechSynthesis`), built into the browser, no library |
| Location | Browser Geolocation API |
| Validation | `zod` |
| Asset scripts | `sharp` (dev only) |
| Walking directions | A link that opens Google Maps (`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>&travelmode=walking`). No API key, no routing in the app. |
| Barcodes | Native `BarcodeDetector` where the browser has it, else `@zxing/browser` (iPhone Safari has no native detector). Product lookup: bundled Open Food Facts file, then the Open Food Facts API from `/api/barcode` |
| Hosting | Vercel Hobby (free), auto deploy from `main` |

## 4. Repo layout

```
src/app/
  page.tsx                  Home: search, item tiles, map/list
  item/[id]/page.tsx        Results for one item
  outlet/[id]/page.tsx      Outlet page
  snap/page.tsx             Snap a price: camera, confirm, save
  ask/page.tsx              Ask (Genie), stretch, Step 13
  api/health/route.ts       GET   prove the pipe (DB and pipeline)
  api/items/route.ts        GET
  api/locations/route.ts    GET
  api/prices/route.ts       GET ?item=I01&lat=&lng=
  api/outlet/[id]/route.ts  GET
  api/read-photo/route.ts   POST  (Gemini)
  api/save-price/route.ts   POST
  api/vote/route.ts         POST
  api/stock/route.ts        POST
  api/ask/route.ts          POST  (Genie), stretch
  api/barcode/route.ts      GET   barcode → item (bundled file, then Open Food Facts)
  api/config/route.ts       GET   app_config values (wage, weeks, thresholds)
  scan/page.tsx             Full-screen barcode scanner, lowest priority
src/components/   PriceTag PriceBand ItemSticker ItemTiles Pin Stamp Tape ReceiptCard Button CameraButton BottomSheet SoundToggle ReadAloud Toast WakingUp WorthTheWalk DirectionsButton LocationDot Scanner
src/lib/          db.ts gemini.ts genie.ts geo.ts device.ts image.ts sounds.ts speech.ts validate.ts format.ts pricing.ts walkworth.ts search.ts directions.ts barcode.ts
db/               schema.sql roles.sql views.sql
data/raw/         campus_food_prices.csv barcode_lookup.csv      (raw inputs, never edited)
data/             items.csv outlets.csv prices.csv carries.csv menu_items.csv build_report.md   (built by scripts/build_seed.py)
                  statcan_map.csv                             (hand-checked item to StatCan mapping, section 10)
                  walk_matrix.csv                             (outlet to outlet walking minutes, from build-walk-matrix.mjs)
                  barcodes.csv                                (Open Food Facts extract, ODbL licence, section 6)
scripts/          seed.ts optimize-assets.ts gemini-check.mjs generate-stickers.mjs
                  build-walk-matrix.mjs   outlet-to-outlet walking times from OpenRouteService, run once → data/walk_matrix.csv
                  build-barcodes.mjs      Open Food Facts search → data/barcodes.csv (hand-reviewed), run once
tests/            walkworth.test.ts (parity with Databricks fixtures) search.test.ts rules.test.ts
databricks/
  databricks.yml            bundle: the pipeline and the refresh Job
  src/01_statcan.py         notebook, run once by hand: StatCan CSVs in the Volume → statcan_* Delta
  src/02_bronze_copy.py     notebook, Lakebase → Delta bronze
  src/price_engine.py       Lakeflow pipeline: silver → gold
  src/03_price_model.py     notebook, hierarchical price model: outlet tiers and estimated prices
  src/04_grants.py          notebook, re-grants app_reader on synced tables
  create_synced_tables.sh   one-off CLI script (bundles can't define synced tables yet)
  genie_space.md
public/items/     I01.webp ... I21.webp
public/stickers/  logo.webp empty-map.webp pending.webp sold-out.webp savings.webp thanks.webp
public/sfx/       snap.mp3 slap.mp3 chaching.mp3 thud.mp3 chime.mp3
assets/PROMPTS.md every AI Studio prompt we used (for Devpost)
```

## 5. Environment variables

| Name | Where | Value |
|---|---|---|
| `DATABASE_URL_READER` | Vercel + `.env.local` | Lakebase, native password role `app_reader` |
| `DATABASE_URL_WRITER` | Vercel + `.env.local` | Lakebase, native password role `app_writer` |
| `DATABASE_URL_ADMIN` | `.env.local` only, never Vercel | owner, schema and seed only. The owner is a Databricks identity, so its password is an OAuth token that lasts 1 hour: `databricks postgres generate-database-credential <endpoint path> --profile campus-price-map`. Fine for running the seed; never use it in the app. |
| `GEMINI_API_KEY` | Vercel + `.env.local` | from Google AI Studio |
| `GEMINI_MODEL` | Vercel + `.env.local` | `gemini-flash-latest`, or the newest stable Flash listed in AI Studio. Model names change often; swapping must be this one line. |
| `PRICE_SOURCE` | Vercel + `.env.local` | `live` (default) or `pipeline`. See sections 6 and 8. |
| `DATABRICKS_HOST` | Vercel + `.env.local` | workspace URL, Step 13 |
| `DATABRICKS_TOKEN` | Vercel + `.env.local` | personal access token for Genie only, Step 13 |
| `GENIE_SPACE_ID` | Vercel + `.env.local` | from the Genie space URL, Step 13. If unset, the Ask tab is hidden. |
| `GEMINI_IMAGE_MODEL` | `.env.local` only | `gemini-3.1-flash-image`, for `scripts/generate-stickers.mjs`. Image generation through the API usually needs billing, which we don't use, so expect to make stickers in the AI Studio website instead. |
| `ORS_API_KEY` | `.env.local` only | free OpenRouteService key (openrouteservice.org, no card), only for running `scripts/build-walk-matrix.mjs` once. The app never uses it. |
| `AUTH0_*`, `APP_BASE_URL` | Vercel + `.env.local` | names exactly as the Auth0 SDK README says, Step 12. If unset, the app runs anonymous. |

`.env*` is in `.gitignore`.

**Why native password roles:** Lakebase accepts two kinds of login. OAuth tokens (Databricks identities) expire after 1 hour and need a refresh loop. Native Postgres roles with a password don't expire. Vercel functions hold a static connection string, so `app_reader` and `app_writer` must be native roles (`db/roles.sql`). If `CREATE ROLE ... PASSWORD` is refused, turn on native Postgres login in the Lakebase project settings or ask the Databricks booth.

`src/lib/db.ts`: one `Pool` per role created once at module level (reused across requests), `max: 3`, `connectionTimeoutMillis: 15000`, `statement_timeout: 10000`. Lakebase scales to zero after 5 idle minutes and can refuse the first connection while it wakes, so helper `withRetry` retries once on connection errors. On the client, if any request takes over 3 s, show `WakingUp`: "Waking up prices…". For judging (Sunday morning), turn scale to zero off in the Lakebase compute settings.

## 6. Data

### Items (fixed IDs, 23)

```
I01 Red Bull, 250 ml can                      Energy drinks
I02 Monster Energy, 473 ml can                Energy drinks
I03 Celsius, 355 ml can                       Energy drinks
I04 Coca-Cola, 355 ml can                     Soft drinks
I05 Coca-Cola, 591 ml bottle                  Soft drinks
I06 Bottled water, 500 ml                     Water
I07 Sparkling water, 355 ml can               Water            (no prices yet)
I08 Drip coffee, small, 10 to 12 oz           Hot drinks
I09 Drip coffee, medium, 14 to 16 oz          Hot drinks
I10 Latte, small, 10 to 12 oz                 Hot drinks
I11 Tea, small, 10 to 12 oz                   Hot drinks
I12 Iced coffee or cold brew, 12 oz           Cold coffee
I13 Bagel with cream cheese                   Breakfast and bakery
I14 Muffin                                    Breakfast and bakery
I15 Pre-made sandwich                         Lunch grab and go
I16 Pre-made wrap                             Lunch grab and go
I17 Sushi pack, California roll, 8 pieces     Lunch grab and go
I18 Quest Protein Bar, 60 g                   Snacks
I19 Lay's Classic chips, 40 g                 Snacks
I20 Banana                                    Fruit
I21 Apple                                     Fruit
I22 Red Bull, 355 ml can                      Energy drinks
I23 Clif Bar, 68 g                            Snacks
```

StatCan matches (I08, I09, I11, I20, I21) live in `data/statcan_map.csv`, section 10.

`scripts/build_seed.py` is the single source of truth for this list and for which menu lines count as which item (`match_items`). Coffee, latte and tea are the small 10 to 12 oz sizes because that's what almost every outlet lists. Generic foods (sandwich, wrap, muffin) use the lowest listed matching price per outlet. Quest and Clif are both tracked, as I18 and I23, so bar comparisons stay like for like. Red Bull 473 ml is not tracked.

### Outlets

`data/outlets.csv`, built by `scripts/build_seed.py`: 124 outlets with slug IDs (`blue-chip-cafe`, `harvest-market`). 95 have exact coordinates from UBC's food outlet points (`poi_id`). 29 had none, so they sit at their building's centroid (`location_precision = building`) or their area's (`area`, e.g. University Village), spread a few metres apart so pins don't stack. The app labels those "approximate location". Popeyes (Lelem Village) is skipped until it has coordinates. `save-on-foods-wesbrook-village` is the grocery baseline: `is_benchmark = true`, never ranked and never shown as "cheapest on campus". It's used for the "vs grocery" comparison only.

`type` is one of cafe, convenience, quick_service, restaurant, dining_hall, grocery (from the vendor type). `operator` is one of ams, ubc_food_services, chain, independent (name rules in the build script; review by hand). Franchise outlets that food.ubc.ca lists as run by UBC Food Services (the Tim Hortons, Starbucks and Subway on campus, Triple O's, Pacific Poké) are `ubc_food_services`; those in University Village and inside Save-On-Foods are `chain`. The price model (section 10) uses both to estimate outlets with few prices.

### Where the prices come from

`data/raw/campus_food_prices.csv` has 1,704 usable menu lines. 576 have a retrieved date (menus read on Nov 7): source `menu`. The other 1,128 are **AI-estimated prototype prices**, undated: source `seed`. For this prototype the app treats `seed` prices as real, official prices everywhere (comparisons, bands, Worth the walk, the Databricks engine). The source is kept so they stay traceable: the freshness line says "Prototype price". The Devpost presents the whole dataset as a **proof of concept**: `gold_pitch_numbers` counts `seed` prices too, and every number they contribute to carries the note "proof of concept: includes AI-estimated prototype prices". Quote that note with the number. Real reports (photo, receipt, typed) replace them as students confirm prices. Of the 593 tracked prices, 10 are `menu` and 583 are `seed`; `data/build_report.md` has the per-item counts.

### What each outlet sells (`data/carries.csv`)

One row per item an outlet sells, seen on the shelf or menu during the price walk, even when we didn't get its price. Without it the model would estimate prices for things an outlet doesn't sell. The pipeline also counts any price or stock report for a pair as "carried". If the file is empty, estimates only cover pairs that have had a report.

### Barcodes (`data/barcodes.csv`, from Open Food Facts)

Only packaged items have barcodes: I01 to I07, I18, I19 (and I13, I15, I16, I17 only when the outlet sells a branded pack). Coffee, lattes, muffins and fresh food use the item tiles.

- `scripts/build-barcodes.mjs` queries the Open Food Facts search API once, filtered to products sold in Canada from the brands we track (Red Bull, Monster, Celsius, Coca-Cola, Dasani, Aquafina, Lay's, the bar brand chosen for I18, and brands seen on the price walk). It sleeps between calls (their search API allows about 10 requests a minute) and sends a User-Agent naming the app and the repo URL, as Open Food Facts asks. Don't download the full multi-GB dump.
- Output, a few hundred rows: `barcode, product_name, brand, quantity, item_id, mapped_by`. A rule fills `item_id` when brand and size match (any flavour or sugar-free version of the same size maps to the same item), and we review every row by hand. Rows that match no item keep `item_id` empty.
- **Licence:** Open Food Facts data is under the ODbL. Our extract is a derived database in a public repo, so it ships under the ODbL with attribution (`data/barcodes.LICENSE.md` and the credits in section 15).

**Built:** `data/barcodes.csv` comes from `data/raw/barcode_lookup.csv` (117 rows kept, 115 mapped). Multipacks are dropped, codes with a bad check digit are dropped, the Dasani barcode maps to I06 (it's the 500 ml bottle), Red Bull 355 ml maps to I22, Quest to I18, Clif to I23. `mapped_by` says how sure the mapping is: `exact`, `flavour_variant`, `brand_size_unverified` (the size wasn't on the label data) or `not_tracked` (Red Bull 473 ml).

### Schema (`db/schema.sql`, `db/views.sql`, `db/roles.sql`, `db/seed.sql`)

The SQL files in `db/` are the source of truth; this is the summary. Run them as the owner, in that order. `db/test_db.sh` runs all four on a throwaway local Postgres and checks permissions, the verification rules and stock.

| Table | What it holds |
|---|---|
| `locations` | 124 outlets: slug `id`, name, area, `operator`, `type`, address, `hours` (as listed), lat, lng, `is_benchmark`, UBC `poi_id`, `location_precision` |
| `items` | 23 tracked items with `aliases` for search |
| `prices` | Insert-only price rows. `source` is `walk`, `menu`, `grocery`, `seed`, `photo`, `receipt` or `typed`. Price must be $0.25 to $25 |
| `price_votes`, `stock_reports`, `photo_reads` | Insert-only student actions (photo_reads is for rate limiting only) |
| `carries` | Which outlet sells which tracked item |
| `menu_items` | Every menu line we collected (1,704), tracked or not, for Genie and browsing; `item_ids` says which tracked items a line counts as |
| `app_config` | Numbers the app and Databricks share: `bc_min_wage`, weeks per term, year and degree, `even_band`, `round_trip`, `worth_max_extra_min` |
| `walk_matrix` | Outlet to outlet walking minutes, normal and step-free, filled later from the UBC path network |

`device_id` columns are text checked against the UUID shape, because Lakehouse Sync, the optional CDC route into Databricks (section 10), doesn't support the `uuid` type.

**"A different student"** everywhere below means a different `user_id` when both rows have one, otherwise a different `device_id`. Team and seed rows (no device, no user) count as nobody.

### Verification: Pending vs Official

Rows are never updated; status is computed, so `app_writer` stays insert only. The rules live in two places on purpose:

- **Live, in Postgres (`db/views.sql`)**: always works, updates instantly. Used for pending lines, for the "just confirmed" line, and for official prices when `PRICE_SOURCE=live` or the pipeline is missing or stale.
- **Pipeline, in Databricks (section 10)**: the same rules plus data quality checks. Its output feeds every comparison. Used for official prices when `PRICE_SOURCE=pipeline`.

Two copies of the same rules can drift apart. The pipeline guards against that with a parity check (`gold_parity`, section 10) that compares its official prices with the live `current_prices` view on every run. Any mismatch is a bug in one of the two, so fix it before the demo.

Rules for each price row. Votes and matching reports count only when they come from a different student than the reporter.
1. `official` if source is `walk`, `menu`, `grocery` (team data) or `seed` (prototype data).
2. `rejected` if `no` votes ≥ 1 and `no` > `yes`.
3. `official` if `yes` > `no` and `yes` ≥ 1, or if a different student reported a price within $0.10 for the same item and outlet within 48 h of this row (matching reports confirm each other; a report rejected by rule 2 confirms nothing). A row with `needs_review` needs 2 confirmations (yes votes plus matching reports).
4. Otherwise `pending`. `unsure` votes never count either way.

Views:
- **`price_status`**: one row per price with its status and `confirmations` (yes votes plus matching reports from different students).
- **`current_prices`**: newest `official` price per item and outlet, with `confirmations` and `updated_at`.
- **`pending_prices`**: newest `pending` price per item and outlet that is newer than its official row. Always read live.
- **`item_medians`**: per item, over non-benchmark outlets in `current_prices`: `n_outlets` and `campus_median` (`percentile_cont(0.5)`). Used for live mode price bands.
- **`stock_status`**: `sold_out` if 2+ different students reported `sold_out` in the last 4 h with no `back` after; `maybe_sold_out` if 1 in the last 2 h; else `in_stock`. Always live: stock changes faster than the pipeline runs.

### Synced from Databricks (read only, may not exist)

Both land in the Postgres schema `serving` (the synced table's Unity Catalog schema name becomes the Postgres schema). Full column definitions are in section 10.

```
serving.price_comparisons   one row per item and outlet with an official price or a model estimate; primary key (item_id, location_id)
serving.outlet_scores       one row per outlet; primary key location_id
```

Synced tables are read only in Postgres. Never insert, update or delete in them, or the sync breaks.

### Roles (`db/roles.sql`)

- `app_reader` (native password role): `usage` on schemas `public` and `serving`; `select` on all tables and views in both.
- `app_writer` (native password role): `insert` on `prices`, `price_votes`, `stock_reports`, `photo_reads` only, plus `usage` on their identity sequences. No update, no delete.
- Grants on `serving` are re-applied after every sync by `04_grants.py` (section 10), in case a snapshot refresh recreates the tables. If grants turn out to survive a refresh, drop that task.
- Seed: `python3 -I scripts/build_seed.py` turns `data/raw/` into `data/*.csv` and `db/seed.sql`. Paste `db/seed.sql` into the Lakebase SQL editor (or run it with psql as the owner). No Node dependency, so it doesn't wait on the app scaffold.

## 7. Screens

**Home `/`: the map is the app**
- The map fills the screen. Centred on UBC (49.2606, -123.2460), zoom 15, paper tinted tiles (section 11), with the student's live location dot once location is on.
- Floating on top: search field "What do you want?" (`src/lib/search.ts`, below).
- Below it: **item tiles**, all 23 item stickers in a horizontal scroll (most bought first: Red Bull, drip coffee small, latte, water, sandwich, chips, then the rest), plus a "See all items" grid. Tapping a tile opens Results.
- List view (toggle in the bottom bar) shows everything the map shows, in text. It's the screen reader path, not an afterthought.

**Search (`src/lib/search.ts`)**
- Normalise both the query and each item's name and aliases: lowercase, strip accents, remove everything that isn't a letter or digit. "Red-Bull", "red bull" and "REDBULL" all become `redbull`.
- Match in this order: exact alias, prefix, contains, then typo tolerance (Damerau-Levenshtein distance 1 for 4 to 7 letters, 2 for 8 or more). Category words match too ("coffee" lists I08 to I12).
- Typo matches show "Did you mean Red Bull?" as the first result. No match shows the item tiles with "We don't track that yet".
- Aliases live in the `items.aliases` column (from the sheet), e.g. I01 `redbull|red bull|rb`, I04 `coke|coca cola|cola|pop|soda`, I09 `coffee|drip|regular coffee`.
- `tests/search.test.ts` covers at least: Redbull, red-bull, rdbull, coke, pop, latte, "monster energy".
- Pins: tag shaped markers showing the outlet tier `$`, `$$`, `$$$` (from `serving.outlet_scores`; `?` if no tier or the table is missing). Estimated tiers show "est." next to the symbol (`$$ est.`) with a dashed border; the word is what carries the meaning, the border is extra. In list view: "Probably cheaper than average · estimated from 2 prices and similar outlets". Grocery baseline pin is a different shape labelled "grocery".
- Bottom bar: Map / List toggle, **Scan** (barcode, if built), and a big yellow **Snap a price** button (64 px).

**Location (`src/lib/geo.ts`)**
- Ask for browser location on the first search or tile tap, or when the student taps the **location button** on the home map (above the zoom buttons), never on page load. Timeout 8 s. The button turns location off again, and off is remembered on the phone (no automatic resume) until they turn it back on.
- If allowed: `watchPosition` while the page is visible (stopped when it's hidden), so the dot moves and walk times stay current. Re-sort results only when the student has moved more than 30 m, so the list doesn't jump.
- Location is never stored. It's sent to our API only as rounded coordinates (4 decimals, about 11 m) to sort prices.
- If denied, unavailable or timed out: measure from the AMS Nest (49.2666, -123.2499) and show one line: "Using the AMS Nest as your starting point. Turn on location for walk times from where you are."
- Walk minutes = haversine metres x 1.3 / 80 m per min, rounded up. Always labelled "about N min walk". The pipeline uses the same formula for outlet to outlet distances (section 10), so both numbers agree.

**Results `/item/[id]`**
- Header: item sticker, name, size, and a **Read aloud** button.
- Decision line: "You'd save $0.80 at Harvest Market, about 2 min walk" (compared with the closest outlet that has the item) or "The closest one is also the cheapest near you." Computed in `src/lib/pricing.ts` from the rows `/api/prices` returns, because it depends on where the student is.
- **Near you** (about 3 min walk or less), cheapest first. Then **Farther**, dimmed unless it saves $1.00 or more.
- Each outlet row:
  - **Official price** on a PriceTag. This is the only price ever shown big.
  - **Price band** next to the PriceTag (not on it): a PriceBand chip, "✓ Good price", "= Average" or "↑ High" (section 11). Screen readers hear "Good price, 15% below the campus median". No band when it's null.
  - Comparison chip from `price_comparisons.chip` ("Cheapest on campus", "2nd cheapest of 6", "$0.40 above campus average"). Hidden when the pipeline isn't available.
  - Freshness line: "Confirmed by 2 students · 20 min ago", "From our price walk · Nov 7", "Menu price · Nov 7" or "Grocery baseline". Older than 14 days: dimmed, plus "may be out of date".
  - **Just confirmed line**, pipeline mode only: if live `current_prices` has an official price newer than the pipeline's row, show "Just confirmed: $3.25 · comparisons update on the next refresh". The big price stays the pipeline's until then.
  - **Pending line**, only if `pending_prices` has a row: a blue PENDING stamp and "New report: $3.25 · waiting for a second student" with **Yes / No / Not sure**. If this device made the report: "Your report: $3.25 · waiting for a second student", no buttons.
  - If the outlet has no official price yet: "No confirmed price yet" plus the pending line. If the row has an estimate: "No confirmed price yet · estimated $2.90 to $3.40 · Snap it to confirm", in small text with no PriceTag. Estimated rows sort after every row with an official price and never appear in the decision line, the CHEAPEST stamp, the Worth the walk card or Read aloud.
  - Sold out stamp if any, a **Wrong price?** link, an **I bought it here** button and **Sold out here? / It's back** (Steps 8 and 9, version 11). Sold out rows sort below in stock ones.
  - Rejected reports are never shown.
- Small map: pins show this item's official price; the cheapest pin gets a CHEAPEST stamp.
- "vs grocery" line if the grocery baseline has the item: "$1.10 more than Save-On-Foods Wesbrook".
- StatCan line, only if `price_comparisons.statcan_kind` is set. For same_item: STATCAN stamp plus "5.7x the BC grocery price · StatCan, BC, Sep 2026 · assuming a 120 g banana". For ingredients, a plain line with no stamp: "Brewing it yourself costs about $0.28 a cup · StatCan ground coffee, BC, Sep 2026". The geography and month come from the data.
- **Worth the walk card** (`WorthTheWalk`, maths in `src/lib/walkworth.ts`, section 10 has the formula). It sells the walk with what it adds up to:

  > **Worth the walk: save $65.00 a term**
  > 6 extra minutes there and back to Tim Hortons instead of Blue Chip Cafe saves **$1.00 every time**.
  > I buy it [5 times a week ▾]
  > **$65.00** saved a term · **$130.00** saved a year · **$520.00** saved a degree
  > 65 purchases a term (13 weeks).

  - The option shown is the **biggest saving** within `worth_max_extra_min` extra minutes (ties: the shorter walk). Savings under `even_band` ($0.10) each time aren't suggested: "16 minutes to save 6 cents" isn't a pitch.
  - Time is shown as minutes only. It is **never** turned into money: no wage, no time cost, no net, no "not worth it" verdict.
  - **Frequency:** starts at 5 a week (once every school day), always visible and changeable from 1 to 14. Horizons are term, year and degree from `app_config`, shown side by side.
  - **Optional savings line:** "Put the savings aside at [__]% a year → $X after a degree". Hidden until the student types a rate. We never pick a rate for them.
  - **Directions** button on the card: opens Google Maps (below).
  - Never uses estimated prices (G13). Hidden when nothing cheaper is within reach, including when the closest outlet is already the cheapest: then the decision line says so.
  - Read aloud includes the saving each time, the extra minutes and the term total.

**Directions (hand-off to Google Maps)**
- A **Directions** button (on the Worth the walk card and the Outlet page) is a plain link to `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>&travelmode=walking`, built in `src/lib/directions.ts` from the outlet's coordinates. It opens the Google Maps app if installed, else Google Maps in the browser, in a new tab.
- No `origin` in the link: Google Maps starts from the phone's own location, so the student's position is never put in the URL.
- That hand-off is the only routing we do. The app never draws a route, gives turn-by-turn directions, reroutes or detects arrival. Walk times in the app stay the section 7 estimate ("about N min walk").
- Accessible name: "Directions to Mercante in Google Maps (opens another app)". At least 48 px tall.

**Outlet `/outlet/[id]`**
- Name, today's hours, items grouped by category.
- A **Directions** button under the name (section 7, Directions).
- Each item: PriceTag, PriceBand, plus its `chip` from `price_comparisons`, with a link to `nearest_cheaper_location_id` ("$0.35 less at Mercante, about 3 min from here"), the pending line as on Results, **Wrong price?**, **I bought it here** and **Sold out here? / It's back**. Chips and links are hidden when the pipeline isn't available.
- Under each item with a cheaper option, Databricks' Worth the walk suggestion for standing at this outlet: "Worth the walk: 8 extra minutes to Tim Hortons saves $1.00 each time · $65.00 a term if you buy it 5 times a week". Read from `price_comparisons.walk_best_location_id`, `walk_saving` and `walk_extra_min` (section 10); the app only multiplies out the term total. Hidden under `even_band` or when that outlet is sold out.
- No single score for the whole outlet on this page.

**Snap `/snap`**
1. Camera: `<input type="file" accept="image/*" capture="environment">`.
2. Compress in the browser (`src/lib/image.ts`, canvas): long edge 1280 px, JPEG quality 0.8. Measure the **base64 string**, since that's what is sent: if it's over 2.5 MB, redo at 1024 px and 0.6. A 1280 px JPEG is normally 200 to 500 KB, so this is a safety net. Vercel rejects request bodies over 4.5 MB, so the server rejects any `image` string over 3.5 MB with "That photo is too big, try again."
3. Reading: sticker shuffle animation, "Reading the price…"
4. Confirm, one card per item found: item (dropdown with stickers, 23 items), price (`inputmode="decimal"`, big), outlet (3 nearest suggested, then full list). Nothing saves without a tap on **Looks right**.
5. Saved: slap sound, "Your report: $3.25 · waiting for a second student", thank you toast.
- Nothing readable: "Couldn't read a price. Pick your item" → 23 sticker tiles.
- Product with no price: item preselected, "What's the price here?" with a **Skip, just show me prices** link to results.

**Scan `/scan` (lowest priority, after the decisions in section 6)**
- Full-screen camera, centred viewfinder box in the middle of the screen, nothing else but a close button, a torch toggle where supported and a "No barcode? Pick your item" link to the tiles.
- Reads EAN-13, EAN-8, UPC-A and UPC-E with the native `BarcodeDetector` when the browser has it, else `@zxing/browser`.
- On a read: short vibration and the snap sound, then `/api/barcode?code=…`:
  - Matched to an item → open Results for that item, with the closest outlet preselected for "Snap the price tag" (a barcode never gives a price).
  - Known product, no matching item → "That's Red Bull 355 ml. We don't track it yet." plus the tiles.
  - Unknown → "We couldn't find that barcode." plus the tiles.
- Camera denied → straight to the tiles, with one line explaining why.

**I bought it (bottom sheet, Step 8)**: two ways in, never forced.
- **Asked:** tapping Directions remembers the trip on the phone only (localStorage). Once, 4 minutes later or as soon as the student is within 40 m of the outlet (and never after 3 hours), the app asks "Did you buy Drip coffee?". "Not now" or closing it ends that trip; it never asks twice.
- **Tapped:** "I bought it here" under every official price on Results and the Outlet page.
- The sheet: "What did you pay?" prefilled with the shown price (one tap to confirm), an optional receipt photo read through `/api/read-photo` with `hint: "receipt"` (same compression, never stored, "cover card details"), Save or Not now. Saved as `receipt` when the price is the one read from the receipt, `typed` otherwise.
- **Safeguards:** $0.25 to $25 (refused otherwise, browser and server); "Are you sure?" when the price is more than 50% (and $1) off the shown one; more than 3x the campus median sets `needs_review` (2 confirmations); and one student never changes a price alone: a different price stays pending until a second student confirms it (section 6).
- **Last confirmed:** a student report (photo, receipt or typed, not voted down) within $0.10 of the official price confirms it. Every price shows "✓ Confirmed by a student · 20 min ago" from the newest one (`last_confirmed_at` in `/api/prices` and `/api/outlet`), and such a report never shows as a pending line to vote on. Computed live in the read queries; no schema or view change.

**Read aloud (`src/lib/speech.ts`)**: reads the decision line and the top 3 rows, e.g. "Cheapest near you: Harvest Market, 2 dollars 75, about 2 minutes. Mercante, 3 dollars 10, about 4 minutes." Uses `speechSynthesis`; hide the button if the browser doesn't support it. Only starts on a tap.

**Thank you toasts**: real numbers only, from data we actually store, e.g. "You're the 3rd student to report Red Bull today" (count of `prices` rows for that item today). If there's no number, just "Thanks, that helps everyone who buys this."

**Ask `/ask` (stretch, Step 13)**: three tappable questions plus a text field. "Thinking…" state; answers can take several seconds. Shows Genie's text answer and up to 10 rows as a simple table, with a note that answers reflect the last pipeline refresh. Hidden if `GENIE_SPACE_ID` is unset or the route errors.

## 8. API

| Route | Role | In | Out |
|---|---|---|---|
| `GET /api/health` | reader | | `{ db: "ok", ms, locations: 5 sample names, pipeline: { computed_at, rows } \| null }` |
| `GET /api/items` | reader | | items with image path |
| `GET /api/locations` | reader | | outlets with lat, lng, tier, hours |
| `GET /api/prices` | reader | `item`, `lat?`, `lng?` | rows: outlet, official price, source, confirmations, updated_at, walk_min, stock, band, pct_vs_median, chip, nearest_cheaper, just_confirmed (`{ price, updated_at }` or null), estimate (`{ low, high }` or null, only when price is null), pending (`{ price_id, price, mine }` or null); plus `grocery`, `bc`, `price_source_used`, `computed_at` |
| `GET /api/outlet/[id]` | reader | | outlet, items with price, chip, nearest_cheaper, pending |
| `POST /api/read-photo` | writer (rate limit row only) | `{ image: base64 jpeg, hint?: "tag"\|"product"\|"receipt", device_id }` | draft (section 9) |
| `POST /api/save-price` | writer | `{ item_id, location_id, price, source, device_id }` | `{ id, status }` |
| `POST /api/vote` | writer | `{ price_id, vote, device_id }` | `{ status }` |
| `POST /api/stock` | writer | `{ item_id, location_id, status, device_id }` | `{ stock }` |
| `POST /api/ask` | none (server token) | `{ question }` | `{ text, columns, rows }` |
| `GET /api/config` | reader | | `app_config` as `{ bc_min_wage, weeks_term, weeks_year, weeks_degree, even_band, round_trip, worth_max_extra_min }` |
| `GET /api/barcode` | none | `code` (8 to 14 digits) | `{ status: "matched" \| "known" \| "unknown", item_id?, product_name?, quantity? }` |

- `device_id`: random UUID created on first visit, kept in `localStorage` (wrap in try/catch). After Step 12, write routes also store the Auth0 user id from the server session. Never store name or email. Clearing storage makes a new device, which is why Auth0 matters for honest confirmations.
- Price check (G3): reject outside $0.25 to $25; set `needs_review` if more than 3x the item's campus median.
- Rate limits (G5), counted in the database (in memory limits don't work on Vercel): 10 inserts per device or user per minute across `prices`, `price_votes` and `stock_reports`; 10 photo reads per device per minute and 500 photo reads per day in total, counted from `photo_reads`. The daily total protects the Gemini quota.
- `/api/vote`: reject a vote on your own report ("You can't confirm your own price"). A duplicate vote returns the current status, not an error.
- **Which source `/api/prices` and `/api/outlet` use:**
  - `PRICE_SOURCE=pipeline` and `serving.price_comparisons` exists and its newest `computed_at` is under 3 h old: official prices and comparisons from it. `price_source_used: "pipeline"`.
  - Otherwise: official prices from live `current_prices`, bands from `pricing.ts` using the live `item_medians` view, no chip, no nearest cheaper, no StatCan line. `price_source_used: "live"`. Log the reason once per cold start.
  - Pending, stock and just confirmed always come from the live views.
- `/api/ask`: `POST {DATABRICKS_HOST}/api/2.0/genie/spaces/{GENIE_SPACE_ID}/start-conversation` with `{ content: question }`, then poll the message every 1.5 s until it's completed (max 40 s), then fetch the query result. `export const maxDuration = 60`. Questions over 200 characters rejected. Check that the Genie Conversation API works on our workspace edition before building the page.
- `/api/barcode`: look in the bundled `data/barcodes.csv` first. If it's not there, call `https://world.openfoodfacts.org/api/v2/product/<code>.json?fields=product_name,brands,quantity` with an app-name User-Agent and a 4 s timeout, and cache the answer in memory. A live result is only ever "known" or "unknown", never auto-matched to an item.
- Errors return `{ error: "plain sentence for the user" }` with the right status code.

## 9. Gemini

Two jobs: **live in the app** through the Gemini API (reading photos), and **ahead of time in Google AI Studio** (art and sound). Nothing is generated live except photo reading.

### 9a. Live: `/api/read-photo`

- Model: `process.env.GEMINI_MODEL`, SDK `@google/genai`, key from env (server only).
- Structured output: JSON mode with a response schema. Don't set temperature, top_p or top_k.
- One call reads any photo: price tag, menu board, product, or receipt. The item list is built from the `items` table and sent in the prompt.
- Before calling Gemini, check the rate limits (section 8) and insert a `photo_reads` row. The image is never stored or logged (G8).

Prompt:

```
You read photos taken by UBC students at campus food outlets.
1. Classify the photo: price_tag, menu_board, product, receipt, or other.
2. Return every item from ITEM LIST that is visible, with the price shown for it.
ITEM LIST (id: name, size):
{{items}}
Rules:
- Use only item_id values from ITEM LIST. Anything else goes in "unmatched".
- price is the number printed in CAD for that item, before tax. If no price is visible, use null. Never guess a price.
- For receipts, use the amount paid per item and copy the store name into outlet_hint.
- For menu boards with sizes, pick the size that matches ITEM LIST (small or medium).
- confidence is 0 to 1 for the item match.
```

Schema:

```json
{
  "kind": "price_tag | menu_board | product | receipt | other",
  "outlet_hint": "string or null",
  "items": [{ "item_id": "I01", "price": 3.49, "size_text": "250 ml", "confidence": 0.92 }],
  "unmatched": [{ "text": "string", "price": 2.5 }]
}
```

Server after Gemini (G2, G3): drop `item_id`s not in the table, drop prices outside $0.25 to $25, sort by confidence, return the draft. Timeout 20 s, then "Couldn't read it, pick your item".

Test set: the tag and menu photos from the price walk (Drive). Each must return the right item and price before Step 6 is done.

### 9b. Ahead of time: art in Google AI Studio

Model: **Nano Banana 2** (`gemini-3.1-flash-image`) in aistudio.google.com. Square 1:1. Generate in the AI Studio app, not through the API. Max 20 minutes total; emoji are fine if time runs out.

Workflow:
1. Generate `I01` with the master prompt. Iterate until it's right.
2. Attach that image as a reference for every other item: "Match the style of the attached sticker exactly."
3. Download PNGs into `assets/raw/`. `scripts/optimize-assets.ts` (sharp) converts to 512 px WebP in `public/items/` and `public/stickers/`.
4. Paste every prompt into `assets/PROMPTS.md`.

Master prompt:

```
Die-cut vinyl sticker of {{subject}}, centred, slight three-quarter view.
Thick white sticker border with a soft drop shadow.
Bold flat illustration, chunky black outlines, limited palette:
ink #1A1A1A, price-tag yellow #FFD23F, warm red #E4572E, teal #2A9D8F, cream #FFF8E7.
Light risograph grain, slight print misregistration.
No text, no letters, no logos, no brand marks.
Plain flat background #F4EEE2, nothing else in frame. Square.
```

Subjects (generic on purpose: no real logos, the brand name lives in the UI text):

| File | Subject |
|---|---|
| I01 | a slim tall energy drink can, blue and silver |
| I02 | a tall wide energy drink can, black with a green stripe |
| I03 | a slim energy drink can, white with a bright stripe |
| I04 | a red soda can |
| I05 | a red soda bottle |
| I06 | a clear plastic water bottle with a blue cap |
| I07 | a pastel sparkling water can with bubbles |
| I08 / I09 | a small / medium paper coffee cup with a lid and steam |
| I10 | a latte cup with a heart of foam |
| I11 | a paper cup with a tea bag tag hanging out |
| I12 | a clear iced coffee cup with ice and a straw |
| I13 | a bagel with cream cheese |
| I14 | a blueberry muffin |
| I15 | a triangle sandwich in a plastic box |
| I16 | a wrap cut in half |
| I17 | a pack of sushi rolls in a clear box |
| I18 | a protein bar half unwrapped |
| I19 | a small bag of chips |
| I20 | a banana |
| I21 | a red apple |
| logo | a yellow price tag with a string, pinned to a folded paper map |
| empty-map | a folded paper map with a question mark pin |
| pending | an hourglass |
| sold-out | an empty shelf with a little sign (no text) |
| savings | a small pile of coins |
| thanks | a thumbs up hand |

The background colour matches `--paper`, so stickers sit on cards without background removal.

### 9c. Ahead of time: UI sounds

| File | Plays when | Feel |
|---|---|---|
| `snap.mp3` | photo taken | camera shutter click |
| `slap.mp3` | price saved | sticker slapped on paper |
| `chaching.mp3` | a cheaper spot is shown | small cash register |
| `thud.mp3` | sold out reported, or price rejected | soft cardboard thud |
| `chime.mp3` | your price got confirmed | bright two note chime |

- Default: `src/lib/sounds.ts` synthesises all five with the Web Audio API (no files needed). Optional: replace with Lyria 3 clips from AI Studio, trimmed under 1 s, mp3 96 kbps, under 30 KB. Same function either way: `play("slap")`.
- Rules: only after a user action, mute toggle in the header (remembered), muted when `prefers-reduced-motion` is on, and a sound is never the only feedback (always paired with a visual and an `aria-live` message).

## 10. Databricks: the price comparison engine (Sergio's track, code in `databricks/`)

Databricks does the analytical work: it cleans every report, decides which prices are official, and compares every item at every outlet against every other outlet, the campus median, the grocery baseline and StatCan grocery prices. The app serves those results. The app's live path still only touches Lakebase (G10), so if Databricks is down the app falls back to live prices without comparisons.

### Data flow

```
                 Lakebase (Postgres)                                Databricks (Unity Catalog: workspace.cpm)
  app writes ──▶ public.prices, price_votes,      02_bronze_copy     bronze_*  ──▶  price_engine (Lakeflow pipeline)
                 stock_reports, items, locations ─────────────────▶                 silver_prices, silver_votes
                 public.current_prices (view)                                        silver_outlet_distances
                                                                                     gold_price_status
  StatCan ──▶ 01_statcan (once) ──▶ statcan_*  ─────────────────────────────────▶   gold_official_prices
                                                                                     gold_item_stats
                                                                                     gold_price_comparisons ──┐
                                                                                     gold_parity              │
                                              03_price_model ──▶ gold_outlet_scores ─────────────────────────┤
                                                             └─▶ model_price_estimates (read by the next pipeline run)
                                                                                     gold_pitch_numbers       │
  app reads ◀── serving.price_comparisons, serving.outlet_scores ◀── synced tables (Snapshot) ◀──────────────┘
                                                                     04_grants re-grants app_reader
                                                   Genie space reads the gold and silver tables
```

Catalog `workspace`, schema `cpm` for everything Databricks computes, schema `serving` for the two synced table entries. Check these names exist in our workspace before D1; use whatever catalog we can create schemas in.

### Getting Lakebase data into Databricks (`02_bronze_copy.py`)

Primary route: the notebook connects to Lakebase with `pg8000` (pure Python; psycopg's bundled native `libpq` aborts the serverless Python process on import), using a 1 hour credential from `WorkspaceClient().postgres.generate_database_credential(...)` for the Job's run-as user (no stored password). It reads `prices`, `price_votes`, `stock_reports`, `items`, `locations`, `carries`, `app_config`, `walk_matrix` and the `current_prices` view, and overwrites `bronze_*` Delta tables. At hackathon scale (hundreds of rows) a full copy takes seconds and keeps the pipeline independent of Lakebase. Start the notebook with `%pip install -U databricks-sdk pg8000` (the `postgres` SDK module needs databricks-sdk 0.81 or newer).

Optional upgrade: **Lakehouse Sync** (Beta) streams Lakebase changes into `lb_<table>_history` Delta tables without a notebook. It needs `REPLICA IDENTITY FULL` on each table, supports only basic column types (hence `device_id text`), and doesn't work on catalogs with default storage, which Free Edition likely uses. Try it only after everything else works.

### The pipeline (`price_engine.py`, Lakeflow Declarative Pipeline, Python, serverless)

All tables are materialized views: full recompute every run, fine at this size.

| Table | What it does |
|---|---|
| `silver_prices` | Expectations: `expect_or_drop` price between 0.25 and 25, item_id in items, location_id in locations, reported_at not in the future. Adds `price_per_100ml`, campus median per item, `needs_review` if over 3x median, and `reporter` (user_id if set, else device_id). |
| `silver_votes` | Votes joined to their price row; drops votes by the reporter (`expect_or_drop`), keeps the newest vote per voter and price. |
| `silver_outlet_distances` | Every outlet pair with walk minutes: from `bronze_walk_matrix` (real OpenRouteService walking times) when present, else the app's formula (haversine x 1.3 / 80 m per min, rounded up). Keeps a `source` column. |
| `gold_walk_worth` | The Worth the walk economics for every item, every origin outlet and every cheaper outlet within `worth_max_extra_min` (formula below). Not synced; feeds `gold_price_comparisons`, `gold_pitch_numbers` and Genie. |
| `gold_price_status` | The section 6 rules, exactly. One row per price with status and confirmations. |
| `gold_official_prices` | Newest official price per item and outlet. |
| `gold_item_stats` | Per item, over non benchmark outlets: n_outlets, min, median, max, spread, cheapest outlet, grocery baseline price. |
| `gold_price_comparisons` | One row per item and outlet with an official price, plus estimated rows from `model_price_estimates` (columns below). This is the table the app serves. |
| `gold_parity` | Compares `gold_official_prices` with `bronze_current_prices` (the live view). One row per mismatch. Expect zero; a non-zero count fails an `expect` and shows in the data quality panel. Reports newer than the bronze copy are excluded. |
| `gold_pitch_numbers` | Proof-of-concept numbers for the Devpost (every official price, `seed` included and labelled in the detail): biggest same item gap between outlets; median and biggest saving per term at 5 purchases a week for a walk within `worth_max_extra_min` (`median_saved_per_term_5_a_week`, `biggest_saved_per_term_5_a_week`; version 7: money only, no wage); number of reports and confirmations. Never synced. |

`gold_price_comparisons` columns (become `serving.price_comparisons`):

```
item_id, location_id                 primary key
is_benchmark                         grocery baseline row, never ranked
price, source, confirmations, updated_at
n_outlets                            outlets with an official price for this item (benchmark excluded)
rank                                 1 = cheapest, ties share a rank; null for the benchmark
campus_min, campus_median, campus_max
gap_vs_median, pct_vs_median         price minus median, in $ and %
cheapest_location_id, savings_vs_cheapest
nearest_cheaper_location_id, nearest_cheaper_price, nearest_cheaper_walk_min
                                     closest outlet (by silver_outlet_distances) selling it for less; null if this is the cheapest
grocery_price, premium_vs_grocery    vs Save-On-Foods Wesbrook, null if no grocery price
price_per_100ml
band                                 "good" | "average" | "high" | null (band rule below)
statcan_kind                         "same_item" | "ingredients" | null, from data/statcan_map.csv
statcan_value                        StatCan price for one item's amount, e.g. $0.23 for a 120 g banana
statcan_geo, statcan_ref_month       e.g. "British Columbia", "2026-09"; the app's label comes from here
statcan_ratio                        price / statcan_value, same_item only
statcan_note                         the assumption sentence shown in the app
walk_best_location_id                if you're standing at this outlet, the cheaper outlet with the biggest saving within reach (from gold_walk_worth)
walk_saving, walk_extra_min          its saving and extra minutes (there and back)
walk_time_cost, walk_net, walk_verdict, walk_break_even_wage, walk_net_term_per_weekly
                                     version 5 wage maths; the app no longer reads them (version 7, section 10)
minutes_of_work                      price ÷ bc_min_wage × 60
chip                                 ready to show: "Cheapest on campus", "2nd cheapest of 6", "$0.40 above campus average"
est_price, est_low, est_high         set only on rows with no official price, from model_price_estimates; price, rank and chip are null on those rows
computed_at
```

Ranks, medians, chips and nearest cheaper use official prices only. Estimated rows never take part in a comparison.

Chip rule: rank 1 and n_outlets ≥ 2 → "Cheapest on campus"; n_outlets < 2 → no chip; |gap_vs_median| ≥ $0.25 → "$X above/below campus average"; otherwise "Nth cheapest of N".

**Band rule (the 3 price colours).** Let `t = max(10% of campus_median, $0.20)`.
- `good` if price ≤ campus_median − t
- `high` if price ≥ campus_median + t
- `average` otherwise
- null if fewer than 3 outlets have an official price for the item, for the grocery baseline, and for estimated rows

It uses the median and a percentage rather than a standard deviation: with 3 to 6 prices per item, a standard deviation jumps around with every new report, and one wrong price drags a mean. "Within 10% of the campus median" is stable and easy to explain to judges. The same rule lives in `src/lib/pricing.ts` for live mode (section 8), and `gold_parity` also compares bands.

### Worth the walk: the economics (`gold_walk_worth`)

The point: a few extra minutes, repeated every time you buy it, add up to real money over a term, a year and a degree. So it's about the money saved. Time is shown as minutes and **never priced** (no wage).

For item *i*, an origin *o* (where you are) and a cheaper outlet *c*, with the constants from `app_config` (read through `bronze_app_config`):

```
saving        = price(i, o) − price(i, c)                       only official prices; c must be cheaper; c ≠ grocery baseline
extra_min     = walk(o, c) × (2 if round_trip else 1)           walk(o, c) from silver_outlet_distances
per horizon H in {weeks_term, weeks_year, weeks_degree}, per weekly purchase:
  saved_H = saving × H,  minutes_H = extra_min × H
```

Rules:
- Skip pairs where `extra_min > worth_max_extra_min`: nobody walks 25 minutes for a cheaper Red Bull.
- Skip pairs where `saving < even_band` ($0.10): a few cents isn't worth suggesting.
- The best option is the **biggest saving** within reach (ties: the shorter walk). That's what `walk_best_location_id`, `walk_saving` and `walk_extra_min` store.
- Sold out isn't known here (stock is live only), so the app hides a suggestion whose outlet is marked sold out.
- Compounding with interest is **not** computed in Databricks, because the rate is the student's own input. The app applies it (below).
- **D8 follow-up (done in version 7):** `gold_walk_worth` has a `saving_rank` column (biggest saving first, savings under `even_band` last), and `gold_price_comparisons.walk_*` come from `saving_rank = 1 AND saving >= even_band`. The old wage columns (`time_cost`, `net`, `verdict`, `break_even_*`, `net_rank`, and `walk_net`, `walk_verdict` etc. in `price_comparisons`) are still computed so the synced table keeps its shape, but nothing reads them. The pitch numbers are `median_saved_per_term_5_a_week` and `biggest_saved_per_term_5_a_week`.

**Live version in the app (`src/lib/walkworth.ts`).** The student is rarely standing exactly at an outlet, so the app runs the same formula with their position as the origin:
- *near* = the closest in-stock outlet with an official price for the item (the one they'd buy at without the app).
- For each cheaper *c*: `extra_min = (walk(you, c) − walk(you, near)) × (2 if round_trip else 1)`, floored at 0. The rest is identical.
- Projection for the student's frequency `f` per week (starts at 5): `saved = saving × f × H`.
- Optional savings at the student's rate `r`: weekly deposit `S = saving × f`, `i = r / 52`, `future value = S × ((1 + i)^H − 1) / i`.
- **Parity test:** D8 exports 30 rows of `gold_walk_worth` as `tests/fixtures/walk_worth.json`. `tests/walkworth.test.ts` puts the student exactly at the origin outlet and must reproduce `saving`, `extra_min`, `saved_term`, `minutes_term`, `saved_year`, `saved_degree` and `minutes_degree` to the cent. One formula, two implementations, checked against each other.

### Price model (`03_price_model.py`, notebook): estimating from sparse data

We'll have few prices: many outlets with 1 to 3 confirmed prices, and most item and outlet pairs with none. Plain OLS with outlet fixed effects breaks down there. An outlet with one price gets a wild score, and outlets that share no items can't be compared at all. So the model **borrows strength** instead: a Bayesian hierarchical model of log price with partial pooling. An outlet with little data is pulled toward similar outlets, and its uncertainty says so.

**Model**, for item *i* at outlet *o*:

```
log price(i, o) = α[i]                    item effect          prior N(category mean, 1.0²)  (weak)
                + θ_type[type(o)]         outlet type          prior N(0, 0.15²)
                + θ_op[operator(o)]       operator             prior N(0, 0.15²)
                + β[o]                    this outlet          prior N(0, τ_o²)
                + γ[o, category(i)]       outlet × category    prior N(0, τ_c²)
                + ε                       noise                N(0, σ²)
```

- `type` (cafe, convenience, quick_service, restaurant, dining_hall, grocery) and `operator` (ams, ubc_food_services, chain, independent) come from `locations` (section 6). They let an outlet with one price borrow from outlets like it.
- `γ` lets an outlet be cheap on coffee but pricey on snacks.
- Prices are in logs, so effects are percentages: τ_o = 0.12 means outlets typically sit within about ±12% of similar outlets.

**Fit:** with Gaussian priors and Gaussian noise the posterior has a closed form: mean `(XᵀX/σ² + Λ)⁻¹ (Xᵀy/σ² + Λ m₀)` and covariance `(XᵀX/σ² + Λ)⁻¹`. That's NumPy only, under a second, no sampling and no extra packages.
- With 60 or more official prices: choose τ_o, τ_c and σ by maximising the marginal likelihood over a small grid (empirical Bayes), with floors τ ≥ 0.04 so it can't shrink every outlet to the average.
- With under 60: fixed priors τ_o = 0.12, τ_c = 0.08, σ = 0.06.

**Input:** `gold_official_prices` only, never pending or rejected reports, and never `needs_review` rows that didn't get confirmed. The grocery baseline stays in the fit, because it links items across outlets. It's left out when scores are recentred to the campus average.

**Validation gate:** nothing estimated reaches the app unless it passes.
1. Leave-one-out over all official prices (closed form, cheap). Compare the model's mean absolute error in dollars with a baseline that predicts each price as the item's median elsewhere.
2. Calibrate: scale the prediction intervals so leave-one-out coverage of the 80% interval is 80% (scale clipped to 0.7 to 2.0).
3. Ship estimates only if the model's error is lower than the baseline's. If it isn't, write no estimates and show measured tiers only (4+ prices).
4. Self-test first: fit simulated data with known outlet effects and check the recovered outlet order (Spearman ≥ 0.7). Run it in D5 before touching real data.

We prototyped this on simulated sparse data (21 items, 20 outlets, 40 to 150 prices). Leave-one-out error was 35 to 50% lower than the item median, and the intervals were too wide (93% coverage for a nominal 80%), which is why step 2 exists. Real data won't fit the model as neatly as simulated data, so the gate decides, not the simulation.

**Outputs:**

`gold_outlet_scores` (synced as `serving.outlet_scores`):

```
location_id (primary key)
score_pct, ci_low, ci_high      % vs campus average, 90% credible interval
p_cheaper, p_average, p_pricier probability the outlet is below -5%, within ±5%, above +5%
n_obs                           official prices at this outlet
tier                            "$", "$$", "$$$" or null
tier_basis                      "measured" | "estimated" | null
n_items_cheapest, updated_at
```

Tier rules: no official prices at the outlet → null (`?` in the app; we never rate an outlet on its type alone). Otherwise, the band whose probability is at least 0.6 sets the tier: `$` cheaper, `$$` average, `$$$` pricier. If no band reaches 0.6 → null. `tier_basis` is "measured" if `n_obs` ≥ 4 and that probability is at least 0.8, otherwise "estimated".

`model_price_estimates` (Delta, not synced on its own): for each pair in `carries` (section 6) that has no official price, `est_price` (posterior median), `est_low` and `est_high` (calibrated 80% interval) and `est_support` (prices of this item elsewhere plus prices at this outlet). It's written only when the gate passes, and only for pairs with `est_support` ≥ 3. `gold_price_comparisons` reads this table on its next run and adds those pairs as rows with `price` null and the `est_*` columns filled. Estimates reach the app one refresh late, and we avoid a third synced table. On the very first run the table doesn't exist yet, so the pipeline treats it as empty.

`gold_model_metrics` (Delta): number of prices, chosen τ and σ, leave-one-out error for the model and the baseline, interval coverage and scale, whether the gate passed, run time. It goes in the Devpost and the Genie space.

### StatCan (`01_statcan.py`, notebook, run once)

We already downloaded 9 tables from the StatCan website. Upload the CSVs to the Volume `/Volumes/workspace/cpm/raw/statcan/` (ask first, rule 11), and the notebook reads them from there, so Databricks needs no internet. Downloading with `stats_can` is the fallback only. StatCan publishes monthly, so this is not in the refresh Job.

| Table | What it is | Used for |
|---|---|---|
| 18-10-0245-01 | Monthly average grocery retail prices, May to Sep 2026 | The only table compared with item prices: I20 banana and I21 apple (per kg), plus coffee and tea ingredients for I08, I09, I11 |
| 18-10-0004-01 | Consumer Price Index, monthly | Pitch and Genie: food inflation context |
| 13-10-0834-01, 13-10-0835-01 | Food insecurity by family type and by demographics, 2023 to 2024 | Problem statement, e.g. the rate for persons 18 to 24. Pitch only |
| 11-10-0125-01 | Detailed food spending per household | Pitch |
| 11-10-0222-01, 11-10-0223-01 | Household spending, overall and by income quintile | Pitch: how much households spend at restaurants |
| 21-10-0019-01 | Food services and drinking places receipts, monthly | Pitch and Genie |
| 14-10-0064-01 | Employee wages by industry | Pitch: average hourly wage in accommodation and food services |

**Full tables with BC (downloaded Nov 7, 9:53 PM):** `18100245-eng.zip` (retail prices, every province, Jan 2017 to Sep 2026, 19 MB unzipped) and `18100004-eng.zip` (CPI including British Columbia and Vancouver, 161 MB unzipped). These are the sources for everything shown in the app. Upload the ZIPs as they are; the notebook unzips them and keeps only the rows we use (GEO in British Columbia, Canada, or "Vancouver, British Columbia", for the products and CPI items below) before writing Delta. The "as displayed" CSVs are kept for the pitch tables that only exist at Canada level.

Checked against the raw files. September 2026, no quality flags on any of these:

| Product | BC | Canada | BC, Sep 2025 |
|---|---|---|---|
| Apples, per kilogram | $5.01 | $4.79 | $4.99 |
| Bananas, per kilogram | $1.83 | $1.88 | $1.63 |
| Roasted or ground coffee, 340 grams | $9.66 | $9.27 | $9.31 |
| Tea (20 bags) | $4.51 | $4.46 | $4.34 |

CPI, Sep 2026 vs Sep 2025 (2002 = 100): BC food 194.8 vs 190.5 (+2.3%), BC food purchased from restaurants 191.6 vs 186.4 (+2.8%), Vancouver all-items 166.8 vs 161.9 (+3.0%).

`bc-vs-canada-food-prices.csv`, `statcan-18100245-food-staples-bc-canada.csv` and `statcan-cpi-food-bc-vancouver.csv` in Downloads are summaries someone made from the ZIPs. Their numbers match the raw data, but the pipeline never reads them: it computes everything from the ZIPs.

**Two problems that remain:**
1. **No soft drinks.** 18-10-0245-01 has no cola or soda product, so I04 and I05 have no StatCan match.
2. **Fruit is per kg.** Campus sells one banana; StatCan prices a kilogram. The conversion needs a weight per fruit, which is an assumption, so the app prints it.

**Parsing.** These are "as displayed" exports: title lines before the header, footnote numbers stuck to labels ("Apples, per kilogram 5"), quality letters on values ("26.7C"), `..` for missing values, thousands commas, one column per month, and footnotes after the data. The parser finds the header row, strips trailing footnote numbers (` \d+$`), splits each value into number and quality flag, turns `..` into null, removes commas, reshapes to one row per period, and stops at the first blank line. Full-table CSVs (columns `REF_DATE, GEO, ..., VALUE, STATUS`) need none of this. Detect which kind from the header and handle both. Output: Delta tables `statcan_<table id>` with `table_id, geo, <dimensions>, ref_period, value, status, unit`.

**Quality flags.** StatCan grades estimates from A (excellent) to F (too unreliable to publish). Drop F. Anything graded D or E is labelled "use with caution" wherever it's quoted.

**Item mapping (`data/statcan_map.csv`, in the repo, checked by hand):**

| item_id | StatCan product (exact label) | Amount per item | Kind | Assumption shown in the app |
|---|---|---|---|---|
| I20 | Bananas, per kilogram | 0.12 kg | same_item | "a medium banana, about 120 g" |
| I21 | Apples, per kilogram | 0.18 kg | same_item | "a medium apple, about 180 g" |
| I08 | Roasted or ground coffee, 340 grams | 10 g of 340 g | ingredients | "about 10 g of ground coffee for a small cup" |
| I09 | Roasted or ground coffee, 340 grams | 15 g of 340 g | ingredients | "about 15 g for a medium cup" |
| I11 | Tea (20 bags) | 1 of 20 bags | ingredients | "one tea bag" |

Sergio checks the two fruit weights (weigh one of each at the grocery). The two kinds are never mixed:
- **same_item**: the same product bought at a grocery. A BC banana works out to $1.83 × 0.12 = $0.22, so a $1.25 campus banana shows "5.7x the BC grocery price · StatCan, BC, Sep 2026 · assuming a 120 g banana". An apple works out to $0.90.
- **ingredients**: what it costs to make it yourself. "Brewing it yourself costs about $0.28 a cup · StatCan ground coffee, BC, Sep 2026" (medium cup $0.43, tea bag $0.23). Never a multiplier: a café coffee is a service, not the same product.

Always use British Columbia and the latest month in the file (Sep 2026, released Nov 4, 2026). Fall back to Canada only if a BC value is missing, and label it "Canada".

**Minutes of work:** price ÷ BC minimum wage × 60. The BC minimum wage isn't in these tables. Sergio enters it in the pipeline config as `bc_min_wage`, along with its gov.bc.ca source and effective date. 14-10-0064-01 is Canada-wide, so it's quoted in the pitch only, never used in the app.

### Synced tables (`create_synced_tables.sh`, run once)

Bundles can't define Lakebase synced tables yet, so this script uses the CLI:

```bash
databricks postgres create-synced-table workspace.serving.price_comparisons --json @price_comparisons.json --profile campus-price-map
```

- Source `workspace.cpm.gold_price_comparisons`, primary key `item_id, location_id`, scheduling policy **SNAPSHOT** (materialized views have no change data feed, so Triggered and Continuous don't apply; a snapshot of a few hundred rows takes seconds).
- Same for `workspace.serving.outlet_scores` from `gold_outlet_scores`, primary key `location_id`.
- Set `create_database_objects_if_missing: true` so the `serving` schema is created in Postgres.
- Run `databricks postgres create-synced-table -h` first and follow the real flags.
- Each synced table runs its own small managed pipeline and holds up to 16 connections. That's why we sync two tables, not six. If Free Edition refuses a second active pipeline, ask the Databricks booth, and run the syncs one after the other in the Job.

### Refresh Job (in `databricks.yml`)

`refresh`: `02_bronze_copy` → `price_engine` → `03_price_model` → refresh both synced tables (pipeline tasks on each synced table's pipeline; get the IDs from `databricks postgres get-synced-table`) → `04_grants`.

- Schedule: **every hour on the hour** (America/Vancouver) until judging ends Sun 12:15 PM, then pause it. Plus "Run now" for the demo. Hourly, not every 30 min, because a run takes about 11 minutes and Free Edition compute is limited. The dev target has no `mode: development`, because development mode pauses every schedule and refuses to unpause it.
- Measured on Nov 8: **11.4 min** for a full run (bronze copy 4.5 min, mostly serverless start-up and `%pip`; price engine 7 min), plus the snapshot sync. That's over 3 minutes, so don't wait for it live in the demo: show a recorded run.
- Deploy: `databricks bundle validate`, then `databricks bundle deploy -t dev`, then `databricks bundle run refresh -t dev`, each with `--profile campus-price-map`.
- Screenshot the Job DAG, the pipeline graph and the data quality panel for Devpost.

### Genie space (`genie_space.md`, stretch)

Tables: `gold_price_comparisons`, `gold_item_stats`, `gold_outlet_scores`, `gold_model_metrics`, `gold_price_status`, `silver_prices`, `items`, `locations`, with a one line description for each. Test and save these questions:
- "Cheapest Red Bull on campus?"
- "Which outlet is cheapest for the most items?"
- "Which outlet is most expensive for coffee?"
- "How much more does bottled water cost on campus than at Save-On-Foods?"
- "Which items have the biggest price gap between outlets?"
- "From the Nest, which cheaper options save the most over a term?" (add `gold_walk_worth` to the Genie tables)

Genie reads the last refresh, not live data, so don't ask it about pending prices.

### Demo moment

1. Snap a tag. The app shows "Your report: $3.25 · waiting for a second student".
2. A teammate taps Yes. The app shows "Just confirmed: $3.25 · comparisons update on the next refresh". This part is instant, from the live views.
3. Click Run now on the Job. Show the DAG and the data quality panel while it runs.
4. Refresh the app. The new price is official, the ranks and chips at every outlet carrying that item update, and the CHEAPEST stamp moves if it should.

## 11. Design: price tag sticker collage

Campus as a paper board. Outlets and prices are yellow price tags, items are die-cut stickers, confirmations are rubber stamps, receipts are paper slips held with tape. Playful on top, strict underneath: prices are always plain, aligned and high contrast.

### Tokens (`src/app/globals.css`, mapped into Tailwind)

```css
:root{
  --paper:#F4EEE2; --paper-2:#EAE1CF; --card:#FFFDF8;
  --ink:#1A1A1A; --ink-2:#4A4A4A;
  --tag:#FFD23F; --tag-ink:#1A1A1A;
  --cheap:#1F7A4D; --mid:#8A5A00; --pricey:#B42318;
  --pending:#3B5B8C; --tape:rgba(233,223,199,.85); --focus:#2563EB;
  --band-avg:#F2C14E;  /* average band chip: amber, distinct from --tag */
  --radius:6px; --border:2px solid var(--ink); --shadow:3px 3px 0 var(--ink);
}
```

Light theme only (it's a paper look). Support `forced-colors` mode.

### Type (`next/font/google`)

| Use | Font |
|---|---|
| Headings, buttons | Bricolage Grotesque 800 |
| Body | Source Sans 3, 16 px minimum |
| Every price | JetBrains Mono 700, tabular numbers |
| Margin notes ("cheapest!") | Caveat, 20 px minimum, decorative only, never the only place information appears |

### Components

- **PriceTag**: yellow tag, hole on the left, 2 px ink border, mono price. Rotated -2 to 2 degrees, fixed per outlet ID (not random each render).
- **ItemSticker**: the item WebP, white border baked in, `alt` = item name and size. **ItemTiles**: the scrolling row and the "See all" grid.
- **Pin**: `L.divIcon` shaped as a small PriceTag. Shows the tier (`$`, `$$`, `$$$`, `?`) on the home map and the item price on results. Hit area 44 px minimum.
- **Stamp**: outlined, slightly rotated label: CHEAPEST (green), SOLD OUT (red), PENDING (blue), STATCAN (ink).
- **PriceBand**: small flat chip beside the PriceTag, never replacing it, 2 px ink border, Source Sans 3 bold 14 px minimum. Always icon plus word:
  - good: "✓ Good price", white on `--cheap` (5.3:1)
  - average: "= Average", ink on `--band-avg` (10.4:1)
  - high: "↑ High", white on `--pricey` (6.6:1)

  The average chip isn't `--tag` yellow, so it doesn't blend into the PriceTag next to it. On results map pins, the band is the pin's border colour plus its icon next to the price.
- **Tape**: translucent strip on cards' top corners. Decorative, `aria-hidden`.
- **ReceiptCard**: white slip with a zigzag bottom edge (CSS mask), used for the I bought it sheet and saved confirmation.
- **Button**: chunky, ink border, offset shadow, 48 px tall minimum; primary is yellow.
- **BottomSheet**: results on the map slide up over the map; drag handle plus a close button.
- **ReadAloud**: speaker icon button with a text label, 48 px.
- **WakingUp**: small banner "Waking up prices…" after 3 s of loading.

### Map look

OSM tiles tinted to paper: `.leaflet-tile-pane{filter:grayscale(1) sepia(.25) contrast(.95) brightness(1.05)}`. Attribution "© OpenStreetMap contributors" stays visible.

### Motion

Sticker slap on save (scale 1.12 → 1, rotate 4 → 0 degrees, 180 ms). Tags wiggle once when a cheaper price appears. Nothing moves with `prefers-reduced-motion: reduce`.

### Accessibility (this is our Most Accessible Design submission; keep it true)

- Price tier is never colour alone: always `$`, `$$`, `$$$` plus words in list view ("cheaper than average").
- Price bands are never colour alone: always ✓ / = / ↑ plus "Good price", "Average", "High", and a spoken description with the % vs the campus median.
- Pending is never colour alone: always the word PENDING and "waiting for a second student".
- Text contrast 4.5:1 or better on every token pair used for text. Check `--pending` and `--mid` on `--tag` and `--paper` before using them for text.
- Tap targets 48 px (44 px minimum for pins).
- List view gives everything the map gives; it is a full alternative for screen readers.
- Read aloud on Results for low vision users and anyone walking.
- `aria-live="polite"` announces search results, saves and confirmations.
- Every image has alt text; decorative art is `aria-hidden`.
- Visible focus ring (`--focus`), full keyboard path, works at 200% zoom.
- Sounds off with one tap and never required.

### Figma

Figma file: (add link). Screens: Home, Results (with a pending row and a just confirmed row), Outlet, Snap (3 states), I bought it. Built from the tokens above, so code and Figma match.

## 12. Guardrails

| ID | Rule |
|---|---|
| G1 | Gemini only suggests. Nothing saves without the student tapping Looks right. |
| G2 | Item allowlist: only the 23 IDs. No match means the student picks from tiles. |
| G3 | Server price check: $0.25 to $25, `needs_review` over 3x the campus median. |
| G4 | Secrets only in Vercel env vars, `.env.local` and Databricks secrets. The owner credential is never in Vercel. The Databricks token is used only by `/api/ask`. |
| G5 | Photos compressed on the phone, base64 over 3.5 MB rejected on the server. 10 inserts per device or user per minute; 10 photo reads per device per minute, 500 per day in total. |
| G6 | `app_reader` select only; `app_writer` insert only on 4 tables. Both are native password roles. Browser never touches the DB. Synced tables are never written by the app. |
| G7 | Every price shows its source and age. Older than 14 days dimmed. Pending never shown as the main price. |
| G8 | No names, no emails. With Auth0, store only the user id. Photos read and discarded, never stored. |
| G9 | StatCan comparisons only for items in `data/statcan_map.csv`. Always show the geography and month from the data (BC, falling back to "Canada" only where BC is missing), and the assumption sentence. Ingredient comparisons are never shown as a multiplier. Estimates graded F are dropped; D or E are labelled "use with caution". |
| G10 | Notebooks, pipeline, Job and Genie never in the live request path. The app works if all of Databricks is down except Lakebase (live prices, no comparisons). Turn Lakebase scale to zero off before judging. |
| G11 | Accessibility rules in section 11 apply to every screen. |
| G12 | Only code written after 12 PM Sat Nov 7. Public repo. Both teammates on Devpost. |
| G14 | Worth the walk always shows the saving each time and the extra minutes behind every total. Time is never turned into money. The frequency is shown and the student can change it. Projections carry no "if prices hold" caveat. No interest rate is ever assumed. |
| G15 | Location: requested on first search, watched only while the page is visible, rounded to about 11 m before leaving the phone, never stored or logged. The Google Maps directions link carries the outlet's coordinates only, never the student's location. |
| G16 | Open Food Facts data stays under the ODbL with attribution. A live barcode lookup never auto-maps to an item. |
| G13 | Model estimates are never shown as a price: no PriceTag, never ranked, never in chips, stamps, savings or Read aloud. Always the word "estimated" plus a range. Shown only when the validation gate in section 10 passed. Outlets with no prices get `?`, never a tier from their type alone. |

## 13. Build order (paste one prompt at a time)

Skip steps that are already done. Step numbers are labels; **run them in this order:** 1, 2, 3, 4, 5, 6, 7, 14, 10, 8, 9, 16, 12, 13. (Steps 11 and 15 were dropped in version 8.)

**Build status (Sun Nov 8, version 12).** Merged on `main`:
- App: Steps 1, 2, 3, 4, 5 (Outlet page, full menus, Directions), 6 (Snap), 7 (voting), 8 (I bought it, last-confirmed times), 9 (Sold out, plus the location button), 14 (Worth the walk, money first), 16 (scanner), and "Wrong price?" (version 11).
- Step 10: done (version 13). The sticker art, synthesised sounds, the sound on/off button and Read aloud.
- Databricks: D1 to D8 merged. D8 uses the version 7 money-first ranking (`saving_rank`). Sergio deploys the bundle and runs the refresh Job to pick up code changes; merging alone doesn't update the workspace.
- **Left:** Step 12 (Auth0, optional) and Step 13 (Ask with Genie, optional). Steps 11 and 15 are dropped.
- **Data:** almost every live price is an AI-estimated `seed` price (about 11 are from menus). Label it as proof of concept in the demo and on Devpost, and load real price-walk prices if the team has them.

If behind, cut in this order: Step 13, D7, Step 16 (scanner), Step 12, D6, Step 9, the receipt part of Step 8, D5. Never cut D1 to D4, D8 or Step 14: Worth the walk and the Databricks engine are the submission.

Before Step 2, Sergio: create a free OpenRouteService key, put it in `.env.local` as `ORS_API_KEY`, and run `node --env-file=.env.local scripts/build-walk-matrix.mjs` once (21 outlets is one matrix call). It writes `data/walk_matrix.csv`, which the seed loads. Without it everything falls back to straight-line estimates.

App track (Sebastian, Claude Code):

1. **Scaffold and look.** "Read docs/SPEC.md. Do Step 1: scaffold the app (sections 3 and 4), add tokens, fonts and the PriceTag, PriceBand, Button, Pin and ItemTiles components (section 11), and a full-screen map Home that reads `data/outlets.csv` directly for now." **Show me:** tag pins on a full-screen paper map at 390 x 844.
2. **Database.** (Done, see section 6.) "Do Step 2: write `db/schema.sql`, `db/views.sql`, `db/roles.sql`, `scripts/build_seed.py` and `db/seed.sql` exactly as section 6. Don't run anything against the database; show me the SQL." **Show me:** the SQL. (We run it in the Lakebase SQL editor, then `npm run seed`.)
3. **Prove the pipe.** "Do Step 3: `src/lib/db.ts` as section 5 and `GET /api/health` (pipeline field `null` until D3). Then tell me which env vars to add in Vercel." **Show me:** the Vercel link `/api/health` on a phone returning 5 outlet names. If Lakebase refuses the connection from Vercel for 30 minutes, stop and tell us; we ask the Databricks booth.
4. **Read API and search.** "Do Step 4: `/api/items`, `/api/locations`, `/api/prices` with the source selection in section 8, `src/lib/geo.ts` with `watchPosition` and the live dot, `src/lib/pricing.ts`, `src/lib/search.ts` with its tests, switch the map to the API, add search, tiles and the Results page (section 7) with the Nest fallback and WakingUp." **Show me:** "Redbull" and "rdbull" both find Red Bull, nearby outlets first, cheapest first, walk times, `price_source_used: "live"`.
5. **Outlet page.** "Do Step 5: `/api/outlet/[id]` and the Outlet page. Chips and nearest cheaper links come from `serving.price_comparisons` and are hidden if it's missing. Add `src/lib/directions.ts` and the DirectionsButton (section 7, Directions) to the page." **Show me:** tapping a pin opens it; with D3 done, chips show; Directions opens Google Maps.
6. **Snap with Gemini.** "Do Step 6: `src/lib/image.ts` compression, `/api/read-photo` exactly as section 9a with rate limits, `/api/save-price`, and the Snap flow." **Show me:** 5 photos from the price walk read correctly.
7. **Pending vs Official.** "Do Step 7: pending lines with Yes / No / Not sure, `/api/vote`, statuses from the views, freshness labels, the just confirmed line, and the `PRICE_SOURCE` switch with the stale and missing fallback." **Show me:** a price goes pending, then official after a second device confirms; in pipeline mode it shows as just confirmed until the Job runs.
8. **I bought it.** "Do Step 8: the I bought it sheet (section 7) with the Directions-trip prompt, optional receipt photo, the safeguards and the last-confirmed line." **Show me:** a confirmed price shows "✓ Confirmed by a student · just now"; $700 is refused; $9.99 waits for a second student.
9. **Sold out.** "Do Step 9: `/api/stock`, Sold out buttons and stamps, expiry from `stock_status`." **Show me:** two devices mark sold out, the outlet drops below in stock ones.
10. **Art, sound, read aloud.** "Do Step 10: wire `public/items` and `public/stickers` into the components, `sounds.ts` with Web Audio, the mute toggle, motion, and the Read aloud button (`speech.ts`)." **Show me:** saving a price slaps and plays; Read aloud speaks the top 3.
12. **Auth0 with Google (Sunday, under 1 hour).** "Do Step 12: add the latest `@auth0/nextjs-auth0` following its README, Google login through Auth0. Browsing stays open; save, vote and stock store the Auth0 user id next to device_id. Never store name or email. If the AUTH0 env vars are missing, the app runs anonymous." **Show me:** log in with Google, submit a price, the row has a user_id.
13. **Ask with Genie (stretch).** "Do Step 13: `/api/ask` and `src/lib/genie.ts` as section 8, and the Ask page (section 7). Hide it if `GENIE_SPACE_ID` is unset." **Show me:** "Cheapest Red Bull on campus?" answered on a phone.

Databricks track (Sergio, in parallel, after app Step 2 has seeded Lakebase). Claude Code writes each file from section 10 and runs CLI commands only after asking (rule 11).

- **D1 Bundle and bronze.** `databricks.yml` with the pipeline and the `refresh` Job, and `02_bronze_copy.py`. **Show me:** `bronze_prices` row count equals `select count(*) from prices` in Lakebase.
- **D2 Price engine.** `price_engine.py` through `gold_price_comparisons` and `gold_parity`. **Show me:** Red Bull rows ranked 1 to N with chips, zero parity mismatches, the data quality panel.
- **D3 Serve it.** (Done Nov 8: `serving.price_comparisons` is synced into Lakebase, `app_reader` granted, the refresh Job runs bronze copy → price engine → sync → grants, and the live `/api/health` reports the pipeline. `serving.outlet_scores` waits for D5.) `create_synced_tables.sh`, `04_grants.py`, then flip `PRICE_SOURCE=pipeline` in Vercel. **Show me:** `/api/health` reports `pipeline.computed_at`, and the Outlet page shows chips.
- **D4 Refresh Job.** Schedule, Run now, timing written into section 10. **Show me:** the demo moment end to end, on a phone.
- **D5 Price model.** `03_price_model.py` (self-test on simulated data first), `gold_model_metrics`, the `outlet_scores` sync, estimated rows in `price_comparisons`. **Show me:** the self-test passing, the leave-one-out error for the model vs the item median, and home map pins with measured and estimated tiers.
- **D6 StatCan.** Upload the CSVs to the Volume (ask first), `01_statcan.py` with both parsers, `data/statcan_map.csv`, the statcan columns in `gold_price_comparisons`. **Show me:** row counts per `statcan_*` table, the banana line and the coffee ingredients line on Results, labelled with the right geography.
- **D7 Genie space.** `genie_space.md`, the five saved questions. **Show me:** all five answered correctly in the Genie UI.

App steps added in version 5:

14. **Worth the walk.** "Do Step 14: `/api/config`, `src/lib/walkworth.ts` exactly as section 10, its parity test against `tests/fixtures/walk_worth.json`, the WorthTheWalk card on Results and the Databricks Worth the walk line on the Outlet page (section 7)." **Show me:** the parity test passing, and the card on a phone for small drip coffee at 5 a week: the term, year and degree totals.
16. **Scanner (lowest priority, needs the two decisions in section 6).** "Do Step 16: `scripts/build-barcodes.mjs`, `data/barcodes.csv` with its licence file, `/api/barcode`, and the full-screen `/scan` page (section 7)." **Show me:** a Red Bull can scanned on an iPhone opens its Results.

Databricks step added in version 5:

- **D8 Worth the walk in Databricks.** `gold_walk_worth` in `price_engine.py`, the `walk_*` columns in `gold_price_comparisons`, the new pitch numbers, and the 30-row fixture export for the app's parity test. Do it right after D2. **Show me:** for Red Bull from the Nest, every cheaper outlet with saving, extra minutes and saved per term. (Version 7: see the D8 follow-up in section 10.)

## 14. Out of scope

Google Maps APIs (keyed APIs, embedded Google maps), drawing routes in the app or any routing beyond the Google Maps directions link, turn-by-turn voice navigation, indoor routing through buildings, reading prices from barcodes, assuming an interest rate or a purchase frequency for the student, live image or sound generation, Genie in the live path, an outlet-wide score on the Outlet page, storing photos, storing names or emails, dark mode, route-based "on your way" (we'd need the student's destination).

## 15. Credits (app footer and Devpost)

- Map data © OpenStreetMap contributors.
- Contains information licensed under the Open Government Licence – Canada (Statistics Canada).
- Prices reported by UBC students and the team's price walk, Nov 7, 2026.
- Illustrations made with Google Gemini in Google AI Studio.
- Outlet to outlet walking times © openrouteservice.org by HeiGIT (only if `data/walk_matrix.csv` was built), map data © OpenStreetMap contributors.
- Product data from Open Food Facts, available under the Open Database License (ODbL).

## 16. Prizes

Source: the HackCamp 2026 Devpost page (21 non-cash prizes). Every project is judged on Problem and User Research, Innovation, Technical Implementation, Design and User Experience, and Presentation.

### Entry rules

- **Superlatives:** max 2 per team.
- **Beginner prizes:** a beginner has done 1 or fewer hackathons before, and at least 66% of the team has to be beginners. With two of us, that means both.
- **Sponsor prizes:** no limit, per the opening ceremony. Confirm with an organizer.
- **MLH prizes** (Gemini, Auth0, GoDaddy, Entire): check mlh.link/hackcamp for how to enter, in case it's separate from Devpost.
- **Every submission:** GitHub link, Figma link if we have one, and a demo video up to 4 minutes (optional, but highly recommended).
- **Deadline:** Devpost closes Sun Nov 8 at 12:15 PM. Our target is 11:45 AM.

### Considered automatically (no opt in)

| Prize | Package |
|---|---|
| Overall Winner | 4 Bluetooth speakers, 4 Trader Joe's totes, 4 Stanley Minis, 4 ElevenLabs subscriptions, automatic nwHacks admission |
| Beginner Overall Winner | 4 headphones, 4 Trader Joe's totes, 4 mechanical keyboards, 4 ElevenLabs subscriptions, automatic nwHacks admission |
| nwChoice Award | 4 Tailscale Premium plans |

### What we're going for

**Superlatives (our 2, both beginner only)**

| Prize | Package | What they ask for | What we show |
|---|---|---|---|
| Best Problem-Solution Fit | 4 Tailscale Premium plans | Opt in, plus a problem statement and solution description in Devpost | Unprompted interview quotes, our biggest same item price gap (from `gold_pitch_numbers`), Worth the walk: an honest answer that sometimes says "not worth it", with the share of cheaper options that are, the problem and promise from section 1, and how we differ from Campus Nutrition |
| Most Accessible Design | 4 Tailscale Premium plans | Opt in, Figma link, and a short note on accessibility in Devpost | The section 11 list: tiers and PENDING always in words, a full list view, read aloud, 4.5:1 contrast, 48 px targets, optional sounds |

**Backups** (only if we don't qualify as beginners; still max 2)

| Prize | Package | What they ask for | What we show |
|---|---|---|---|
| Community Impact | 4 Tailscale Premium plans | Opt in, plus a short impact statement | What daily buyers save over a term, using real numbers from `gold_pitch_numbers` |
| Best Design | 4 Tailscale Premium plans | Opt in, plus the Figma link | The price tag sticker collage look (section 11) |

**Sponsor and MLH**

| Prize | Package | What they ask for | What we show | Priority |
|---|---|---|---|---|
| Best Use of Databricks | 4 Databricks x Owala bottles, 4 Databricks x Lululemon backpacks | Opt in and use at least one Databricks product | Lakebase as the app database; a Lakeflow pipeline that decides official prices and computes every item and outlet comparison, with data quality expectations and a parity check; a Bayesian hierarchical price model that scores outlets and estimates missing prices from sparse data, validated by leave-one-out; the Worth the walk economics for every item, origin and cheaper outlet, checked against the app by a parity test; synced tables serving results back to the app; the refresh Job; all deployed from the repo as a bundle; Genie | Core |
| Best Use of Gemini API (MLH) | MLH swag kits | Opt in and use the Gemini API | `/api/read-photo` reads price tags, menus and receipts; sticker art made in AI Studio | Core |
| Best Use of Auth0 (MLH) | Wireless headphones | Opt in and use Auth0 | Google login so confirmations come from different real students (Step 12) | Sunday, if it ships |
| Best Domain Name from GoDaddy Registry (MLH) | Digital gift card | Opt in with an eligible GoDaddy Registry domain | The app's domain, added in Vercel | Easy |
| Best Use of Entire (MLH) | Mini portable projector | Use as much of Entire's Sessions, Graph and Brain as we can | Claude Code sessions and prompts synced into our Git history | Check at the MLH table |
| Best Project Built with Freebuff | $200, $125 or $75 (3 winners) | Opt in, show what it does and how Freebuff helped | Only if the booth confirms it fits our build | Check |

### Not going for

Best Hardware (no hardware), n8n, DeepSpace, Maritime agents, Lovable (we build with Claude Code), Solana, Tiger Data, Vultr.

### Devpost checklist

- [ ] Opt into Best Problem-Solution Fit and Most Accessible Design (or Community Impact and Best Design if we're not beginners)
- [ ] Opt into Databricks and Gemini, plus Auth0, GoDaddy, Entire and Freebuff only if they actually shipped
- [ ] Enter the MLH prizes the way mlh.link/hackcamp says
- [ ] Problem statement and solution description
- [ ] Accessibility notes and the Figma link (section 11 still says "add link")
- [ ] Screenshots of the Job DAG, the pipeline graph, the data quality panel and the parity check at zero
- [ ] Pause the refresh Job schedule after judging
- [ ] Demo video, 4 minutes max
- [ ] Repo public, both of us on the Devpost, submitted by 11:45 AM
