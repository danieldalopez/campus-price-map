"""Build the Genie space payload for D7 (docs/SPEC.md section 10, "Genie space").

    python3 databricks/genie/build_space.py > databricks/genie/space.json

Prints the serialized_space JSON (version 2). Ids are fixed so re-running gives the same file,
and `databricks genie update-space` can push it again after edits. Questions and checked answers
are documented in databricks/genie_space.md.
"""

import hashlib
import json

C = "workspace.cpm"


def sid(key: str) -> str:
    """Stable 32-hex id from a key, so the file doesn't change between runs."""
    return hashlib.md5(key.encode()).hexdigest()


def col(name, description=None, synonyms=None, match=False, exclude=False):
    c = {"column_name": name}
    if description:
        c["description"] = [description]
    if synonyms:
        c["synonyms"] = synonyms
    if match:
        c["enable_format_assistance"] = True
        c["enable_entity_matching"] = True
    if exclude:
        c["exclude"] = True
    return c


# Wage based columns: kept in the tables, no longer used since SPEC v7 (Worth the walk is money only).
WAGE_COLS_WALK = ["wage", "time_cost", "net", "verdict", "break_even_wage", "break_even_min",
                  "net_term", "net_year", "net_degree", "net_rank", "minutes_term", "minutes_year", "minutes_degree"]
WAGE_COLS_CMP = ["walk_time_cost", "walk_net", "walk_verdict", "walk_break_even_wage",
                 "walk_net_term_per_weekly", "minutes_of_work"]
PRIVATE = ["device_id", "user_id", "reporter"]

TABLES = {
    "bronze_items": [
        col("id", "Item id, I01 to I23. Join key for item_id in every other table."),
        col("name", "Item name as students say it, e.g. Red Bull, Drip coffee, Bottled water.", ["item", "product"], match=True),
        col("size", "Pack or cup size, e.g. 250 ml can, small (10 to 12 oz). The same name can have two sizes (Red Bull 250 ml and 355 ml).", match=True),
        col("category", "Item group, e.g. Energy drinks, Hot drinks, Cold coffee, Snacks, Fruit.", match=True),
        col("aliases", "Other spellings people type, pipe separated."),
        col("image", exclude=True),
        col("copied_at", exclude=True),
    ],
    "bronze_locations": [
        col("id", "Outlet id. Join key for location_id, origin_location_id, cheaper_location_id and the *_location_id columns."),
        col("name", "Outlet name, e.g. H-Mart, Tim Hortons (David Lam), Starbucks (Bookstore).", ["outlet", "store", "shop", "cafe"], match=True),
        col("area", "Campus area, e.g. AMS Nest, Academic core, University Village, Residences. 'the Nest' means area = 'AMS Nest'.", ["building", "zone"], match=True),
        col("operator", match=True),
        col("type", "Outlet type, e.g. cafe, convenience, grocery.", match=True),
        col("is_benchmark", "True only for the off campus grocery baseline, Save-On-Foods (Wesbrook Village). Not a campus outlet."),
        col("hours", "Opening hours as text."),
        col("lat", exclude=True), col("lng", exclude=True), col("poi_id", exclude=True),
        col("location_precision", exclude=True), col("copied_at", exclude=True),
    ],
    "gold_item_stats": [
        col("item_name", match=True),
        col("spread", "campus_max minus campus_min: the price gap between the cheapest and priciest campus outlet.", ["price gap", "price range", "difference"]),
        col("grocery_price", "Price at the grocery baseline, Save-On-Foods (Wesbrook Village).", ["Save-On-Foods price", "grocery store price"]),
        col("campus_median", "Median official price across campus outlets.", ["typical price", "average price on campus"]),
    ],
    "gold_model_metrics": [],
    "gold_outlet_scores": [
        col("score_pct", "How far the outlet's prices sit from the campus median overall, in percent. Negative is cheaper."),
        col("tier", "$ cheaper, $$ average, $$$ pricier. Empty when there's too little data.", match=True),
        col("n_items_cheapest", "How many items this outlet is the cheapest on campus for."),
    ],
    "gold_price_comparisons": (
        [
            col("is_benchmark", "True for the grocery baseline row. Exclude it (NOT is_benchmark) for campus answers."),
            col("price", "Official price in CAD."),
            col("rank", "1 is the cheapest campus outlet for this item. Ties share a rank."),
            col("pct_vs_median", "Percent above (+) or below (-) the campus median for this item.", ["markup", "premium"]),
            col("band", "good, average or high versus the campus median.", match=True),
            col("source", "Where the price came from: seed (team price walk), menu (posted menu), photo, student.", match=True),
            col("chip", "The label the app shows, e.g. 'Cheapest on campus'."),
            col("est_price", exclude=True), col("est_low", exclude=True), col("est_high", exclude=True),
        ]
        + [col(c, exclude=True) for c in WAGE_COLS_CMP]
    ),
    "gold_price_status": [col(c, exclude=True) for c in PRIVATE] + [
        col("status", "pending or official.", match=True),
    ],
    "gold_walk_worth": (
        [
            col("origin_name", "Outlet the student starts from.", ["from", "starting point"], match=True),
            col("cheaper_name", "Cheaper outlet within walking range.", ["walk to"], match=True),
            col("saving", "Dollars saved per purchase by buying at the cheaper outlet."),
            col("extra_min", "Extra walking minutes, there and back."),
            col("saved_term", "Dollars saved over a term, buying once a week (saving times weeks_term).", ["savings per term", "over a term"]),
            col("saved_year", "Dollars saved over a year, buying once a week."),
            col("saved_degree", "Dollars saved over a degree, buying once a week."),
            col("saving_rank", "1 is the suggested cheaper outlet from that origin for that item (the biggest saving)."),
        ]
        + [col(c, exclude=True) for c in WAGE_COLS_WALK]
    ),
    "silver_prices": [col(c, exclude=True) for c in PRIVATE],
}

DESCRIPTIONS_NOTE = "Table descriptions come from the Unity Catalog comments set by the pipeline."

JOINS = [
    ("gold_price_comparisons", "bronze_items", "item_id", "id", "MANY_TO_ONE"),
    ("gold_price_comparisons", "bronze_locations", "location_id", "id", "MANY_TO_ONE"),
    ("gold_item_stats", "bronze_items", "item_id", "id", "ONE_TO_ONE"),
    ("gold_outlet_scores", "bronze_locations", "location_id", "id", "ONE_TO_ONE"),
    ("gold_walk_worth", "bronze_locations", "origin_location_id", "id", "MANY_TO_ONE"),
    ("gold_price_status", "bronze_items", "item_id", "id", "MANY_TO_ONE"),
    ("gold_price_status", "bronze_locations", "location_id", "id", "MANY_TO_ONE"),
    ("silver_prices", "bronze_items", "item_id", "id", "MANY_TO_ONE"),
    ("silver_prices", "bronze_locations", "location_id", "id", "MANY_TO_ONE"),
]

SAMPLE_QUESTIONS = [
    "Cheapest Red Bull on campus?",
    "Which outlet is cheapest for the most items?",
    "Which outlet is most expensive for coffee?",
    "How much more does bottled water cost on campus than at Save-On-Foods?",
    "Which items have the biggest price gap between outlets?",
    "From the Nest, which cheaper options save the most over a term?",
]

# Example SQL teaches query shapes (cheapest per item, outlet ranking, walk savings), not the exact sample questions.
EXAMPLES = [
    ("Where is the cheapest small drip coffee?",
     f"SELECT bronze_items.name, bronze_items.size, bronze_locations.name AS outlet, gold_price_comparisons.price "
     f"FROM {C}.gold_price_comparisons JOIN {C}.bronze_items ON gold_price_comparisons.item_id = bronze_items.id "
     f"JOIN {C}.bronze_locations ON gold_price_comparisons.location_id = bronze_locations.id "
     f"WHERE bronze_items.id = 'I08' AND NOT gold_price_comparisons.is_benchmark AND gold_price_comparisons.rank = 1",
     "Cheapest outlet for one item: filter rank = 1 and exclude the grocery benchmark. Show size, since some names have two sizes."),
    ("Which outlets are priciest for energy drinks?",
     f"SELECT bronze_locations.name AS outlet, COUNT(*) AS items, ROUND(AVG(gold_price_comparisons.pct_vs_median), 1) AS avg_pct_vs_median "
     f"FROM {C}.gold_price_comparisons JOIN {C}.bronze_items ON gold_price_comparisons.item_id = bronze_items.id "
     f"JOIN {C}.bronze_locations ON gold_price_comparisons.location_id = bronze_locations.id "
     f"WHERE bronze_items.category = 'Energy drinks' AND NOT gold_price_comparisons.is_benchmark "
     f"GROUP BY bronze_locations.name HAVING COUNT(*) >= 2 ORDER BY avg_pct_vs_median DESC LIMIT 10",
     "Compare outlets across a group of items with the average pct_vs_median, so items with different prices are comparable. Require at least 2 items."),
    ("From INS Market, what is worth walking for?",
     f"SELECT gold_walk_worth.item_name, gold_walk_worth.cheaper_name, gold_walk_worth.saving, gold_walk_worth.extra_min, gold_walk_worth.saved_term "
     f"FROM {C}.gold_walk_worth WHERE gold_walk_worth.origin_location_id = 'ins-market' AND gold_walk_worth.saving_rank = 1 "
     f"ORDER BY gold_walk_worth.saved_term DESC LIMIT 10",
     "Worth the walk: one suggestion per item and origin is saving_rank = 1. Rank by saved_term for 'over a term'."),
]

TEXT = """## PURPOSE
- Answer questions about food and drink prices at UBC campus outlets, for students and hackathon judges.

## DISAMBIGUATION
- "Campus" means rows where is_benchmark is false; Save-On-Foods (Wesbrook Village) is the off campus grocery baseline, used only when the user asks about grocery or Save-On-Foods.
- "Coffee" means items I08, I09 (drip coffee), I10 (latte) and I12 (iced coffee or cold brew); tea is not coffee.
- "The Nest" means outlets with area = 'AMS Nest'.
- When an item name has two sizes (Red Bull), answer for each size.

## DATA QUALITY NOTES
- Prices reflect the last pipeline refresh (computed_at), not live reports; pending prices are not official.
- Savings over a term, year or degree assume one purchase a week.

## Instructions you must follow when providing summaries
- Show prices in CAD with two decimals and name the outlet, not its id.
- Say "as of" the computed_at time."""


def build() -> dict:
    tables = []
    for name in sorted(TABLES):
        t = {"identifier": f"{C}.{name}"}
        if TABLES[name]:
            t["column_configs"] = sorted(TABLES[name], key=lambda c: c["column_name"])
        tables.append(t)
    joins = sorted(
        [{
            "id": sid(f"join:{l}:{r}:{lc}"),
            "left": {"identifier": f"{C}.{l}", "alias": l},
            "right": {"identifier": f"{C}.{r}", "alias": r},
            "sql": [f"`{l}`.`{lc}` = `{r}`.`{rc}`", f"--rt=FROM_RELATIONSHIP_TYPE_{rt}--"],
        } for l, r, lc, rc, rt in JOINS],
        key=lambda j: j["id"])
    examples = sorted(
        [{"id": sid(f"example:{q}"), "question": [q], "sql": [s], "usage_guidance": [g]} for q, s, g in EXAMPLES],
        key=lambda e: e["id"])
    return {
        "version": 2,
        "config": {"sample_questions": sorted(
            [{"id": sid(f"sample:{q}"), "question": [q]} for q in SAMPLE_QUESTIONS], key=lambda q: q["id"])},
        "data_sources": {"tables": tables},
        "instructions": {
            "text_instructions": [{"id": sid("text"), "content": [TEXT]}],
            "example_question_sqls": examples,
            "join_specs": joins,
        },
    }


if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
