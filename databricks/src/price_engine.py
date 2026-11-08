"""price_engine: the Campus Price Map price comparison engine (docs/SPEC.md, section 10).

A Lakeflow Declarative Pipeline in Python, run on serverless. Every published table is a materialized
view, fully recomputed on each run (a few hundred rows). Inputs are external tables in the pipeline's
default schema (`workspace.cpm`):

- `bronze_*`: Lakebase copied by `02_bronze_copy.py` (D1). Same columns as the Postgres tables in
  section 6; `bronze_current_prices` is the live `current_prices` view.
- `statcan_18100245`: BC and Canada grocery retail prices, loaded by `01_statcan.py` (D6).
- `model_price_estimates`: written by `03_price_model.py` (D5). Treated as empty until it exists.
- `data/statcan_map.csv`: synced with the bundle. The pipeline setting `cpm.statcan_map_path` points at it.

Published tables:

    silver_prices            cleaned reports (expectations drop the bad ones)
    silver_votes             votes by students other than the reporter, newest per voter
    silver_outlet_distances  every outlet pair with walk minutes
    gold_price_status        Pending vs Official, the section 6 rules
    gold_official_prices     newest official price per item and outlet
    gold_item_stats          per item campus min / median / max, cheapest outlet, grocery baseline
    gold_walk_worth          Worth the walk economics (D8)
    gold_price_comparisons   the table the app serves (synced as serving.price_comparisons)
    gold_parity              pipeline vs live view; expect zero rows
    gold_pitch_numbers       real numbers for the Devpost

Every query is Spark SQL inside a thin Python wrapper. That keeps the rules readable next to their
Postgres twin (`db/views.sql`) and lets `databricks/tests/check_price_engine.py` run the exact same SQL on
a SQL warehouse against synthetic data, without deploying anything.
"""

import csv
import os

from pyspark import pipelines as dp

# Band rule (section 10): t = max(10% of the campus median, $0.20).
BAND_PCT = "0.10"
BAND_MIN = "0.20"
TEAM_SOURCES = "('walk', 'menu', 'grocery', 'seed')"  # official by rule 1; seed = prototype prices
STUDENT_SOURCES = "('photo', 'receipt', 'typed')"
STATCAN_TABLE = "statcan_18100245"
STATCAN_KINDS = ("same_item", "ingredients")
STATCAN_MAP_SCHEMA = (
    "item_id STRING, statcan_product STRING, kind STRING, assumption STRING, "
    "item_amount STRING, statcan_amount STRING"
)


# ---------------------------------------------------------------------------------------------------
# Helpers. `spark` is the session the pipeline runtime injects into this module.
# ---------------------------------------------------------------------------------------------------


def _conf(key, default):
    try:
        value = spark.conf.get(key, default)  # noqa: F821
    except Exception:
        return default
    return default if value in (None, "") else value


def _qualified(table):
    return f"{_conf('cpm.catalog', 'workspace')}.{_conf('cpm.schema', 'cpm')}.{table}"


def _table_exists(table):
    name = _qualified(table)
    try:
        return bool(spark.catalog.tableExists(name))  # noqa: F821
    except Exception:
        pass
    try:
        spark.read.table(name).schema  # noqa: F821
        return True
    except Exception:
        return False


def _has_column(table, column):
    try:
        return column in spark.read.table(table).columns  # noqa: F821
    except Exception:
        return False


def _sql(text):
    return spark.sql(text)  # noqa: F821


def band_sql(price, median, n_outlets, is_benchmark):
    """The band rule as one SQL expression. Exact decimal arithmetic when price and median are decimals."""
    t = f"greatest({BAND_PCT} * {median}, {BAND_MIN})"
    return f"""CASE
        WHEN {price} IS NULL OR {is_benchmark} OR coalesce({n_outlets}, 0) < 3 THEN NULL
        WHEN {price} <= {median} - {t} THEN 'good'
        WHEN {price} >= {median} + {t} THEN 'high'
        ELSE 'average'
    END"""


def different_student_sql(u1, d1, u2, d2):
    """Section 6 "a different student", as db/views.sql's different_student(): a different user_id when
    both rows have one, otherwise a different device_id. Team and seed rows (no device, no user) are nobody."""
    return f"""CASE
        WHEN ({u1} IS NULL AND {d1} IS NULL) OR ({u2} IS NULL AND {d2} IS NULL) THEN false
        WHEN {u1} IS NOT NULL AND {u2} IS NOT NULL THEN {u1} <> {u2}
        ELSE NOT ({d1} <=> {d2})
    END"""


def median_cents_sql(values):
    """Campus median rounded to the cent, like db/views.sql's item_medians (percentile_cont(0.5)::numeric(6,2))."""
    return f"CAST(CAST(percentile_cont(0.5) WITHIN GROUP (ORDER BY {values}) AS DECIMAL(9, 3)) AS DECIMAL(6, 2))"


def ordinal_sql(n):
    return f"""concat({n}, CASE
        WHEN {n} % 100 IN (11, 12, 13) THEN 'th'
        WHEN {n} % 10 = 1 THEN 'st'
        WHEN {n} % 10 = 2 THEN 'nd'
        WHEN {n} % 10 = 3 THEN 'rd'
        ELSE 'th'
    END)"""


def statcan_map_path():
    """Where `data/statcan_map.csv` is: the bundle passes `cpm.statcan_map_path`; the rest are fallbacks."""
    candidates = [_conf("cpm.statcan_map_path", "")]
    cwd = os.getcwd()
    candidates += [
        os.path.join(cwd, "..", "..", "data", "statcan_map.csv"),  # cwd = databricks/src
        os.path.join(cwd, "..", "data", "statcan_map.csv"),  # cwd = databricks
    ]
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        candidates.append(os.path.join(here, "..", "..", "data", "statcan_map.csv"))
    except NameError:
        pass
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    raise FileNotFoundError(
        "data/statcan_map.csv not found. Set the pipeline setting cpm.statcan_map_path "
        f"(databricks.yml). Tried: {[c for c in candidates if c]}"
    )


def read_statcan_map(path):
    """The hand-checked item to StatCan mapping, as tuples in STATCAN_MAP_SCHEMA order."""
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    out = []
    for r in rows:
        kind = r["kind"].strip()
        if kind not in STATCAN_KINDS:  # G9: the two kinds are never mixed
            raise ValueError(f"statcan_map.csv: unknown kind {kind!r} for {r['item_id']}")
        out.append(
            (
                r["item_id"].strip(),
                r["statcan_product"].strip(),
                kind,
                r["assumption"].strip(),
                r["item_amount"].strip(),
                r["statcan_amount"].strip(),
            )
        )
    return out


# ---------------------------------------------------------------------------------------------------
# Private helpers (temporary views, not published)
# ---------------------------------------------------------------------------------------------------


@dp.temporary_view(name="app_config_values", comment="app_config as one typed row (section 6).")
def app_config_values():
    # bc_min_wage has no default: Sergio fills it from gov.bc.ca. The others default to the seeded values.
    def num(key):
        return f"try_cast(max(CASE WHEN k = '{key}' THEN v END) AS DOUBLE)"

    return _sql(
        f"""
        WITH kv AS (
          SELECT lower(trim(CAST(key AS STRING))) AS k, trim(CAST(value AS STRING)) AS v
          FROM bronze_app_config
        )
        SELECT
          try_cast(regexp_replace(max(CASE WHEN k = 'bc_min_wage' THEN v END), '[^0-9.]', '') AS DOUBLE)
                                                              AS bc_min_wage,
          coalesce({num('weeks_term')}, CAST(13 AS DOUBLE))   AS weeks_term,
          coalesce({num('weeks_year')}, CAST(26 AS DOUBLE))   AS weeks_year,
          coalesce({num('weeks_degree')}, CAST(104 AS DOUBLE)) AS weeks_degree,
          coalesce({num('even_band')}, CAST(0.10 AS DOUBLE))  AS even_band,
          coalesce(lower(max(CASE WHEN k = 'round_trip' THEN v END)) IN ('true', 't', '1', 'yes'), true)
                                                              AS round_trip,
          coalesce({num('worth_max_extra_min')}, CAST(20 AS DOUBLE)) AS worth_max_extra_min
        FROM kv
        """
    )


@dp.temporary_view(name="statcan_map", comment="data/statcan_map.csv, synced with the bundle.")
def statcan_map():
    return spark.createDataFrame(read_statcan_map(statcan_map_path()), schema=STATCAN_MAP_SCHEMA)  # noqa: F821


@dp.temporary_view(
    name="statcan_item_values",
    comment="StatCan price for one item's amount: BC at the latest month, Canada only where BC is missing.",
)
def statcan_item_values():
    return _sql(
        f"""
        WITH latest AS (
          SELECT max(ref_period) AS ref_period FROM {STATCAN_TABLE} WHERE value IS NOT NULL
        ),
        vals AS (
          SELECT s.products, s.geo, s.ref_period,
                 CAST(s.value AS DECIMAL(12, 4)) AS value,
                 coalesce(s.use_with_caution, false) AS use_with_caution
          FROM {STATCAN_TABLE} s
          JOIN latest l ON s.ref_period = l.ref_period
          WHERE s.value IS NOT NULL AND s.geo IN ('British Columbia', 'Canada')
        ),
        m AS (
          SELECT item_id, statcan_product, kind, assumption,
                 CAST(item_amount AS DECIMAL(12, 4)) AS item_amount,
                 CAST(statcan_amount AS DECIMAL(12, 4)) AS statcan_amount
          FROM statcan_map
        ),
        picked AS (
          SELECT m.item_id, m.kind, m.assumption, m.item_amount, m.statcan_amount,
                 CASE WHEN bc.value IS NOT NULL THEN 'British Columbia' ELSE 'Canada' END AS geo,
                 CASE WHEN bc.value IS NOT NULL THEN bc.value ELSE ca.value END AS value,
                 CASE WHEN bc.value IS NOT NULL THEN bc.ref_period ELSE ca.ref_period END AS ref_period,
                 CASE WHEN bc.value IS NOT NULL THEN bc.use_with_caution ELSE ca.use_with_caution END AS use_with_caution
          FROM m
          LEFT JOIN vals bc ON bc.products = m.statcan_product AND bc.geo = 'British Columbia'
          LEFT JOIN vals ca ON ca.products = m.statcan_product AND ca.geo = 'Canada'
        )
        SELECT
          item_id,
          kind AS statcan_kind,
          value * item_amount / statcan_amount AS statcan_value_exact,
          CAST(round(value * item_amount / statcan_amount, 2) AS DECIMAL(8, 2)) AS statcan_value,
          geo AS statcan_geo,
          ref_period AS statcan_ref_month,
          CASE WHEN use_with_caution THEN concat(assumption, ' · use with caution') ELSE assumption END
            AS statcan_note
        FROM picked
        WHERE value IS NOT NULL
        """
    )


@dp.temporary_view(
    name="model_estimates",
    comment="model_price_estimates from 03_price_model (D5), or empty before its first run.",
)
def model_estimates():
    if _table_exists("model_price_estimates"):
        return _sql(
            f"""
            SELECT CAST(item_id AS STRING) AS item_id, CAST(location_id AS STRING) AS location_id,
                   CAST(est_price AS DECIMAL(8, 2)) AS est_price,
                   CAST(est_low AS DECIMAL(8, 2)) AS est_low,
                   CAST(est_high AS DECIMAL(8, 2)) AS est_high
            FROM {_qualified('model_price_estimates')}
            """
        )
    return _sql(
        """
        SELECT CAST(NULL AS STRING) AS item_id, CAST(NULL AS STRING) AS location_id,
               CAST(NULL AS DECIMAL(8, 2)) AS est_price, CAST(NULL AS DECIMAL(8, 2)) AS est_low,
               CAST(NULL AS DECIMAL(8, 2)) AS est_high
        LIMIT 0
        """
    )


# ---------------------------------------------------------------------------------------------------
# Silver
# ---------------------------------------------------------------------------------------------------


@dp.materialized_view(
    name="silver_prices",
    comment=(
        "Every valid price report. Bad rows are dropped by expectations. Adds price_per_100ml, the campus "
        "median per item, over_3x_median and reporter (user_id if set, else device_id)."
    ),
)
@dp.expect_all_or_drop(
    {
        "price_between_0_25_and_25": "price IS NOT NULL AND price BETWEEN 0.25 AND 25",
        "item_id_in_items": "item_known",
        "location_id_in_locations": "location_known",
        "reported_at_not_in_future": "reported_at IS NOT NULL AND reported_at <= current_timestamp()",
    }
)
def silver_prices():
    # needs_review is the value the app stored at insert (G3). The status rules use it, exactly as the
    # live views do, so the two copies of the rules can't disagree on it. over_3x_median is the same
    # check against today's median, for Genie and the data quality story.
    return _sql(
        f"""
        WITH raw AS (
          SELECT CAST(id AS BIGINT) AS price_id,
                 CAST(item_id AS STRING) AS item_id,
                 CAST(location_id AS STRING) AS location_id,
                 CAST(price AS DECIMAL(6, 2)) AS price,
                 lower(CAST(source AS STRING)) AS source,
                 CAST(device_id AS STRING) AS device_id,
                 CAST(user_id AS STRING) AS user_id,
                 coalesce(CAST(needs_review AS BOOLEAN), false) AS needs_review,
                 CAST(reported_at AS TIMESTAMP) AS reported_at
          FROM bronze_prices
        ),
        itm AS (SELECT CAST(id AS STRING) AS item_id, try_cast(volume_ml AS INT) AS volume_ml FROM bronze_items),
        loc AS (
          SELECT CAST(id AS STRING) AS location_id, coalesce(CAST(is_benchmark AS BOOLEAN), false) AS is_benchmark
          FROM bronze_locations
        ),
        joined AS (
          SELECT r.*, i.item_id IS NOT NULL AS item_known, l.location_id IS NOT NULL AS location_known,
                 coalesce(l.is_benchmark, false) AS is_benchmark, i.volume_ml
          FROM raw r
          LEFT JOIN itm i ON i.item_id = r.item_id
          LEFT JOIN loc l ON l.location_id = r.location_id
        ),
        newest AS (  -- newest valid report per item and campus outlet, whatever its status
          SELECT item_id, price,
                 row_number() OVER (PARTITION BY item_id, location_id ORDER BY reported_at DESC, price_id DESC) AS rn
          FROM joined
          WHERE item_known AND location_known AND NOT is_benchmark
            AND price BETWEEN 0.25 AND 25 AND reported_at <= current_timestamp()
        ),
        medians AS (
          SELECT item_id, {median_cents_sql('price')} AS campus_median
          FROM newest WHERE rn = 1 GROUP BY item_id
        )
        SELECT
          j.price_id, j.item_id, j.location_id, j.price, j.source,
          j.device_id, j.user_id, coalesce(j.user_id, j.device_id) AS reporter,
          j.needs_review, j.reported_at, j.is_benchmark,
          CAST(round(try_divide(j.price * 100, j.volume_ml), 3) AS DECIMAL(8, 3)) AS price_per_100ml,
          m.campus_median,
          coalesce(j.price > 3 * m.campus_median, false) AS over_3x_median,
          j.item_known, j.location_known
        FROM joined j
        LEFT JOIN medians m ON m.item_id = j.item_id
        """
    )


@dp.materialized_view(
    name="silver_votes",
    comment="Votes joined to their price row. Votes by the reporter are dropped; newest vote per voter and price.",
)
@dp.expect_or_drop("vote_not_by_reporter", "by_different_student")
def silver_votes():
    # A vote counts only from a different student than the reporter (section 6, db/views.sql's
    # different_student()). Team and seed rows have no reporter ("count as nobody"), so votes on them never
    # count either; they are official by rule 1 anyway. Newest vote per voter (user_id, else device_id).
    different = different_student_sql("v.user_id", "v.device_id", "p.user_id", "p.device_id")
    return _sql(
        f"""
        WITH v AS (
          SELECT CAST(id AS BIGINT) AS vote_id, CAST(price_id AS BIGINT) AS price_id,
                 CAST(device_id AS STRING) AS device_id, CAST(user_id AS STRING) AS user_id,
                 lower(CAST(vote AS STRING)) AS vote, CAST(created_at AS TIMESTAMP) AS created_at
          FROM bronze_price_votes
        ),
        j AS (
          SELECT v.*, coalesce(v.user_id, v.device_id) AS voter, p.item_id, p.location_id,
                 coalesce({different}, false) AS by_different_student
          FROM v
          JOIN silver_prices p ON p.price_id = v.price_id
        )
        SELECT vote_id, price_id, item_id, location_id, voter, device_id, user_id, vote, created_at,
               by_different_student
        FROM (
          SELECT j.*, row_number() OVER (PARTITION BY price_id, voter ORDER BY created_at DESC, vote_id DESC) AS rn
          FROM j
        )
        WHERE rn = 1
        """
    )


@dp.materialized_view(
    name="silver_outlet_distances",
    comment=(
        "Every outlet pair with walk minutes: bronze_walk_matrix (UBC paths or OpenRouteService) when present, "
        "else the app's formula (haversine x 1.3 / 80 m per min, rounded up). Keeps the source."
    ),
)
def silver_outlet_distances():
    # walk_matrix holds a normal and a step-free time per pair (db/schema.sql); Worth the walk uses the normal one.
    step_free_filter = (
        "WHERE NOT coalesce(CAST(step_free AS BOOLEAN), false)" if _has_column("bronze_walk_matrix", "step_free") else ""
    )
    return _sql(
        f"""
        WITH loc AS (
          SELECT CAST(id AS STRING) AS location_id, CAST(lat AS DOUBLE) AS lat, CAST(lng AS DOUBLE) AS lng
          FROM bronze_locations
          WHERE lat IS NOT NULL AND lng IS NOT NULL
        ),
        pairs AS (
          SELECT a.location_id AS from_id, b.location_id AS to_id,
                 2 * 6371000 * asin(sqrt(
                   pow(sin(radians(b.lat - a.lat) / 2), 2)
                   + cos(radians(a.lat)) * cos(radians(b.lat)) * pow(sin(radians(b.lng - a.lng) / 2), 2)
                 )) AS straight_m
          FROM loc a CROSS JOIN loc b
          WHERE a.location_id <> b.location_id
        ),
        wm AS (
          SELECT CAST(from_id AS STRING) AS from_id, CAST(to_id AS STRING) AS to_id,
                 CAST(meters AS INT) AS meters, CAST(minutes AS DOUBLE) AS minutes, CAST(source AS STRING) AS source
          FROM bronze_walk_matrix
          {step_free_filter}
        )
        SELECT
          p.from_id, p.to_id,
          CAST(coalesce(w.minutes, ceil(p.straight_m * 1.3 / 80)) AS DOUBLE) AS walk_min,
          coalesce(w.meters, CAST(round(p.straight_m) AS INT)) AS meters,
          CAST(round(p.straight_m) AS INT) AS straight_m,
          CASE WHEN w.minutes IS NOT NULL THEN coalesce(w.source, 'ors') ELSE 'haversine' END AS source
        FROM pairs p
        LEFT JOIN wm w ON w.from_id = p.from_id AND w.to_id = p.to_id
        """
    )


# ---------------------------------------------------------------------------------------------------
# Gold: status and official prices
# ---------------------------------------------------------------------------------------------------


@dp.materialized_view(
    name="gold_price_status",
    comment="Pending vs Official (section 6), one row per price with its status and confirmations.",
)
def gold_price_status():
    # Mirrors db/views.sql's price_status; gold_parity checks the two agree.
    # 1. official if the source is team data (walk, menu, grocery) or prototype data (seed)
    # 2. rejected if no >= 1 and no > yes
    # 3. official if (yes > no and yes >= 1) or a matching report exists, with at least 1 confirmation
    #    (2 when needs_review). Matching report: a different student reported the same item and outlet within
    #    $0.10 and 48 h, and that report wasn't voted down (rule 2). Only student reports match or get matched.
    # 4. otherwise pending; unsure never counts
    # updated_at = the latest of the report, its last counted yes vote and its last matching report.
    different = different_student_sql("q.user_id", "q.device_id", "p.user_id", "p.device_id")
    return _sql(
        f"""
        WITH votes AS (
          SELECT price_id,
                 count_if(vote = 'yes') AS yes_votes,
                 count_if(vote = 'no') AS no_votes,
                 count_if(vote = 'unsure') AS unsure_votes,
                 max(CASE WHEN vote = 'yes' THEN created_at END) AS last_yes_at
          FROM silver_votes
          GROUP BY price_id
        ),
        matches AS (
          SELECT p.price_id,
                 count(DISTINCT q.reporter) AS matching_reports,
                 max(q.reported_at) AS last_match_at
          FROM silver_prices p
          JOIN silver_prices q
            ON q.item_id = p.item_id AND q.location_id = p.location_id AND q.price_id <> p.price_id
           AND q.source IN {STUDENT_SOURCES}
           AND abs(q.price - p.price) <= 0.10
           AND q.reported_at BETWEEN p.reported_at - INTERVAL 48 HOURS AND p.reported_at + INTERVAL 48 HOURS
           AND {different}
          LEFT JOIN votes qv ON qv.price_id = q.price_id
          WHERE p.source IN {STUDENT_SOURCES}
            AND NOT (coalesce(qv.no_votes, 0) >= 1 AND coalesce(qv.no_votes, 0) > coalesce(qv.yes_votes, 0))
          GROUP BY p.price_id
        ),
        counted AS (
          SELECT p.price_id, p.item_id, p.location_id, p.price, p.source, p.device_id, p.user_id, p.reporter,
                 p.needs_review, p.reported_at, p.is_benchmark,
                 coalesce(v.yes_votes, 0) AS yes_votes,
                 coalesce(v.no_votes, 0) AS no_votes,
                 coalesce(v.unsure_votes, 0) AS unsure_votes,
                 coalesce(m.matching_reports, 0) AS matching_reports,
                 greatest(p.reported_at, v.last_yes_at, m.last_match_at) AS updated_at
          FROM silver_prices p
          LEFT JOIN votes v ON v.price_id = p.price_id
          LEFT JOIN matches m ON m.price_id = p.price_id
        )
        SELECT
          c.*,
          c.yes_votes + c.matching_reports AS confirmations,
          CASE
            WHEN c.source IN {TEAM_SOURCES} THEN 'official'
            WHEN c.no_votes >= 1 AND c.no_votes > c.yes_votes THEN 'rejected'
            WHEN ((c.yes_votes > c.no_votes AND c.yes_votes >= 1) OR c.matching_reports >= 1)
                 AND c.yes_votes + c.matching_reports >= CASE WHEN c.needs_review THEN 2 ELSE 1 END
              THEN 'official'
            ELSE 'pending'
          END AS status,
          current_timestamp() AS computed_at
        FROM counted c
        """
    )


@dp.materialized_view(
    name="gold_official_prices",
    comment="Newest official price per item and outlet (the grocery baseline included, flagged is_benchmark).",
)
def gold_official_prices():
    return _sql(
        """
        SELECT item_id, location_id, price_id, price, source, confirmations, reported_at, updated_at, is_benchmark,
               current_timestamp() AS computed_at
        FROM (
          SELECT s.item_id, s.location_id, s.price_id, s.price, s.source, s.confirmations,
                 s.reported_at, s.updated_at, s.is_benchmark,
                 row_number() OVER (PARTITION BY s.item_id, s.location_id
                                    ORDER BY s.reported_at DESC, s.price_id DESC) AS rn
          FROM gold_price_status s
          WHERE s.status = 'official'
        )
        WHERE rn = 1
        """
    )


@dp.materialized_view(
    name="gold_item_stats",
    comment=(
        "Per item, over campus outlets (grocery baseline excluded): n_outlets, min, median, max, spread, "
        "cheapest and priciest outlet, and the grocery baseline price."
    ),
)
def gold_item_stats():
    # campus_median is rounded to the cent, as db/views.sql's item_medians, so live and pipeline bands agree.
    return _sql(
        f"""
        WITH itm AS (
          SELECT CAST(id AS STRING) AS item_id, CAST(name AS STRING) AS item_name, CAST(category AS STRING) AS category
          FROM bronze_items
        ),
        agg AS (
          SELECT item_id,
                 count(*) AS n_outlets,
                 min(price) AS campus_min,
                 {median_cents_sql('price')} AS campus_median,
                 max(price) AS campus_max,
                 min(named_struct('p', price, 'l', location_id)).l AS cheapest_location_id,
                 max(named_struct('p', price, 'l', location_id)).l AS priciest_location_id
          FROM gold_official_prices
          WHERE NOT is_benchmark
          GROUP BY item_id
        ),
        grocery AS (
          SELECT item_id, min(price) AS grocery_price,
                 min(named_struct('p', price, 'l', location_id)).l AS grocery_location_id
          FROM gold_official_prices
          WHERE is_benchmark
          GROUP BY item_id
        )
        SELECT
          i.item_id, i.item_name, i.category,
          coalesce(a.n_outlets, 0) AS n_outlets,
          a.campus_min,
          a.campus_median,
          a.campus_max,
          a.campus_max - a.campus_min AS spread,
          a.cheapest_location_id, a.priciest_location_id,
          g.grocery_price, g.grocery_location_id,
          current_timestamp() AS computed_at
        FROM itm i
        LEFT JOIN agg a ON a.item_id = i.item_id
        LEFT JOIN grocery g ON g.item_id = i.item_id
        """
    )


# ---------------------------------------------------------------------------------------------------
# Gold: Worth the walk (D8)
# ---------------------------------------------------------------------------------------------------


@dp.materialized_view(
    name="gold_walk_worth",
    comment=(
        "Worth the walk (section 10): every item, origin outlet and cheaper outlet within worth_max_extra_min, "
        "at bc_min_wage. net_rank 1 is the best option from that origin (highest net, not the cheapest price)."
    ),
)
def gold_walk_worth():
    # saving          = price(i, o) - price(i, c)           official prices only; c cheaper; never the grocery baseline
    # extra_min       = walk(o, c) x (2 if round_trip else 1)
    # time_cost       = extra_min / 60 x wage
    # net             = saving - time_cost, rounded to the cent; the verdict is decided on that rounded net
    # verdict         = worth_it if net > even_band; not_worth_it if net < -even_band; else about_even
    # break_even_wage = saving / (extra_min / 60);  break_even_min = saving / wage x 60
    # saved_H, minutes_H, net_H = saving, extra_min, net x H for each horizon, per weekly purchase
    def horizon(h):
        return f"""
          CAST(round(p.saving * p.weeks_{h}, 2) AS DECIMAL(10, 2)) AS saved_{h},
          round(p.extra_min * p.weeks_{h}, 1) AS minutes_{h},
          CAST(round(p.net_cents * p.weeks_{h}, 2) AS DECIMAL(10, 2)) AS net_{h}"""

    return _sql(
        f"""
        WITH cfg AS (SELECT * FROM app_config_values),
        offi AS (SELECT item_id, location_id, price, source FROM gold_official_prices WHERE NOT is_benchmark),
        pairs AS (
          SELECT a.item_id, a.location_id AS origin_location_id, b.location_id AS cheaper_location_id,
                 a.price AS origin_price, b.price AS cheaper_price, a.price - b.price AS saving,
                 a.source AS origin_source, b.source AS cheaper_source,
                 d.walk_min, d.source AS walk_source
          FROM offi a
          JOIN offi b ON b.item_id = a.item_id AND b.price < a.price
          JOIN silver_outlet_distances d ON d.from_id = a.location_id AND d.to_id = b.location_id
        ),
        calc AS (
          SELECT pr.*, c.bc_min_wage AS wage, c.round_trip, c.even_band, c.worth_max_extra_min,
                 c.weeks_term, c.weeks_year, c.weeks_degree,
                 pr.walk_min * CASE WHEN c.round_trip THEN 2 ELSE 1 END AS extra_min
          FROM pairs pr CROSS JOIN cfg c
        ),
        priced AS (
          SELECT *,
                 extra_min / 60 * wage AS time_cost_exact,
                 round(saving - extra_min / 60 * wage, 2) AS net_cents
          FROM calc
          WHERE extra_min <= worth_max_extra_min
        ),
        itm AS (SELECT CAST(id AS STRING) AS item_id, CAST(name AS STRING) AS name FROM bronze_items),
        loc AS (SELECT CAST(id AS STRING) AS location_id, CAST(name AS STRING) AS name FROM bronze_locations)
        SELECT
          p.item_id, i.name AS item_name,
          p.origin_location_id, lo.name AS origin_name,
          p.cheaper_location_id, lc.name AS cheaper_name,
          p.origin_price, p.cheaper_price, p.origin_source, p.cheaper_source,
          CAST(p.saving AS DECIMAL(8, 2)) AS saving,
          p.walk_min, p.walk_source, p.round_trip, p.extra_min, p.wage,
          CAST(round(p.time_cost_exact, 2) AS DECIMAL(8, 2)) AS time_cost,
          CAST(p.net_cents AS DECIMAL(8, 2)) AS net,
          CASE
            WHEN p.net_cents IS NULL THEN NULL
            WHEN p.net_cents > p.even_band THEN 'worth_it'
            WHEN p.net_cents < -p.even_band THEN 'not_worth_it'
            ELSE 'about_even'
          END AS verdict,
          CAST(round(try_divide(p.saving * 60, p.extra_min), 2) AS DECIMAL(8, 2)) AS break_even_wage,
          round(try_divide(p.saving * 60, p.wage), 1) AS break_even_min,
          {horizon('term')},
          {horizon('year')},
          {horizon('degree')},
          row_number() OVER (PARTITION BY p.item_id, p.origin_location_id
                             ORDER BY p.net_cents DESC NULLS LAST, p.saving DESC, p.extra_min, p.cheaper_location_id)
            AS net_rank,
          p.even_band, p.weeks_term, p.weeks_year, p.weeks_degree, p.worth_max_extra_min,
          current_timestamp() AS computed_at
        FROM priced p
        LEFT JOIN itm i ON i.item_id = p.item_id
        LEFT JOIN loc lo ON lo.location_id = p.origin_location_id
        LEFT JOIN loc lc ON lc.location_id = p.cheaper_location_id
        """
    )


# ---------------------------------------------------------------------------------------------------
# Gold: the table the app serves
# ---------------------------------------------------------------------------------------------------


@dp.materialized_view(
    name="gold_price_comparisons",
    comment=(
        "One row per item and outlet with an official price, plus estimated rows from model_price_estimates. "
        "Synced to Lakebase as serving.price_comparisons. Ranks, medians, chips and nearest cheaper use "
        "official prices only."
    ),
)
def gold_price_comparisons():
    band = band_sql("b.price", "b.campus_median", "b.n_outlets", "NOT b.compared")
    chip = f"""CASE
        WHEN NOT b.compared OR coalesce(b.n_outlets, 0) < 2 THEN NULL
        WHEN b.price_rank = 1 THEN 'Cheapest on campus'
        WHEN abs(b.gap) >= 0.25 THEN concat('$', format_number(abs(b.gap), 2),
                                            CASE WHEN b.gap > 0 THEN ' above' ELSE ' below' END,
                                            ' campus average')
        ELSE concat({ordinal_sql('b.price_rank')}, ' cheapest of ', b.n_outlets)
    END"""
    return _sql(
        f"""
        WITH cfg AS (SELECT * FROM app_config_values),
        loc AS (
          SELECT CAST(id AS STRING) AS location_id, coalesce(CAST(is_benchmark AS BOOLEAN), false) AS is_benchmark
          FROM bronze_locations
        ),
        itm AS (SELECT CAST(id AS STRING) AS item_id, try_cast(volume_ml AS INT) AS volume_ml FROM bronze_items),
        official AS (
          SELECT item_id, location_id, price, source, confirmations, updated_at FROM gold_official_prices
        ),
        campus AS (SELECT item_id, location_id, price FROM gold_official_prices WHERE NOT is_benchmark),
        ranked AS (
          SELECT item_id, location_id, rank() OVER (PARTITION BY item_id ORDER BY price) AS price_rank FROM campus
        ),
        nearest AS (
          SELECT item_id, location_id, nearest_cheaper_location_id, nearest_cheaper_price, nearest_cheaper_walk_min
          FROM (
            SELECT a.item_id, a.location_id,
                   b.location_id AS nearest_cheaper_location_id, b.price AS nearest_cheaper_price,
                   d.walk_min AS nearest_cheaper_walk_min,
                   row_number() OVER (PARTITION BY a.item_id, a.location_id
                                      ORDER BY d.walk_min, b.price, b.location_id) AS rn
            FROM campus a
            JOIN campus b ON b.item_id = a.item_id AND b.price < a.price
            JOIN silver_outlet_distances d ON d.from_id = a.location_id AND d.to_id = b.location_id
          )
          WHERE rn = 1
        ),
        best_walk AS (SELECT * FROM gold_walk_worth WHERE net_rank = 1),
        estimates AS (
          SELECT e.item_id, e.location_id, e.est_price, e.est_low, e.est_high
          FROM model_estimates e
          LEFT ANTI JOIN official o ON o.item_id = e.item_id AND o.location_id = e.location_id
        ),
        all_rows AS (
          SELECT item_id, location_id, price, source, confirmations, updated_at,
                 CAST(NULL AS DECIMAL(8, 2)) AS est_price, CAST(NULL AS DECIMAL(8, 2)) AS est_low,
                 CAST(NULL AS DECIMAL(8, 2)) AS est_high
          FROM official
          UNION ALL
          SELECT item_id, location_id, CAST(NULL AS DECIMAL(6, 2)), CAST(NULL AS STRING), CAST(NULL AS BIGINT),
                 CAST(NULL AS TIMESTAMP), est_price, est_low, est_high
          FROM estimates
        ),
        b AS (
          SELECT r.*,
                 coalesce(l.is_benchmark, false) AS is_benchmark,
                 r.price IS NOT NULL AND NOT coalesce(l.is_benchmark, false) AS compared,
                 s.n_outlets, s.campus_min, s.campus_median, s.campus_max, s.cheapest_location_id, s.grocery_price,
                 i.volume_ml, k.price_rank,
                 round(r.price - s.campus_median, 2) AS gap
          FROM all_rows r
          LEFT JOIN loc l ON l.location_id = r.location_id
          LEFT JOIN gold_item_stats s ON s.item_id = r.item_id
          LEFT JOIN itm i ON i.item_id = r.item_id
          LEFT JOIN ranked k ON k.item_id = r.item_id AND k.location_id = r.location_id
        )
        SELECT
          b.item_id, b.location_id,
          b.is_benchmark,
          b.price, b.source, b.confirmations, b.updated_at,
          coalesce(b.n_outlets, 0) AS n_outlets,
          CASE WHEN b.compared THEN b.price_rank END AS `rank`,
          b.campus_min, b.campus_median, b.campus_max,
          CAST(CASE WHEN b.compared THEN b.gap END AS DECIMAL(8, 2)) AS gap_vs_median,
          CASE WHEN b.compared THEN round(try_divide((b.price - b.campus_median) * 100, b.campus_median), 1) END
            AS pct_vs_median,
          b.cheapest_location_id,
          CASE WHEN b.compared THEN b.price - b.campus_min END AS savings_vs_cheapest,
          CASE WHEN b.compared THEN n.nearest_cheaper_location_id END AS nearest_cheaper_location_id,
          CASE WHEN b.compared THEN n.nearest_cheaper_price END AS nearest_cheaper_price,
          CASE WHEN b.compared THEN n.nearest_cheaper_walk_min END AS nearest_cheaper_walk_min,
          b.grocery_price,
          CASE WHEN b.compared THEN b.price - b.grocery_price END AS premium_vs_grocery,
          CAST(round(try_divide(b.price * 100, b.volume_ml), 3) AS DECIMAL(8, 3)) AS price_per_100ml,
          {band} AS band,
          sc.statcan_kind,
          sc.statcan_value,
          sc.statcan_geo,
          sc.statcan_ref_month,
          CASE WHEN sc.statcan_kind = 'same_item' AND b.price IS NOT NULL
               THEN round(CAST(try_divide(b.price, sc.statcan_value_exact) AS DOUBLE), 2) END AS statcan_ratio,
          sc.statcan_note,
          w.cheaper_location_id AS walk_best_location_id,
          w.saving AS walk_saving,
          w.extra_min AS walk_extra_min,
          w.time_cost AS walk_time_cost,
          w.net AS walk_net,
          w.verdict AS walk_verdict,
          w.break_even_wage AS walk_break_even_wage,
          CAST(round(w.net * cfg.weeks_term, 2) AS DECIMAL(10, 2)) AS walk_net_term_per_weekly,
          round(try_divide(b.price, cfg.bc_min_wage) * 60, 1) AS minutes_of_work,
          {chip} AS chip,
          b.est_price, b.est_low, b.est_high,
          current_timestamp() AS computed_at
        FROM b
        CROSS JOIN cfg
        LEFT JOIN nearest n ON n.item_id = b.item_id AND n.location_id = b.location_id
        LEFT JOIN best_walk w ON w.item_id = b.item_id AND w.origin_location_id = b.location_id
        LEFT JOIN statcan_item_values sc ON sc.item_id = b.item_id
        """
    )


# ---------------------------------------------------------------------------------------------------
# Gold: parity with the live views, and the pitch numbers
# ---------------------------------------------------------------------------------------------------


@dp.materialized_view(
    name="gold_parity",
    comment=(
        "gold_official_prices vs bronze_current_prices (the live view), prices and bands. One row per mismatch; "
        "expect zero. Item and outlet pairs with a report or vote newer than the bronze copy are skipped."
    ),
)
@dp.expect("no_parity_mismatch", "mismatch IS NULL")
def gold_parity():
    # 02_bronze_copy may stamp each bronze table with copied_at. Without it nothing is skipped.
    copied_at = (
        "(SELECT min(CAST(copied_at AS TIMESTAMP)) FROM bronze_prices)"
        if _has_column("bronze_prices", "copied_at")
        else "CAST(NULL AS TIMESTAMP)"
    )
    live_band = band_sql("lv.price", "ls.campus_median", "ls.n_outlets", "coalesce(l.is_benchmark, false)")
    return _sql(
        f"""
        WITH copy_start AS (SELECT {copied_at} AS copied_at),
        touched AS (
          SELECT p.item_id, p.location_id FROM silver_prices p CROSS JOIN copy_start c
          WHERE p.reported_at >= c.copied_at
          UNION
          SELECT v.item_id, v.location_id FROM silver_votes v CROSS JOIN copy_start c
          WHERE v.created_at >= c.copied_at
        ),
        loc AS (
          SELECT CAST(id AS STRING) AS location_id, coalesce(CAST(is_benchmark AS BOOLEAN), false) AS is_benchmark
          FROM bronze_locations
        ),
        live AS (
          SELECT CAST(item_id AS STRING) AS item_id, CAST(location_id AS STRING) AS location_id,
                 CAST(price AS DECIMAL(6, 2)) AS price
          FROM bronze_current_prices
        ),
        live_stats AS (
          SELECT lv.item_id, count(*) AS n_outlets,
                 {median_cents_sql('lv.price')} AS campus_median
          FROM live lv JOIN loc l ON l.location_id = lv.location_id
          WHERE NOT l.is_benchmark
          GROUP BY lv.item_id
        ),
        live_banded AS (
          SELECT lv.item_id, lv.location_id, lv.price, {live_band} AS band
          FROM live lv
          LEFT JOIN loc l ON l.location_id = lv.location_id
          LEFT JOIN live_stats ls ON ls.item_id = lv.item_id
        ),
        pipeline AS (
          SELECT o.item_id, o.location_id, o.price, c.band
          FROM gold_official_prices o
          LEFT JOIN gold_price_comparisons c ON c.item_id = o.item_id AND c.location_id = o.location_id
        ),
        joined AS (
          SELECT coalesce(lb.item_id, p.item_id) AS item_id, coalesce(lb.location_id, p.location_id) AS location_id,
                 lb.price AS live_price, p.price AS pipeline_price, lb.band AS live_band, p.band AS pipeline_band
          FROM live_banded lb
          FULL OUTER JOIN pipeline p ON p.item_id = lb.item_id AND p.location_id = lb.location_id
        ),
        classified AS (
          SELECT j.*,
                 CASE
                   WHEN j.live_price IS NULL THEN 'missing_in_live'
                   WHEN j.pipeline_price IS NULL THEN 'missing_in_pipeline'
                   WHEN j.live_price <> j.pipeline_price THEN 'price_differs'
                   WHEN NOT (j.live_band <=> j.pipeline_band) THEN 'band_differs'
                 END AS mismatch
          FROM joined j
        )
        SELECT c.item_id, c.location_id, c.mismatch, c.live_price, c.pipeline_price, c.live_band, c.pipeline_band,
               (SELECT copied_at FROM copy_start) AS bronze_copied_at,
               current_timestamp() AS checked_at
        FROM classified c
        LEFT ANTI JOIN touched t ON t.item_id = c.item_id AND t.location_id = c.location_id
        WHERE c.mismatch IS NOT NULL
        """
    )


@dp.materialized_view(
    name="gold_pitch_numbers",
    comment=(
        "Real numbers for the Devpost, one row per metric. Prices from real sources only (menu, walk, grocery and "
        "student reports): seed prototype prices are never quoted as findings (section 6). Never synced."
    ),
)
def gold_pitch_numbers():
    return _sql(
        f"""
        WITH cfg AS (SELECT * FROM app_config_values),
        loc AS (SELECT CAST(id AS STRING) AS location_id, CAST(name AS STRING) AS name FROM bronze_locations),
        itm AS (SELECT CAST(id AS STRING) AS item_id, CAST(name AS STRING) AS name FROM bronze_items),
        real_campus AS (
          SELECT item_id, location_id, price FROM gold_official_prices WHERE NOT is_benchmark AND source <> 'seed'
        ),
        gap AS (
          SELECT g.item_id, i.name AS item_name, g.spread, g.campus_min, g.campus_max,
                 lc.name AS cheapest_name, lp.name AS priciest_name
          FROM (
            SELECT item_id, count(*) AS n, min(price) AS campus_min, max(price) AS campus_max,
                   max(price) - min(price) AS spread,
                   min(named_struct('p', price, 'l', location_id)).l AS cheapest_location_id,
                   max(named_struct('p', price, 'l', location_id)).l AS priciest_location_id
            FROM real_campus GROUP BY item_id
          ) g
          LEFT JOIN itm i ON i.item_id = g.item_id
          LEFT JOIN loc lc ON lc.location_id = g.cheapest_location_id
          LEFT JOIN loc lp ON lp.location_id = g.priciest_location_id
          WHERE g.n >= 2
          ORDER BY g.spread DESC, g.item_id
          LIMIT 1
        ),
        real_walks AS (
          SELECT * FROM gold_walk_worth
          WHERE verdict IS NOT NULL AND origin_source <> 'seed' AND cheaper_source <> 'seed'
        ),
        options AS (SELECT count(*) AS n, count_if(verdict = 'worth_it') AS n_worth FROM real_walks),
        worth AS (
          SELECT count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY net_term * 4) AS median_net
          FROM real_walks WHERE verdict = 'worth_it'
        ),
        reports AS (
          SELECT count(*) AS n,
                 count_if(source IN {STUDENT_SOURCES}) AS n_student,
                 count_if(source = 'seed') AS n_seed
          FROM silver_prices
        ),
        confirms AS (
          SELECT coalesce(sum(confirmations), 0) AS n,
                 count_if(status = 'official' AND source IN {STUDENT_SOURCES}) AS n_confirmed
          FROM gold_price_status
          WHERE source IN {STUDENT_SOURCES}
        ),
        votes AS (SELECT count(*) AS n FROM silver_votes)
        SELECT 'biggest_same_item_gap' AS metric, CAST(spread AS DOUBLE) AS value, 'CAD' AS unit,
               concat(item_name, ': $', format_number(campus_min, 2), ' at ', cheapest_name,
                      ' vs $', format_number(campus_max, 2), ' at ', priciest_name) AS detail
        FROM gap
        UNION ALL
        SELECT 'share_worth_the_walk_at_min_wage', round(try_divide(n_worth * 100.0, n), 1), 'percent',
               concat(n_worth, ' of ', n, ' cheaper options are worth the walk at $',
                      format_number(cfg.bc_min_wage, 2), '/h')
        FROM options CROSS JOIN cfg
        UNION ALL
        SELECT 'median_net_per_term_4_a_week', round(median_net, 2), 'CAD',
               concat('median over ', n, ' worthwhile switches, 4 purchases a week for a ',
                      CAST(cfg.weeks_term AS INT), '-week term, if prices hold')
        FROM worth CROSS JOIN cfg
        UNION ALL
        SELECT 'price_reports', CAST(n - n_seed AS DOUBLE), 'count',
               concat(n_student, ' from students, ', n - n_seed - n_student, ' from the team; plus ', n_seed,
                      ' prototype (seed) prices, not counted')
        FROM reports
        UNION ALL
        SELECT 'confirmations', CAST(confirms.n AS DOUBLE), 'count',
               concat('yes votes plus matching reports on student reports; ', confirms.n_confirmed,
                      ' student prices became official; ', votes.n, ' votes counted')
        FROM confirms CROSS JOIN votes
        UNION ALL
        SELECT 'bc_min_wage', bc_min_wage, 'CAD per hour', 'from app_config (gov.bc.ca)'
        FROM cfg
        """
    )
