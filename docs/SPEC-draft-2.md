# Campus Price Map

Find where the exact thing you buy every day is cheapest on UBC campus, on your way.

Built at HackCamp 2026 (nwPlus, UBC Vancouver) by Sergio Lopez and Sebastian Salomon Wong. All code written after 12:00 PM, Sat Nov 7, 2026. Repo is public.

> **Claude Code: this file is the spec.** Read it fully before every task. Work through section 13 one step at a time. If a request conflicts with this file, ask before building.

Final version, Sat Nov 7, 8:15 PM. Changes from the 6:30 PM version: item tiles on home (no scanner), browser location with a Nest fallback, a "prove the pipe" step, photo compression under Vercel's 4.5 MB limit, clear Pending vs Official labels, a Databricks pipeline that decides official prices, Genie, Auth0 with Google login, Web Speech read aloud.

---

## 1. Product in 30 seconds

- **Problem:** UBC students who buy the same coffee or energy drink most days can't tell which outlet sells it cheapest, so they overpay without knowing by how much.
- **Promise:** search an item (or snap a photo) and see where it's cheapest on your way, nearby outlets first.
- **Pitch:** Campus guides tell you which places are cheap. We tell you where the exact thing you buy every day is cheapest, on your way.
- **User:** the daily buyer, on a phone, walking between classes, one hand free.
- **Never write in UI or copy:** "the only app", "nobody does this", invented stats. Campus Nutrition exists; our difference is item level and live.

## 2. Rules for Claude Code

1. One step per prompt (section 13). Stop at that step's **Show me** and wait.
2. Commit after every working step: `git commit -m "step N: <what>"`, then push. Every push deploys to Vercel.
3. Mobile first: design and test at 390 x 844. Every screen works without the map (list view).
4. The browser never talks to the database, Gemini or Databricks. Browser → `/api/*` → Lakebase, Gemini or Genie.
5. Secrets only in env vars. Never in client code, logs, commits or error messages.
6. Only the libraries in section 3. No barcode scanner, no state library, no UI kit.
7. TypeScript strict. Validate every API input with `zod`. No `any` in `src/app/api` or `src/lib`.
8. API routes that use `pg` set `export const runtime = "nodejs"`.
9. **Leaflet:** load the map component with `dynamic(() => import(...), { ssr: false })`, import `leaflet/dist/leaflet.css` once, and draw pins with `L.divIcon` (no default marker images). This avoids the blank map and broken icon bugs.
10. **Anything from Databricks is optional at runtime.** Synced tables (`official_prices`, `location_scores`, `statcan_benchmarks`) and Genie may not exist. If missing, return `null` for those fields and hide the feature. Never crash on it.
11. Unsure? Ask one question instead of guessing.

## 3. Stack

| Layer | Choice |
|---|---|
| App | Next.js, App Router, TypeScript, `src/` dir, Tailwind |
| Map | `leaflet` + `react-leaflet`, OpenStreetMap tiles, client only (rule 9) |
| Database | Databricks Lakebase (Postgres) through `pg`, SSL required |
| Data engine | Databricks notebooks + Lakeflow Declarative Pipeline + Job + synced tables (section 10) |
| Plain English questions | Databricks Genie space; Genie Conversation API from `/api/ask` (stretch) |
| AI | `@google/genai` (Gemini API) for reading photos |
| Auth | `@auth0/nextjs-auth0`, latest version, Google login (Step 12 only). Follow the SDK's README; older tutorials use a different setup. |
| Read aloud | Web Speech API (`speechSynthesis`), built into the browser, no library |
| Location | Browser Geolocation API |
| Validation | `zod` |
| Asset scripts | `sharp` (dev only) |
| Hosting | Vercel, auto deploy from `main` |

## 4. Repo layout

```
src/app/
  page.tsx                  Home: search, item tiles, map/list
  item/[id]/page.tsx        Results for one item
  outlet/[id]/page.tsx      Outlet page
  snap/page.tsx             Snap a price: camera, confirm, save
  ask/page.tsx              Ask (Genie), stretch, Step 13
  api/health/route.ts       GET   prove the pipe
  api/items/route.ts        GET
  api/locations/route.ts    GET
  api/prices/route.ts       GET ?item=I01&lat=&lng=
  api/outlet/[id]/route.ts  GET
  api/read-photo/route.ts   POST  (Gemini)
  api/save-price/route.ts   POST
  api/vote/route.ts         POST
  api/stock/route.ts        POST
  api/ask/route.ts          POST  (Genie), stretch
src/components/   PriceTag ItemSticker ItemTiles Pin Stamp Tape ReceiptCard Button CameraButton BottomSheet SoundToggle ReadAloud Toast WakingUp
src/lib/          db.ts gemini.ts genie.ts geo.ts device.ts image.ts sounds.ts speech.ts validate.ts format.ts
db/               schema.sql roles.sql views.sql
data/             items.csv outlets.csv prices.csv   (exported from the "Campus Price Map data" Google Sheet)
scripts/          seed.ts optimize-assets.ts
databricks/       01_statcan.py 02_bronze_copy.py pipeline.py 03_scores.py genie_space.md
public/items/     I01.webp ... I21.webp
public/stickers/  logo.webp empty-map.webp pending.webp sold-out.webp savings.webp thanks.webp
public/sfx/       snap.mp3 slap.mp3 chaching.mp3 thud.mp3 chime.mp3
assets/PROMPTS.md every AI Studio prompt we used (for Devpost)
```

## 5. Environment variables

| Name | Where | Value |
|---|---|---|
| `DATABASE_URL_READER` | Vercel + `.env.local` | Lakebase, role `app_reader` |
| `DATABASE_URL_WRITER` | Vercel + `.env.local` | Lakebase, role `app_writer` |
| `DATABASE_URL_ADMIN` | `.env.local` only, never Vercel | owner role, schema and seed only |
| `GEMINI_API_KEY` | Vercel + `.env.local` | from Google AI Studio |
| `GEMINI_MODEL` | Vercel + `.env.local` | `gemini-flash-latest`, or the newest stable Flash listed in AI Studio. Model names change often; swapping must be this one line. |
| `PRICE_SOURCE` | Vercel + `.env.local` | `live` (default) or `pipeline`. See section 6, verification. |
| `DATABRICKS_HOST` | Vercel only | workspace URL, Step 13 |
| `DATABRICKS_TOKEN` | Vercel only | personal access token, Step 13 |
| `GENIE_SPACE_ID` | Vercel only | from the Genie space URL, Step 13. If unset, the Ask tab is hidden. |
| `AUTH0_*`, `APP_BASE_URL` | Vercel + `.env.local` | names exactly as the Auth0 SDK README says, Step 12. If unset, the app runs anonymous. |

`.env*` is in `.gitignore`.

`src/lib/db.ts`: one `Pool` per role created once at module level (reused across requests), `max: 3`, `connectionTimeoutMillis: 15000`, `statement_timeout: 10000`. Lakebase scales to zero, so the first query after idle is slow: helper `withRetry` retries once on connection errors. On the client, if any request takes over 3 s, show `WakingUp`: "Waking up prices…".

## 6. Data

### Items (fixed IDs, 21)

```
I01 Red Bull, 250 ml can            Energy drinks
I02 Monster Energy, 473 ml can      Energy drinks
I03 Celsius, 355 ml can             Energy drinks
I04 Coca-Cola, 355 ml can           Soft drinks      StatCan candidate (per litre)
I05 Coca-Cola, 591 ml bottle        Soft drinks      StatCan candidate (per litre)
I06 Bottled water, 500 ml           Water
I07 Sparkling water, 355 ml can     Water
I08 Drip coffee, small              Hot drinks
I09 Drip coffee, medium             Hot drinks
I10 Latte, medium                   Hot drinks
I11 Tea, medium                     Hot drinks
I12 Iced coffee, medium             Cold coffee
I13 Bagel with cream cheese         Breakfast and bakery
I14 Muffin                          Breakfast and bakery
I15 Pre-made sandwich               Lunch grab and go
I16 Pre-made wrap                   Lunch grab and go
I17 Sushi roll pack                 Lunch grab and go
I18 Protein bar (one brand)         Snacks
I19 Chips, single serve             Snacks
I20 Banana                          Fruit            StatCan candidate (per kg)
I21 Apple                           Fruit            StatCan candidate (per kg)
```

The Items tab of the data sheet is the single source of truth. If it differs from this list, the sheet wins and this list gets updated.

### Outlets

`data/outlets.csv`, IDs `L01` to `L21`. Fill lat and lng from openstreetmap.org before seeding (right click, "Show address"), and skip any row without coordinates. L17 to L21 are placeholders: split them into one row per real outlet after the price walk (`L17a`, `L17b`...). `L20` Save-On-Foods Wesbrook is the grocery baseline: `is_benchmark = true`, never shown as "cheapest on campus".

### Schema (`db/schema.sql`)

```sql
create table locations (
  id text primary key, name text not null, area text, operator text, type text,
  address text, hours_weekend text, hours_weekday text,
  lat double precision not null, lng double precision not null,
  is_benchmark boolean not null default false
);
create table items (
  id text primary key, name text not null, size text not null, volume_ml int,
  category text not null, statcan_match text, image text  -- /items/I01.webp
);
create type price_source as enum ('walk','menu','grocery','photo','receipt','typed');
create table prices (
  id bigint generated always as identity primary key,
  item_id text not null references items(id),
  location_id text not null references locations(id),
  price numeric(6,2) not null check (price between 0.25 and 25),
  source price_source not null,
  device_id uuid,                       -- null for team seed rows
  user_id text,                         -- Auth0 user id after Step 12, else null
  needs_review boolean not null default false,
  reported_at timestamptz not null default now()
);
create table price_votes (
  id bigint generated always as identity primary key,
  price_id bigint not null references prices(id),
  device_id uuid not null,
  user_id text,
  vote text not null check (vote in ('yes','no','unsure')),
  created_at timestamptz not null default now(),
  unique (price_id, device_id)
);
create table stock_reports (
  id bigint generated always as identity primary key,
  item_id text not null references items(id),
  location_id text not null references locations(id),
  status text not null check (status in ('sold_out','back')),
  device_id uuid not null,
  user_id text,
  reported_at timestamptz not null default now()
);
```

**"A different student"** everywhere below means a different `user_id` when both rows have one, otherwise a different `device_id`.

### Verification: Pending vs Official

Rows are never updated; status is computed, so `app_writer` stays insert only. The same rules live in two places:

- **Live, in Postgres (`db/views.sql`)**: always works, used when `PRICE_SOURCE=live`.
- **Pipeline, in Databricks (`official_prices`, section 10)**: same rules plus data quality checks, synced back into Lakebase. Used when `PRICE_SOURCE=pipeline`. Sergio flips this once the synced table works. If the table is missing, the API falls back to live automatically.

Rules for each price row:
1. `official` if source is `walk`, `menu` or `grocery` (team data).
2. `rejected` if `no` votes from different students outnumber `yes` and `no >= 1`.
3. `official` if 1+ `yes` from a different student, or a different student reported a price within $0.10 for the same item and outlet in the last 48 h (matching reports confirm each other). A row with `needs_review` needs 2 such confirmations.
4. Otherwise `pending`.

Views:
- **`price_status`**: one row per price with its status and `confirmations` (yes count from different students).
- **`current_prices`**: newest `official` price per item and outlet, with `confirmations` and `updated_at`.
- **`pending_prices`**: newest `pending` price per item and outlet that is newer than its official row. Always read live, even when `PRICE_SOURCE=pipeline`, so a new report shows up instantly.
- **`stock_status`**: `sold_out` if 2+ different students reported `sold_out` in the last 4 h with no `back` after; `maybe_sold_out` if 1 in the last 2 h; else `in_stock`.

### Synced from Databricks (read only, may not exist)

```
official_prices(item_id, location_id, price, source, confirmations, updated_at)
location_scores(location_id, score_pct, ci_low, ci_high, n_obs, method, updated_at)
statcan_benchmarks(item_id, statcan_product, bc_price_per_unit, unit, ref_month, premium_vs_bc, minutes_of_work)
```

### Roles (`db/roles.sql`)

- `app_reader`: `select` on all tables and views in `public`, including synced tables.
- `app_writer`: `insert` on `prices`, `price_votes`, `stock_reports` only. No update, no delete.
- Seed (`scripts/seed.ts`) runs locally with `DATABASE_URL_ADMIN` from `data/*.csv`. Price log rows map `Source` to `walk`, `menu` or `grocery`.

## 7. Screens

**Home `/`**
- Top: search field "What do you want?".
- Below it: **item tiles**, all 21 item stickers in a horizontal scroll (most bought first: Red Bull, drip coffee medium, latte, water, sandwich, chips, then the rest), plus a "See all items" grid. Tapping a tile opens Results.
- Main area: Map or List (toggle in the bottom bar). Map is centred on UBC (49.2606, -123.2460), zoom 15, paper tinted tiles (section 11).
- Pins: tag shaped markers showing the outlet tier `$`, `$$`, `$$$` (from `location_scores`; `?` if no score). Grocery baseline pin is a different shape labelled "grocery".
- Bottom bar: Map / List toggle, and a big yellow **Snap a price** button (64 px).

**Location (`src/lib/geo.ts`)**
- Ask for browser location on the first search or tile tap, not on page load. Timeout 8 s.
- If allowed: walk times from the student's position.
- If denied, unavailable or timed out: measure from the AMS Nest (49.2666, -123.2499) and show one line: "Using the AMS Nest as your starting point. Turn on location for walk times from where you are."
- Walk minutes = haversine metres x 1.3 / 80 m per min, rounded up. Always labelled "about N min walk".

**Results `/item/[id]`**
- Header: item sticker, name, size, and a **Read aloud** button.
- Decision line: "You'd save $0.80 at Harvest Market, about 2 min walk" or "This is the cheapest near you."
- **On your way** (about 3 min walk or less), cheapest first. Then **Farther**, dimmed unless it saves $1.00 or more.
- Each outlet row:
  - **Official price** on a PriceTag. This is the only price ever shown big.
  - Freshness line: "Confirmed by 2 students · 20 min ago", "From our price walk · Nov 7", "Menu price · Nov 7" or "Grocery baseline". Older than 14 days: dimmed, plus "may be out of date".
  - **Pending line**, only if `pending_prices` has a row: a blue PENDING stamp and "New report: $3.25 · waiting for a second student" with **Yes / No / Not sure**. If this device made the report: "Your report: $3.25 · waiting for a second student", no buttons.
  - If the outlet has no official price yet: "No confirmed price yet" plus the pending line.
  - Sold out stamp if any, and an **I bought it here** button.
  - Rejected reports are never shown.
- Small map: pins show this item's official price; the cheapest pin gets a CHEAPEST stamp.
- "vs BC average" stamp only if `statcan_benchmarks` has the item: "1.4x the BC average · StatCan, BC, Sep 2026".
- Term line: "Buying it at the cheapest spot nearby saves about $X a term" = (nearest outlet price minus cheapest nearby) x 65 school days. Hide if X < $5.

**Outlet `/outlet/[id]`**
- Name, today's hours, items grouped by category.
- Each item: PriceTag plus one comparison chip: "Cheapest on campus", "$0.40 above campus average" or "2nd cheapest of 6", with a link to the cheaper option, pending line as on Results, and a Sold out button.
- No single score for the whole outlet on this page.

**Snap `/snap`**
1. Camera: `<input type="file" accept="image/*" capture="environment">`.
2. Compress in the browser (`src/lib/image.ts`, canvas): long edge 1280 px, JPEG quality 0.8. If still over 3 MB, redo at 1024 px and 0.6. Vercel rejects request bodies over 4.5 MB, so the server rejects anything over 4 MB with "That photo is too big, try again."
3. Reading: sticker shuffle animation, "Reading the price…"
4. Confirm, one card per item found: item (dropdown with stickers, 21 items), price (`inputmode="decimal"`, big), outlet (3 nearest suggested, then full list). Nothing saves without a tap on **Looks right**.
5. Saved: slap sound, "Your report: $3.25 · waiting for a second student", thank you toast.
- Nothing readable: "Couldn't read a price. Pick your item" → 21 sticker tiles.
- Product with no price: item preselected, "What's the price here?" with a **Skip, just show me prices** link to results.

**I bought it (bottom sheet)**: "What did you pay?" prefilled with the shown price. Confirm or fix, optional receipt photo (same compression, goes through `/api/read-photo`). Saves as `receipt` with a photo, `typed` without.

**Read aloud (`src/lib/speech.ts`)**: reads the decision line and the top 3 rows, e.g. "Cheapest on your way: Harvest Market, 2 dollars 75, about 2 minutes. Mercante, 3 dollars 10, about 4 minutes." Uses `speechSynthesis`; hide the button if the browser doesn't support it. Only starts on a tap.

**Thank you toasts**: real numbers only, from the database ("12 students searched Red Bull this week"). If there's no number, just "Thanks, that helps everyone who buys this."

**Ask `/ask` (stretch, Step 13)**: three tappable questions plus a text field. "Thinking…" state; answers can take several seconds. Shows Genie's text answer and up to 10 rows as a simple table. Hidden if `GENIE_SPACE_ID` is unset or the route errors.

## 8. API

| Route | Role | In | Out |
|---|---|---|---|
| `GET /api/health` | reader | | `{ db: "ok", ms, locations: 5 sample names }` |
| `GET /api/items` | reader | | items with image path |
| `GET /api/locations` | reader | | outlets with lat, lng, tier, hours |
| `GET /api/prices` | reader | `item`, `lat?`, `lng?` | rows: outlet, official price, source, confirmations, updated_at, walk_min, stock, pending (`{ price_id, price, mine }` or null); plus `benchmark` and `price_source_used` |
| `GET /api/outlet/[id]` | reader | | outlet, items with price, comparison, pending |
| `POST /api/read-photo` | none | `{ image: base64 jpeg, hint?: "tag"\|"product"\|"receipt" }` | draft (section 9) |
| `POST /api/save-price` | writer | `{ item_id, location_id, price, source, device_id }` | `{ id, status }` |
| `POST /api/vote` | writer | `{ price_id, vote, device_id }` | `{ status }` |
| `POST /api/stock` | writer | `{ item_id, location_id, status, device_id }` | `{ stock }` |
| `POST /api/ask` | none (server token) | `{ question }` | `{ text, columns, rows }` |

- `device_id`: random UUID created on first visit, kept in `localStorage` (wrap in try/catch). After Step 12, write routes also store the Auth0 user id from the server session. Never store name or email.
- Price check (G3): reject outside $0.25 to $25; set `needs_review` if more than 3x the item's campus median.
- Rate limit (G5): reject if this device (or user) made 10+ inserts in the last minute, counted in the database with the reader role (in memory limits don't work on Vercel). Images over 4 MB rejected.
- `/api/prices`: if `PRICE_SOURCE=pipeline` and `official_prices` exists, read official prices from it; otherwise from `current_prices`. Pending always from `pending_prices`.
- `/api/ask`: `POST {DATABRICKS_HOST}/api/2.0/genie/spaces/{GENIE_SPACE_ID}/start-conversation` with `{ content: question }`, then poll the message every 1.5 s until it's completed (max 40 s), then fetch the query result. `export const maxDuration = 60`. Questions over 200 characters rejected.
- Errors return `{ error: "plain sentence for the user" }` with the right status code.

## 9. Gemini

Two jobs: **live in the app** through the Gemini API (reading photos), and **ahead of time in Google AI Studio** (art and sound). Nothing is generated live except photo reading.

### 9a. Live: `/api/read-photo`

- Model: `process.env.GEMINI_MODEL`, SDK `@google/genai`, key from env (server only).
- Structured output: JSON mode with a response schema. Don't set temperature, top_p or top_k.
- One call reads any photo: price tag, menu board, product, or receipt. The item list is built from the `items` table and sent in the prompt.
- The image is never stored or logged (G8).

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

## 10. Databricks (Sergio's track, code lives in `databricks/`)

Nothing here is in the live path (G10). The app only reads the synced tables, and works without them.

```
Lakebase (prices, votes, stock) → 02 bronze copy → pipeline: silver → gold → synced back into Lakebase
StatCan → 01 notebook → Delta ──────────────────────┘                     → Genie space
```

1. **`01_statcan.py` (notebook):** `pip install stats_can`; `zip_table_to_dataframe` for 18-10-0245-01, 11-10-0125-01, 11-10-0223-01, 21-10-0019-01, 13-10-0835-01. On failure print FAILED and read an uploaded ZIP from a Volume instead (Free Edition limits outbound internet). Save as Delta `statcan_*`.
2. **`02_bronze_copy.py` (notebook):** read `prices`, `price_votes`, `stock_reports`, `items`, `locations` from the Lakebase catalog registered in Unity Catalog and overwrite Delta tables `bronze_*`. (Copying first means the pipeline never depends on reading Lakebase directly.)
3. **`pipeline.py` (Lakeflow Declarative Pipeline, Python), one pipeline only:**
   - `silver_prices`: expectations `expect_or_drop` price between 0.25 and 25, item_id in items, location_id in locations. Add `price_per_100ml`, campus median per item, `needs_review` if over 3x median.
   - `official_prices` (gold): apply the verification rules from section 6 exactly; output `item_id, location_id, price, source, confirmations, updated_at`, newest official per item and outlet, non benchmark outlets plus the grocery baseline flagged.
   - `statcan_benchmarks` (gold): latest BC row from 18-10-0245-01 matched on `items.statcan_match`, converted to the same unit; drop rows whose units can't be reconciled. Includes `premium_vs_bc` and `minutes_of_work` at BC minimum wage (Sergio fills the verified rate).
4. **`03_scores.py` (notebook):** reads `silver_prices`. OLS `log(price) ~ C(item) + C(outlet)` with HC1 errors, outlet effects recentred to % vs campus average; fallback median ratio index; outlets under 4 prices get null. Writes `location_scores`. Also writes `pitch_numbers` (biggest same item gap, term savings) for the Devpost.
5. **Synced tables:** `official_prices`, `location_scores`, `statcan_benchmarks` into the Lakebase database, **Snapshot mode** (gold tables built as materialized views can only sync in Snapshot mode). Free Edition allows one active pipeline per pipeline type, so ask the Databricks booth if two syncs clash, and run them one at a time if they do.
6. **Job:** 01 → 02 → pipeline → 03 → sync refresh. Hourly during the event, plus "Run now" for the demo. Screenshot the DAG and the data quality panel for Devpost.
7. **Genie space (`genie_space.md`):** on `official_prices`, `location_scores`, `statcan_benchmarks`, `silver_prices`, `items`, `locations`. One line description per table. Test and save these questions: "Cheapest Red Bull on campus?", "Which outlet is most expensive for coffee?", "How much more does bottled water cost on campus than the BC average?", "Which items have the biggest price gap between outlets?", "Which prices are still pending?"

Demo moment: snap a tag → "Your report: pending" → teammate taps Yes → Run now → the official price changes on the map.

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
- **Stamp**: outlined, slightly rotated label: CHEAPEST (green), SOLD OUT (red), PENDING (blue), vs BC AVERAGE (ink).
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
- Pending is never colour alone: always the word PENDING and "waiting for a second student".
- Text contrast 4.5:1 or better on every token pair used for text.
- Tap targets 48 px (44 px minimum for pins).
- List view gives everything the map gives; it is a full alternative for screen readers.
- Read aloud on Results for low vision users and anyone walking.
- `aria-live="polite"` announces search results, saves and confirmations.
- Every image has alt text; decorative art is `aria-hidden`.
- Visible focus ring (`--focus`), full keyboard path, works at 200% zoom.
- Sounds off with one tap and never required.

### Figma

Figma file: (add link). Screens: Home, Results (with a pending row), Outlet, Snap (3 states), I bought it. Built from the tokens above, so code and Figma match.

## 12. Guardrails

| ID | Rule |
|---|---|
| G1 | Gemini only suggests. Nothing saves without the student tapping Looks right. |
| G2 | Item allowlist: only the 21 IDs. No match means the student picks from tiles. |
| G3 | Server price check: $0.25 to $25, `needs_review` over 3x the campus median. |
| G4 | Secrets only in Vercel env vars and `.env.local`. Databricks token is Vercel only. |
| G5 | Photos compressed on the phone, rejected over 4 MB on the server. Max 10 inserts per device or user per minute. |
| G6 | `app_reader` select only; `app_writer` insert only on 3 tables. Browser never touches the DB. |
| G7 | Every price shows its source and age. Older than 14 days dimmed. Pending never shown as the main price. |
| G8 | No names, no emails. With Auth0, store only the user id. Photos read and discarded, never stored. |
| G9 | StatCan stamp only on true per-unit matches, labelled "BC average" with table month. |
| G10 | Notebooks, pipeline, Job and Genie never in the live path; the app works if all of Databricks is down except Lakebase. Open the app 10 min before judging to wake Lakebase. |
| G11 | Accessibility rules in section 11 apply to every screen. |
| G12 | Only code written after 12 PM Sat Nov 7. Public repo. Both teammates on Devpost. |

## 13. Build order (paste one prompt at a time)

Skip steps that are already done. If behind, cut in this order: Step 13, Step 12, Step 9, the receipt part of Step 8, the StatCan stamp in Step 11.

1. **Scaffold and look.** "Read README.md. Do Step 1: scaffold the app (sections 3 and 4), add tokens, fonts and the PriceTag, Button, Pin and ItemTiles components (section 11), and a Home that reads `data/outlets.csv` directly for now." **Show me:** tag pins on a paper map at 390 x 844.
2. **Database.** "Do Step 2: write `db/schema.sql`, `db/views.sql`, `db/roles.sql` and `scripts/seed.ts` exactly as section 6. Don't run anything against the database; show me the SQL." **Show me:** the SQL. (We run it in the Lakebase SQL editor, then `npm run seed`.)
3. **Prove the pipe.** "Do Step 3: `src/lib/db.ts` as section 5 and `GET /api/health`. Then tell me which env vars to add in Vercel." **Show me:** the Vercel link `/api/health` on a phone returning 5 outlet names. If Lakebase refuses the connection from Vercel for 30 minutes, stop and tell us; we ask the Databricks booth.
4. **Read API and search.** "Do Step 4: `/api/items`, `/api/locations`, `/api/prices`, `src/lib/geo.ts`, switch the map to the API, add search, tiles and the Results page (section 7) with the Nest fallback and WakingUp." **Show me:** search Red Bull, nearby outlets first, cheapest first, walk times.
5. **Outlet page.** "Do Step 5: `/api/outlet/[id]` and the Outlet page with per item comparison chips." **Show me:** tapping a pin opens it.
6. **Snap with Gemini.** "Do Step 6: `src/lib/image.ts` compression, `/api/read-photo` exactly as section 9a, `/api/save-price`, and the Snap flow." **Show me:** 5 photos from the price walk read correctly.
7. **Pending vs Official.** "Do Step 7: pending lines with Yes / No / Not sure, `/api/vote`, statuses from the views, freshness labels, and the `PRICE_SOURCE` switch with automatic fallback." **Show me:** a price goes pending, then official after a second device confirms.
8. **I bought it.** "Do Step 8: the I bought it sheet with optional receipt photo." **Show me:** a receipt photo prefills the price.
9. **Sold out.** "Do Step 9: `/api/stock`, Sold out buttons and stamps, expiry from `stock_status`." **Show me:** two devices mark sold out, the outlet drops below in stock ones.
10. **Art, sound, read aloud.** "Do Step 10: wire `public/items` and `public/stickers` into the components, `sounds.ts` with Web Audio, the mute toggle, motion, and the Read aloud button (`speech.ts`)." **Show me:** saving a price slaps and plays; Read aloud speaks the top 3.
11. **Polish.** "Do Step 11: StatCan stamp and term savings line if the synced tables exist, location tiers from `location_scores`, footer credits (section 15), then an accessibility pass against section 11." **Show me:** a Lighthouse accessibility score and anything below 100.
12. **Auth0 with Google (Sunday, under 1 hour).** "Do Step 12: add the latest `@auth0/nextjs-auth0` following its README, Google login through Auth0. Browsing stays open; save, vote and stock store the Auth0 user id next to device_id. Never store name or email. If the AUTH0 env vars are missing, the app runs anonymous." **Show me:** log in with Google, submit a price, the row has a user_id.
13. **Ask with Genie (stretch).** "Do Step 13: `/api/ask` and `src/lib/genie.ts` as section 8, and the Ask page (section 7). Hide it if `GENIE_SPACE_ID` is unset." **Show me:** "Cheapest Red Bull on campus?" answered on a phone.

Databricks track (Sergio, in parallel): D1 `01_statcan.py` → D2 `02_bronze_copy.py` → D3 `pipeline.py` → D4 `03_scores.py` → D5 synced tables → D6 Job → D7 Genie space. Claude Code can draft each file from section 10; run them in Databricks.

## 14. Out of scope

Barcode scanning, live image or sound generation, Genie in the live path, an outlet-wide score on the Outlet page, storing photos, storing names or emails, dark mode.

## 15. Credits (app footer and Devpost)

- Map data © OpenStreetMap contributors.
- Contains information licensed under the Open Government Licence – Canada (Statistics Canada).
- Prices reported by UBC students and the team's price walk, Nov 7, 2026.
- Illustrations made with Google Gemini in Google AI Studio.
