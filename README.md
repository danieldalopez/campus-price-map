# Campus Price Map

**Find the cheapest coffee, Red Bull or sandwich near you at UBC.**

Built in 24 hours at [HackCamp 2026](https://hackcamp-2026.devpost.com/) (nwPlus, UBC Vancouver) by a team of two.

| | |
|---|---|
| Live app | _add Vercel link_ |
| Demo video | _add link_ |
| Figma | _add link_ |
| Devpost | _add link_ |

> **📋 Master plan:** [`docs/SPEC.md`](docs/SPEC.md) is the build spec we work from: product, data, the Databricks
> price engine, design, guardrails, build order for both tracks, and the prizes we're going for.

> **🧪 FIRST PROTOTYPE available:** [`first-prototype/`](first-prototype/) is a working first prototype (v0.1.0) of
> the full loop (scan → share price → cheapest first → "Did you buy it?" → community confirmation, sold out, map,
> outlet pages, thank-yous). It is a Databricks App (AppKit + React) on Lakebase with **sample data**, built as a
> reference and demo for the main build. See [`first-prototype/README.md`](first-prototype/README.md) to run it.

---

## The problem

UBC students who buy the same coffee or energy drink most days can't tell which outlet sells it cheapest, so they overpay without knowing by how much.

The same item can cost noticeably more at one outlet than at another a few minutes away: the Nest, Mercante, Harvest Market, the International Food Village, University Village, Wesbrook Village and more. Campus Nutrition has done great work here, including a 2023 comparison of grocery prices at five stores around UBC. What we haven't found is a way to see what an everyday café item, like a medium drip coffee or a Red Bull, costs at each campus food outlet right now. So students go to whatever is closest or most familiar.

On a single purchase the gap is small. For something you buy most school days, it can add up over a term, and that matters for students already on a tight budget.

## What we're building

A mobile web app with a campus map that shows the price of 21 everyday items at the outlets we track. Search an item and see where it's cheapest **near you**, closest outlets first. Prices come from students: snap a photo of a price tag, Gemini reads it, you confirm, and it lands on the map.

> **Find where the exact coffee or energy drink you buy every day is cheapest near you, right now, from prices students share.**

We don't ask anyone to make a long trip. Results start with outlets a short walk away, and farther ones only stand out when the saving is worth it.

## Who it's for

- **The daily buyer** (who we design for first): buys coffee or an energy drink most days, so savings actually compound.
- **The in store decider:** holding a Red Bull at the counter, wondering if it's cheaper next door.
- **The new student:** first years, exchange and international students still learning campus.
- **The between classes student:** fifteen minutes, hungry, wants a quick and fair answer.

## How it works

### Built for HackCamp

1. **Map home.** Every outlet is a pin on a UBC map. Pins show price level with colour *and* a `$`, `$$` or `$$$` label, so colour is never the only signal. Search bar asks "What do you want?" and a list view shows everything without the map.
2. **Search results.** Every tracked outlet selling the item, measured from where you are or a spot you pick on the map. Close outlets come first, cheapest first, then farther ones. Each row shows price, approximate distance (straight line, not a walking route), source and when it was last updated. A line at the top frames the choice ("80 cents less at Harvest Market, about 150 m away") and shows the math for a term: "80 cents × 4 a week × 12 weeks ≈ $38, if prices hold and you switch every time."
3. **Snap a price tag.** Take a photo, Gemini reads item, size and price, the app matches it to our item list, you confirm or fix it, and it saves. The new price shows up on the map right away.
4. **Outlet page.** Hours and every tracked item it sells, each with its own comparison ("Cheapest on campus", "40 cents above campus average"). There's no single cheap or expensive score for a whole outlet, because a place can have the cheapest coffee and the priciest Red Bull.
5. **"vs BC average" badge.** Where a campus item truly matches Statistics Canada's provincial price data, a small badge compares the two, clearly labelled as a BC average.
6. **Sold out button.** Saves the next student a wasted trip.
7. **Directions in Google Maps.** Tap "Directions" on any outlet and the app opens Google Maps with walking directions to it. That hand-off is the only routing the app does: it doesn't draw routes or give turn-by-turn directions itself. Distances in the app stay approximate.

### Where it's going

- **Scanner first home screen:** open the app in a store, scan the barcode, and it knows the item and the outlet.
- **"Did you buy it?"** after checkout, to capture the price actually paid.
- **Community verification:** new prices and sold out reports stay pending until other students confirm them. Receipts and matching reports move faster; big jumps need more confirmations.
- **Thank yous** that show contributors how many students they helped.
- More items and outlets, nearby grocery stores, student reported deals, and alerts when your usual item is cheaper nearby.

## The items we track

21 items in 9 categories, chosen because they're sold at several outlets, come in fixed sizes so prices compare fairly, and are things students buy daily. A sample:

- **Energy drinks:** Red Bull 250 ml, Monster 473 ml, Celsius 355 ml
- **Soft drinks and water:** Coca‑Cola can and bottle, bottled water 500 ml, sparkling water
- **Coffee and tea:** drip coffee small and medium, latte, iced coffee, tea
- **Grab and go:** bagel with cream cheese, muffin, premade sandwich, wrap, sushi pack
- **Snacks:** protein bar, chips, banana or apple

Different sizes are compared per 100 ml.

## Architecture

The browser only ever talks to our Vercel API routes. It never connects to the database or to Gemini directly.

```mermaid
flowchart LR
  S["Student on phone"] --> APP["Next.js app on Vercel"]
  APP --> OSM["OpenStreetMap tiles"]
  APP --> P["/api/prices<br/>read only role"]
  APP --> RT["/api/read-tag"]
  APP --> SP["/api/save-price<br/>insert only role"]
  RT --> GEM["Gemini API"]
  P --> DB[("Databricks Lakebase<br/>Postgres")]
  SP --> DB
  SHEET["Price walk sheet"] --> DB
  DB --> NB["Databricks notebook<br/>price model + StatCan benchmarks"]
  SC["StatCan Web Data Service"] --> NB
  NB --> DT[("Delta tables")]
  DT -->|"synced tables"| DB
  JOB["Monthly Job"] --> NB
```

**Find the cheapest spot:** search calls `/api/prices`, which reads Lakebase with the `app_reader` role and returns outlets sorted closest first, then cheapest. Per item comparisons ("40 cents above campus average") use the typical campus price from our price model (see [Price analysis](#price-analysis)), and fall back to the campus median of current prices until the notebook has run.

**Log a price:** the photo goes to `/api/read-tag`, which sends it to Gemini with the key from Vercel environment variables. Gemini returns item, size and price as JSON, the route matches it to our item list, and the student confirms. `/api/save-price` validates it and inserts with the `app_writer` role.

**Data engine:** Lakebase is registered in Unity Catalog, so a Databricks notebook reads `prices` directly. The notebook fits a fixed effects price model to get a fair typical campus price per item, pulls StatCan tables with `stats_can`, and builds BC benchmarks for the items that truly match. Both are Delta tables that sync back into Lakebase as read only synced tables. A monthly Job reruns it when StatCan publishes. Notebooks and Jobs never sit in the live path.

## Tech stack

| Layer | Tool |
|---|---|
| App | Next.js (App Router, TypeScript) and React, written with Claude Code |
| Map | Leaflet + OpenStreetMap |
| Walking directions | Hand-off to Google Maps (a link that opens it); no routing in the app |
| Hosting and secrets | Vercel (every push to `main` deploys) |
| App database | Databricks Lakebase (managed Postgres) |
| Analytics | Databricks notebooks, Delta tables, Unity Catalog, synced tables, Jobs |
| Price tag reading | Gemini API |
| Public data | Statistics Canada via the `stats_can` Python library |
| Design | Figma |

## Data

### Lakebase (app database)

| Table | What's in it | Source |
|---|---|---|
| `locations` | Outlet name, area, operator, hours, lat, lng | UBC Food Services and AMS pages; coordinates from OpenStreetMap |
| `items` | 21 tracked items, size, category, StatCan match | Chosen by the team |
| `prices` | Price per item per outlet, time, `source` (walk, menu, photo) | Our price walk, online menus, then students |
| `stock_reports` | Sold out reports | Students |
| `campus_typical_prices` | Typical campus price per item from the price model, with the number of prices behind it | Synced from Databricks |
| `statcan_benchmarks` | BC average price for matched items, per unit, by month | Synced from Databricks |

### Statistics Canada tables

| Table | What it is | How we use it |
|---|---|---|
| 18‑10‑0245‑01 | Monthly average retail prices | The "vs BC average" badge |
| 11‑10‑0125‑01 | Detailed food spending | Pitch context |
| 11‑10‑0223‑01 | Household spending by income quintile | Who feels food costs most |
| 21‑10‑0019‑01 | Food services and drinking places sales | Spending trend |
| 13‑10‑0835‑01 | Food insecurity by demographic | Why affordability matters |

StatCan is supporting context, not the headline. We only compare true per unit matches, and we label every figure as a provincial average that lags a couple of months.

## Price analysis

A plain average is misleading here. Outlets stock different things, so a café that mostly sells lattes looks expensive next to a store that mostly sells water, even if it charges less for the same items. So the Databricks notebook compares outlets on the **same items** with a fixed effects model:

```
log(price) = item effect + outlet effect + error
```

- The **item effect** absorbs that a sandwich costs more than a banana.
- The **outlet effect** is what's left: how much more or less an outlet charges for the same thing. Because prices are in logs, `exp(b) - 1` reads as a percentage.
- We fit it with OLS and robust (HC1) standard errors, and recentre outlet effects on the campus average rather than on one outlet.
- A mixed model with outlets as random effects runs alongside it, so outlets with only a few prices are pulled toward the average instead of swinging wildly.

```python
import numpy as np, statsmodels.formula.api as smf

ols = smf.ols("np.log(price) ~ C(item_id) + C(location_id)", data=df).fit(cov_type="HC1")
shrunk = smf.mixedlm("np.log(price) ~ C(item_id)", df, groups=df["location_id"]).fit()
```

### What the model is used for

| Output | Where it goes |
|---|---|
| Typical campus price per item (the model's prediction at an average outlet) | Synced to Lakebase as `campus_typical_prices`. It's the "campus average" behind item labels like "40 cents above campus average", and the campus side of the "vs BC average" badge. It doesn't depend on which outlets we happened to visit. |
| Outlet effects with 95% intervals | The notebook and the pitch only: "controlling for what they sell, the priciest outlet charges X% more than the cheapest for the same items." |

The app never shows a single cheap or expensive score for a whole outlet. A place can have the cheapest coffee and the priciest Red Bull, so every comparison a student sees is about one item.

### Keeping it honest

- **Enough data first.** Only outlets with 4 or more prices, and only items sold at 2 or more outlets, so every outlet is compared through items it shares with others. Anything thinner shows "not enough data".
- **Clean inputs.** Walk and photo prices by default. Menu prices can be stale or exclude tax, so they're only included behind a flag.
- **Descriptive, not causal.** We say an outlet charges more for the same item, never why. It's one snapshot from a small sample.
- **StatCan stays separate.** Only a few items match, in different units, so the BC comparison is a per unit ratio outside the regression.
- **Fallback.** If the model won't fit cleanly, the notebook uses a median ratio index (each price divided by that item's campus median, averaged per outlet) and records which method ran.

## Guardrails

- **Gemini only suggests.** Nothing saves until a student confirms it, and reads are matched to our item list.
- **Sanity checks on the server.** Prices under $0.25 or over $25 are rejected; anything far above the item's usual price is flagged.
- **Least privilege database roles.** `app_reader` can only select; `app_writer` can only insert into `prices` and `stock_reports`. No edits or deletes from the app.
- **Secrets stay server side.** The Gemini key and database passwords live only in Vercel environment variables and `.env.local`, which is never committed.
- **Rate and size limits.** Photos under 5 MB, about 10 reports per device per minute.
- **Honest labels.** Every price shows its source and when it was updated; stale prices are dimmed.
- **Light on personal data.** No accounts or names. Tag photos are sent to the Gemini API to read the price and aren't stored by the app. Your location is only used for the search, never saved.
- **Accessible by default.** `$` labels alongside colour, strong contrast, big tap targets, and a full list view as an alternative to the map.

## Running it locally

```bash
git clone <this repo>
cd campus-price-map
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev
```

Environment variables (names may change as we build):

```
GEMINI_API_KEY=            # from Google AI Studio
LAKEBASE_READER_URL=       # Postgres connection string for app_reader, SSL on
LAKEBASE_WRITER_URL=       # Postgres connection string for app_writer, SSL on
```

Free Edition Lakebase scales to zero when idle, so the first request after a quiet stretch can be slow. Open the app a few minutes before a demo.

## Repo layout

- `docs/SPEC.md` **master plan**: the build spec both of us (and our Claude Code sessions) work from
- `data/` seed prices from the campus price walk, the item and outlet lists, and StatCan extracts
- `notebooks/` Databricks notebooks for the price model and StatCan benchmarks
- `prompts/` Claude Code and Gemini prompts
- `first-prototype/` **FIRST PROTOTYPE** (v0.1.0): working Databricks App on Lakebase with sample data

## What we know so far

We're keeping ourselves honest about what's evidence and what's still a guess.

| Claim | Status |
|---|---|
| The same item costs different amounts at different outlets | Evidence from online menus and early interviews; confirming on the price walk |
| We've both overpaid at one outlet and found it cheaper at another | Our own experience |
| Students bring up price without being asked | Still testing: interviewing with a script that never mentions price |
| Students would walk about 10 minutes to save $2 | Our guess, testing in every interview |
| Campus Nutrition compared grocery prices at five stores near UBC (2023), not café items at campus outlets | Confirmed via UBC Wellbeing; still checking what the current site shows |

## Prize tracks we're entering

- **Superlatives:** Best Problem‑Solution Fit and Most Accessible Design (beginner stream), with Community Impact as a backup
- **Best Use of Databricks:** Lakebase as the app database, a notebook with a fixed effects price model and StatCan benchmarks, synced tables, monthly Job
- **Best Use of Gemini API (MLH):** reading price tag photos
- **GoDaddy Registry domain (MLH)**, plus Entire and Auth0 if time allows

## Credits

- Map data © OpenStreetMap contributors
- Contains information licensed under the Open Government Licence – Canada (Statistics Canada)
- Prices reported by UBC students

Built from a fresh repository during HackCamp 2026 (hacking began 12:00 PM, November 7), with the app written using Claude Code.

## Team

Sergio Lopez and Sebastian Salomon Wong, UBC Vancouver.

- **Product and Data:** research, interviews, Figma, Databricks and StatCan, Devpost and pitch
- **Builder:** the app with Claude Code, the map, Gemini photo logging, GitHub and Vercel
