# Campus Price Map — First Prototype (v0.1.0)

> **FIRST PROTOTYPE.** A working end-to-end prototype, built on 2026-11-07, to try the full product loop
> (scan → share price → see cheapest → buy → community confirmation). It runs on sample data and is meant
> for demos, feedback and as a reference for the main build, not as the final app.

Where is the thing I want cheapest on campus right now? A live, student-checked price guide for UBC, built as a
Databricks App (AppKit + React) on Lakebase Postgres.

> First prototype with sample data. Outlet prices, hours, coordinates and "BC averages" are illustrative — not real quotes
> or StatCan figures.

## Demo script (about 3 minutes)

1. **Scan** → tap **Demo: scan a Red Bull** (or scan a real 250 ml can; its real EAN is tracked).
2. **What's the price here?** → choose **The Nest**, type a price, **Share price**. The toast says what happens next
   ("waiting for 2 students…") and thanks you.
3. **Results** → cheapest first, "You'd save … at …", walking times, freshness, the $/$$/$$$ chips and the
   "Vs BC average" badge. Tap **I bought it** to confirm what you paid (optional receipt photo).
4. **You** tab → switch to **Student B**, go back to the item: you'll see "Someone reported this is now … Is that
   right?" Tap **Yes** and watch it go live (or **No** twice, as B and C, to discard it).
5. **Map** → search an item, see pins by price level, switch to the list view; tap a pin → outlet page with
   product-by-product comparisons.

## How verification works (`server/domain/rules.ts`)

| Situation | Confirmations from other students |
|---|---|
| Receipt photo, or scan within 10% of the usual price | 1 |
| Same student's shelf and checkout prices match | 1 |
| Scan with a moderate change, or a new listing | 2 |
| Typed with no proof, or a change over 25% | 3 |
| Under half or over double the campus median | held, 4 |
| Trusted contributor (≥ 80% confirmed) / often rejected (< 40%) | one fewer / one more |

Two students independently reporting the same new price go live immediately. More "no" than "yes" (with at least
two "no") discards a report. A student can never confirm their own report. When a price goes live, older open
reports for that outlet are closed so they can't overwrite it. Sold-out reports need a second student; confirmed
ones expire after 4 hours or at the end of the day, unconfirmed ones after 1 hour.

## Run and deploy (first prototype)

You need Node 22+, the Databricks CLI (`brew tap databricks/tap && brew install databricks`) and a CLI profile
for a workspace with Lakebase (`databricks auth login --host <workspace-url> --profile <your-profile>`).

1. **Database.** Either get access to the existing `campus-price-map` Lakebase project (ask Sergio), or create your own:
   `databricks postgres create-project campus-price-map --profile <your-profile>`. If you use a different project,
   update `postgres_branch` / `postgres_database` in `databricks.yml`.
2. **Local env.** `cp .env.example .env` and fill in `PGHOST`, `PGDATABASE`, `LAKEBASE_ENDPOINT` from
   `databricks postgres list-endpoints projects/campus-price-map/branches/production --profile <your-profile>`,
   plus `DATABRICKS_CONFIG_PROFILE=<your-profile>`. `.env` is git-ignored; never commit it.
3. **Deploy first, then run locally.** The app's service principal must create and own the `cpm` schema, so deploy
   once before `npm run dev` against a fresh database. Locally, the server detects that and skips schema setup.

```bash
npm install
npm test                                            # verification rule tests
databricks apps validate --profile <your-profile>
databricks apps deploy   --profile <your-profile>   # creates the app, schema and seed data
npm run dev                                         # http://localhost:8000
```

## Layout

- `server/domain/rules.ts` — pure verification rules (unit tested)
- `server/domain/service.ts` — Lakebase queries and workflows (transactions + per item/outlet advisory locks)
- `server/db/` — schema, migration, seed data
- `server/routes/api.ts` — JSON API (zod-validated)
- `client/src/pages/` — Scan, Pick item, Report price, Results, Map, Outlet, You
- `shared/types.ts` — API types shared by client and server

## Known first-prototype limits

- Receipt photos are not read (no OCR yet) and never leave the phone; a photo speeds confirmation on trust, except for
  big price jumps. A natural next step is reading receipts with a Databricks vision model or `ai_parse_document`.
- Student identity is an anonymous per-device id sent by the browser; fine for a demo, not tamper-proof.
- "BC averages" are sample values; real StatCan table 18-10-0245-01 could be loaded into Unity Catalog and synced.
