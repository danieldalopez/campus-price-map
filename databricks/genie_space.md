# Genie space: Campus Price Map (D7)

A Genie space over the price engine's output, so anyone can ask the campus price data a question in plain English. It reads the last pipeline refresh, not live reports, so it doesn't know about pending prices. Stretch goal from docs/SPEC.md section 10.

- **Warehouse:** Serverless Starter Warehouse (`151d758ce418d586`)
- **Payload:** `databricks/genie/space.json`, built by `python3 databricks/genie/build_space.py > databricks/genie/space.json`
- **Space id:** `01f1db5bdd7d1d6386d0ac29020a1c24` (use as `GENIE_SPACE_ID` for Step 13), in `/Workspace/Users/<you>/genie_spaces`
- **Update after editing the builder:** `databricks genie update-space 01f1db5bdd7d1d6386d0ac29020a1c24 --json '{"serialized_space": ...}' --profile campus-price-map` (ask first, rule 11)

## Tables (all in `workspace.cpm`)

| Table | One line |
|---|---|
| `gold_price_comparisons` | One row per item and outlet with an official price: rank, campus median, % vs median, band, nearest cheaper, grocery and StatCan comparisons |
| `gold_item_stats` | One row per item: campus min, median, max, spread, cheapest and priciest outlet, grocery baseline price |
| `gold_outlet_scores` | One row per outlet: price model score, $ / $$ / $$$ tier, how many items it's cheapest for |
| `gold_model_metrics` | Price model validation numbers (self-test, leave-one-out gate) |
| `gold_walk_worth` | Worth the walk: every item, origin outlet and cheaper outlet in walking range, saving per purchase and over a term, year, degree |
| `gold_price_status` | Pending vs official status of every price report |
| `silver_prices` | Every valid price report after data quality checks |
| `bronze_items` | The 23 items (the spec's `items`) |
| `bronze_locations` | Every outlet with its campus area (the spec's `locations`) |

Hidden from Genie: device and user ids, map coordinates, and the wage based Worth the walk columns that SPEC v7 stopped using.

## Context given to Genie

- Join specs from every table to `bronze_items` and `bronze_locations`.
- "Campus" excludes the Save-On-Foods grocery baseline (`is_benchmark`).
- "Coffee" is I08, I09, I10 and I12 (drip, latte, iced); tea isn't coffee.
- "The Nest" is `area = 'AMS Nest'`.
- Savings over a term, year or degree assume one purchase a week (13, 26 and 104 weeks).
- Three example SQL queries teaching the shapes: cheapest outlet for an item, outlets compared across a group of items, Worth the walk from one origin.

## Saved questions and checked answers

Checked with SQL against the refresh of Nov 8, 2026, 09:12 UTC, then asked in the space on the 09:58 UTC refresh: **all six answered correctly** (same outlets and numbers). The six are saved as the space's sample questions. Answers move as prices change.

| Question | Expected answer |
|---|---|
| Cheapest Red Bull on campus? | H-Mart for both sizes: $3.19 (250 ml), $3.89 (355 ml) |
| Which outlet is cheapest for the most items? | H-Mart, cheapest for 10 items; then the three Tim Hortons with 6 each |
| Which outlet is most expensive for coffee? | Blue Chip Cafe, 9.1% above the campus median on average across 4 coffee items |
| How much more does bottled water cost on campus than at Save-On-Foods? | $0.60 more at the campus median ($2.59 vs $1.99); campus ranges $1.89 to $2.95 |
| Which items have the biggest price gap between outlets? | Pre-made wrap ($6.00, $5.49 to $11.49), then pre-made sandwich ($4.76) and sushi ($2.99) |
| From the Nest, which cheaper options save the most over a term? | Pre-made wrap from UpMeals (The Nest) to Tim Hortons (Orca House): $4.00 a time, 8 extra minutes, $52.00 a term |
