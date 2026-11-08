"""Check price_engine.py's SQL on a SQL warehouse against synthetic data, without deploying anything.

    python3 databricks/tests/check_price_engine.py --profile campus-price-map

How it works: price_engine.py is imported with stand-ins for `pyspark.pipelines` and `spark` that record
each dataset's SQL and expectations instead of running them. The script then chains every dataset as a
CTE (expect_or_drop becomes a WHERE), puts synthetic `bronze_*` rows in front as VALUES, reads the real
`workspace.cpm.statcan_18100245`, and runs one SELECT per table. Read only: nothing is created, changed or
deleted in the workspace or in Lakebase.

The synthetic data covers the section 6 rules (team rows, matching reports, a 1 yes / 1 no tie, a rejected
report, needs_review needing 2 confirmations, a vote by the reporter, one student voting from two devices),
the expectations, the band and chip rules, Worth the walk (including net exactly at even_band), the StatCan
columns and a deliberate parity mismatch. bc_min_wage is a test value here, not BC's real minimum wage.
"""

import argparse
import datetime
import importlib.util
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "databricks", "scripts"))
from dbsql import run_sql  # noqa: E402

ENGINE = os.path.join(ROOT, "databricks", "src", "price_engine.py")
STATCAN_MAP = os.path.join(ROOT, "data", "statcan_map.csv")


# --------------------------------------------------------------------------------------------------
# Stand-ins for pyspark.pipelines and spark
# --------------------------------------------------------------------------------------------------


class Frame:
    def __init__(self, sql):
        self.sql = sql


class LocalFrame:
    def __init__(self, rows, schema):
        self.rows = rows
        self.columns = [tuple(part.strip().split(None, 1)) for part in schema.split(",")]


class Recorder:
    def __init__(self):
        self.datasets = []

    def _dataset(self, kind):
        def factory(name=None, comment=None, **_):
            def deco(fn):
                self.datasets.append(
                    {"name": name or fn.__name__, "kind": kind, "fn": fn,
                     "expectations": list(getattr(fn, "_expectations", []))}
                )
                return fn
            return deco
        return factory

    def _expect(self, items):
        def deco(fn):
            fn._expectations = list(getattr(fn, "_expectations", [])) + items
            return fn
        return deco

    def module(self):
        mod = types.ModuleType("pyspark.pipelines")
        mod.materialized_view = self._dataset("materialized_view")
        mod.temporary_view = self._dataset("temporary_view")
        mod.table = self._dataset("table")
        mod.expect = lambda n, c: self._expect([(n, c, "warn")])
        mod.expect_or_drop = lambda n, c: self._expect([(n, c, "drop")])
        mod.expect_or_fail = lambda n, c: self._expect([(n, c, "fail")])
        mod.expect_all = lambda d: self._expect([(n, c, "warn") for n, c in d.items()])
        mod.expect_all_or_drop = lambda d: self._expect([(n, c, "drop") for n, c in d.items()])
        mod.expect_all_or_fail = lambda d: self._expect([(n, c, "fail") for n, c in d.items()])
        return mod


class StubSpark:
    def __init__(self, conf, tables):
        self._conf = conf
        self._tables = tables
        self.conf = types.SimpleNamespace(get=lambda key, default=None: self._conf.get(key, default))
        self.catalog = types.SimpleNamespace(tableExists=lambda name: False)
        self.read = types.SimpleNamespace(table=self._table)

    def _table(self, name):
        if name not in self._tables:
            raise KeyError(name)
        return types.SimpleNamespace(columns=[c for c, _ in self._tables[name]["columns"]])

    def sql(self, text):
        return Frame(text)

    def createDataFrame(self, rows, schema):
        return LocalFrame(rows, schema)


# --------------------------------------------------------------------------------------------------
# Synthetic bronze data
# --------------------------------------------------------------------------------------------------

NOW = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)


def ago(hours=0, minutes=0):
    return (NOW - datetime.timedelta(hours=hours, minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")


def dev(ch):
    return f"{ch * 8}-{ch * 4}-{ch * 4}-{ch * 4}-{ch * 12}"


COPIED_AT = ago(minutes=10)

ITEMS = [  # id, name, size, volume_ml, category
    ("I01", "Red Bull", "250 ml can", 250, "Energy drinks"),
    ("I04", "Coca-Cola", "355 ml can", 355, "Soft drinks"),
    ("I08", "Drip coffee", "small", None, "Hot drinks"),
    ("I11", "Tea", "medium", None, "Hot drinks"),
    ("I20", "Banana", "one", None, "Fruit"),
]
LOCATIONS = [  # id, name, lat, lng, is_benchmark
    ("L01", "AMS Nest", 49.2666, -123.2499, False),
    ("L02", "Outlet two", 49.2662, -123.2493, False),
    ("L03", "Outlet three", 49.2640, -123.2470, False),
    ("L04", "Outlet four", 49.2668, -123.2502, False),
    ("L20", "Save-On-Foods Wesbrook", 49.2555, -123.2355, True),
]
# id, item, location, price, source, device, user, needs_review, reported_at
PRICES = [
    (1, "I01", "L01", 3.50, "walk", None, None, False, ago(30)),
    (2, "I01", "L02", 2.75, "walk", None, None, False, ago(30)),
    (3, "I01", "L03", 3.10, "menu", None, None, False, ago(30)),
    (4, "I01", "L04", 2.99, "walk", None, None, False, ago(30)),
    (5, "I01", "L20", 2.20, "grocery", None, None, False, ago(30)),
    (6, "I01", "L03", 2.95, "photo", dev("a"), None, False, ago(5)),   # matches 7 → official
    (7, "I01", "L03", 3.00, "photo", dev("b"), None, False, ago(4)),   # matches 6 → official, newest at L03
    (8, "I01", "L02", 2.50, "photo", dev("c"), None, False, ago(3)),   # 1 yes / 1 no → pending
    (9, "I01", "L04", 2.80, "typed", dev("f"), None, False, ago(2)),   # U3: no then yes → official
    (10, "I01", "L01", 2.00, "photo", dev("1"), None, True, ago(1)),   # needs_review, 1 yes → pending
    (11, "I01", "L01", 30.00, "typed", dev("2"), None, False, ago(1)),  # dropped: price
    (12, "I99", "L01", 2.00, "typed", dev("2"), None, False, ago(1)),   # dropped: unknown item
    (13, "I01", "L01", 3.40, "typed", dev("2"), None, False, (NOW + datetime.timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")),  # dropped: future
    (14, "I08", "L04", 2.30, "photo", dev("3"), "U2", False, ago(1)),   # only vote is by U2 itself → pending
    (15, "I08", "L01", 2.25, "walk", None, None, False, ago(30)),
    (16, "I08", "L02", 2.50, "walk", None, None, False, ago(30)),
    (17, "I08", "L03", 1.95, "menu", None, None, False, ago(30)),
    (18, "I20", "L01", 1.25, "walk", None, None, False, ago(30)),
    (19, "I20", "L02", 0.99, "menu", None, None, False, ago(30)),
    (20, "I20", "L20", 0.35, "grocery", None, None, False, ago(30)),
    (21, "I11", "L01", 2.10, "walk", None, None, False, ago(30)),
    (22, "I01", "L02", 2.65, "typed", dev("4"), None, False, ago(1, 30)),  # 1 no → rejected
    (23, "I08", "L01", 2.20, "photo", dev("5"), None, False, ago(minutes=5)),  # after the copy started
    (24, "I04", "L01", 2.95, "walk", None, None, False, ago(30)),
    (25, "I04", "L04", 1.98, "seed", None, None, False, ago(30)),  # prototype price: official, counted in the pitch (labelled)
    (26, "I08", "L02", 2.55, "photo", dev("r"), None, False, ago(6)),  # voted down → rejected
    (27, "I08", "L02", 2.50, "photo", dev("s"), None, False, ago(5)),  # matches only 26, which was voted down → pending
]
# id, price_id, device, user, vote, created_at
VOTES = [
    (1, 8, dev("d"), None, "yes", ago(2, 30)),
    (2, 8, dev("e"), None, "no", ago(2, 20)),
    (3, 9, dev("g"), "U3", "no", ago(1, 30)),
    (4, 9, dev("6"), "U3", "yes", ago(1)),       # same student, newer vote wins
    (5, 10, dev("7"), None, "yes", ago(0, 50)),
    (6, 14, dev("8"), "U2", "yes", ago(0, 40)),   # the reporter (same user id), dropped
    (7, 6, dev("a"), None, "yes", ago(4, 30)),    # the reporter (same device), dropped
    (8, 22, dev("9"), None, "no", ago(1)),
    (9, 8, dev("0"), None, "unsure", ago(2)),     # unsure never counts
    (10, 1, dev("b"), None, "yes", ago(20)),      # on a team row: nobody reported it, so it doesn't count
    (11, 25, dev("c"), None, "no", ago(10)),      # on a seed row: doesn't count, stays official
    (12, 26, dev("t"), None, "no", ago(5, 30)),
]
CONFIG = [("bc_min_wage", "18.00"), ("weeks_term", "13"), ("weeks_year", "26"), ("weeks_degree", "104"),
          ("even_band", "0.10"), ("round_trip", "true"), ("worth_max_extra_min", "20")]
WALK_MATRIX = [("L01", "L02", 280, 3.5, "ors", False), ("L01", "L02", 300, 9.0, "ubc_paths", True)]
# What the live current_prices view would say. (I01, L03) is deliberately wrong: expect one parity row.
# (I08, L01) also differs, but a report newer than the copy touched it, so parity skips it.
CURRENT = [
    ("I01", "L01", 3.50), ("I01", "L02", 2.75), ("I01", "L03", 3.10), ("I01", "L04", 2.80), ("I01", "L20", 2.20),
    ("I08", "L01", 2.20), ("I08", "L02", 2.50), ("I08", "L03", 1.95),
    ("I20", "L01", 1.25), ("I20", "L02", 0.99), ("I20", "L20", 0.35),
    ("I11", "L01", 2.10), ("I04", "L01", 2.95), ("I04", "L04", 1.98),
]

BRONZE = {
    "bronze_items": {
        "columns": [("id", "STRING"), ("name", "STRING"), ("size", "STRING"), ("volume_ml", "INT"),
                    ("category", "STRING")],
        "rows": ITEMS,
    },
    "bronze_locations": {
        "columns": [("id", "STRING"), ("name", "STRING"), ("lat", "DOUBLE"), ("lng", "DOUBLE"),
                    ("is_benchmark", "BOOLEAN")],
        "rows": LOCATIONS,
    },
    "bronze_prices": {
        "columns": [("id", "BIGINT"), ("item_id", "STRING"), ("location_id", "STRING"), ("price", "DECIMAL(6,2)"),
                    ("source", "STRING"), ("device_id", "STRING"), ("user_id", "STRING"),
                    ("needs_review", "BOOLEAN"), ("reported_at", "TIMESTAMP"), ("copied_at", "TIMESTAMP")],
        "rows": [r + (COPIED_AT,) for r in PRICES],
    },
    "bronze_price_votes": {
        "columns": [("id", "BIGINT"), ("price_id", "BIGINT"), ("device_id", "STRING"), ("user_id", "STRING"),
                    ("vote", "STRING"), ("created_at", "TIMESTAMP")],
        "rows": VOTES,
    },
    "bronze_app_config": {"columns": [("key", "STRING"), ("value", "STRING")], "rows": CONFIG},
    "bronze_walk_matrix": {
        "columns": [("from_id", "STRING"), ("to_id", "STRING"), ("meters", "INT"), ("minutes", "DECIMAL(5,1)"),
                    ("source", "STRING"), ("step_free", "BOOLEAN")],
        "rows": WALK_MATRIX,
    },
    "bronze_current_prices": {
        "columns": [("item_id", "STRING"), ("location_id", "STRING"), ("price", "DECIMAL(6,2)")],
        "rows": CURRENT,
    },
}


# --------------------------------------------------------------------------------------------------
# SQL assembly
# --------------------------------------------------------------------------------------------------


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("\\", "\\\\").replace("'", "\\'") + "'"


def values_sql(columns, rows):
    select = ", ".join(f"CAST(`{c}` AS {t}) AS `{c}`" for c, t in columns)
    names = ", ".join(f"`{c}`" for c, _ in columns)
    if not rows:
        nulls = ", ".join(f"CAST(NULL AS {t}) AS `{c}`" for c, t in columns)
        return f"SELECT {nulls} LIMIT 0"
    vals = ",\n    ".join("(" + ", ".join(lit(v) for v in r) + ")" for r in rows)
    return f"SELECT {select} FROM VALUES\n    {vals}\n  AS t({names})"


def load_engine():
    recorder = Recorder()
    pyspark = types.ModuleType("pyspark")
    pyspark.pipelines = recorder.module()
    sys.modules["pyspark"] = pyspark
    sys.modules["pyspark.pipelines"] = pyspark.pipelines
    spec = importlib.util.spec_from_file_location("price_engine", ENGINE)
    module = importlib.util.module_from_spec(spec)
    module.spark = StubSpark({"cpm.statcan_map_path": STATCAN_MAP}, BRONZE)
    spec.loader.exec_module(module)
    return recorder.datasets


def build_ctes(datasets, schema):
    ctes = [f"{name} AS (\n  {values_sql(t['columns'], t['rows'])}\n)" for name, t in BRONZE.items()]
    ctes.append(f"statcan_18100245 AS (SELECT * FROM {schema}.statcan_18100245)")
    expectations = {}
    for ds in datasets:
        frame = ds["fn"]()
        body = values_sql(frame.columns, frame.rows) if isinstance(frame, LocalFrame) else frame.sql
        drops = [c for _, c, action in ds["expectations"] if action == "drop"]
        if drops:
            # The alias matters: without it, "FROM (...) WHERE (col)" parses WHERE as a table alias.
            body = f"SELECT * FROM ({body}) AS expectations WHERE " + " AND ".join(f"({c})" for c in drops)
        ctes.append(f"{ds['name']} AS (\n{body}\n)")
        expectations[ds["name"]] = ds["expectations"]
    return ctes, expectations


# --------------------------------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------------------------------


class Checks:
    def __init__(self):
        self.failed = 0
        self.passed = 0

    def eq(self, label, got, want):
        ok = got == want
        if isinstance(want, float) and isinstance(got, (int, float)):
            ok = abs(got - want) < 1e-9
        self.passed += ok
        self.failed += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {label}: {got!r}" + ("" if ok else f" (want {want!r})"))


def by_key(rows, *keys):
    return {tuple(r[k] for k in keys) if len(keys) > 1 else r[keys[0]]: r for r in rows}


def show(rows, columns, limit=40):
    if not rows:
        print("    (no rows)")
        return
    widths = [max(len(c), *(len(str(r.get(c))) for r in rows[:limit])) for c in columns]
    print("    " + "  ".join(c.ljust(w) for c, w in zip(columns, widths)))
    for r in rows[:limit]:
        print("    " + "  ".join(str(r.get(c)).ljust(w) for c, w in zip(columns, widths)))


def main():
    parser = argparse.ArgumentParser(description="Run price_engine.py's SQL on synthetic data (read only).")
    parser.add_argument("--profile", required=True)
    parser.add_argument("--schema", default="workspace.cpm", help="where statcan_18100245 lives")
    parser.add_argument("--warehouse-id", default=None)
    parser.add_argument("--print-sql", metavar="TABLE", help="print the assembled SQL for one table and exit")
    args = parser.parse_args()

    datasets = load_engine()
    ctes, expectations = build_ctes(datasets, args.schema)
    prefix = "WITH " + ",\n".join(ctes)

    def query(table, order_by):
        sql = f"{prefix}\nSELECT * FROM {table} ORDER BY {order_by}"
        return run_sql(sql, args.profile, args.warehouse_id)[1]

    if args.print_sql:
        print(f"{prefix}\nSELECT * FROM {args.print_sql}")
        return

    print("Datasets:", ", ".join(d["name"] for d in datasets))
    for name, exps in expectations.items():
        for exp_name, cond, action in exps:
            print(f"  expectation {name}.{exp_name} [{action}]: {cond}")
    c = Checks()

    print("\nsilver_prices")
    sp = query("silver_prices", "price_id")
    c.eq("price ids kept (11 price, 12 item, 13 future dropped)", [r["price_id"] for r in sp],
         [i for i in range(1, 28) if i not in (11, 12, 13)])
    c.eq("reporter of 14 is user U2", by_key(sp, "price_id")[14]["reporter"], "U2")
    c.eq("price_per_100ml of 1 (3.50 / 250 ml)", by_key(sp, "price_id")[1]["price_per_100ml"], 1.4)

    print("\nsilver_votes")
    sv = query("silver_votes", "vote_id")
    c.eq("vote ids kept (6, 7 by reporter; 10, 11 on team/seed rows; 3 older vote of U3)",
         [r["vote_id"] for r in sv], [1, 2, 4, 5, 8, 9, 12])

    print("\ngold_price_status")
    st = by_key(query("gold_price_status", "price_id"), "price_id")
    for pid, want in [(1, "official"), (6, "official"), (7, "official"), (8, "pending"), (9, "official"),
                      (10, "pending"), (14, "pending"), (22, "rejected"), (23, "pending"), (25, "official"),
                      (26, "rejected"), (27, "pending")]:
        c.eq(f"status of {pid}", st[pid]["status"], want)
    c.eq("confirmations of 6 (1 matching report)", st[6]["confirmations"], 1)
    c.eq("8 has 1 yes, 1 no, 1 unsure", (st[8]["yes_votes"], st[8]["no_votes"], st[8]["unsure_votes"]), (1, 1, 1))

    print("\ngold_official_prices")
    op = by_key(query("gold_official_prices", "item_id, location_id"), "item_id", "location_id")
    c.eq("official pairs", len(op), 14)
    c.eq("I01 at L03 is the newer confirmed 3.00", op[("I01", "L03")]["price"], 3.0)
    c.eq("I01 at L04 is the confirmed 2.80", op[("I01", "L04")]["price"], 2.8)
    c.eq("I01 at L01 stays 3.50 (needs_review report pending)", op[("I01", "L01")]["price"], 3.5)
    r = op[("I01", "L04")]
    c.eq("I01 at L04 updated_at is its confirming vote, after the report", r["updated_at"] > r["reported_at"], True)
    r = op[("I01", "L01")]
    c.eq("team row updated_at is its report time", r["updated_at"] == r["reported_at"], True)

    print("\ngold_item_stats")
    its = by_key(query("gold_item_stats", "item_id"), "item_id")
    c.eq("I01 n_outlets / min / median / max", tuple(its["I01"][k] for k in
         ("n_outlets", "campus_min", "campus_median", "campus_max")), (4, 2.75, 2.9, 3.5))
    c.eq("I01 cheapest / grocery", (its["I01"]["cheapest_location_id"], its["I01"]["grocery_price"]), ("L02", 2.2))
    c.eq("I04 median 2.465 rounds to the cent like item_medians", its["I04"]["campus_median"], 2.47)

    print("\nsilver_outlet_distances (from L01)")
    od = query("silver_outlet_distances", "from_id, to_id")
    show([r for r in od if r["from_id"] == "L01"], ["from_id", "to_id", "walk_min", "meters", "straight_m", "source"])
    odk = by_key(od, "from_id", "to_id")
    c.eq("L01 → L02 from the walk matrix, normal (not step-free) row",
         (odk[("L01", "L02")]["walk_min"], odk[("L01", "L02")]["source"]), (3.5, "ors"))
    c.eq("L01 → L04 by formula", (odk[("L01", "L04")]["walk_min"], odk[("L01", "L04")]["source"]), (1.0, "haversine"))

    print("\ngold_walk_worth (Red Bull from the Nest, then all)")
    ww = query("gold_walk_worth", "item_id, origin_location_id, net_rank")
    cols = ["item_id", "origin_location_id", "cheaper_location_id", "saving", "extra_min", "time_cost", "net",
            "verdict", "break_even_wage", "net_term", "net_rank"]
    show([r for r in ww if r["item_id"] == "I01" and r["origin_location_id"] == "L01"], cols)
    wwk = by_key(ww, "item_id", "origin_location_id", "cheaper_location_id")
    r = wwk[("I01", "L01", "L04")]
    c.eq("Nest → L04: saving, extra, cost, net, verdict (net exactly at even_band)",
         (r["saving"], r["extra_min"], r["time_cost"], r["net"], r["verdict"]), (0.7, 2.0, 0.6, 0.1, "about_even"))
    c.eq("Nest → L04 break_even_wage", r["break_even_wage"], 21.0)
    r = wwk[("I01", "L01", "L02")]
    c.eq("Nest → L02 (matrix, 3.5 min)", (r["extra_min"], r["net"], r["verdict"]), (7.0, -1.35, "not_worth_it"))
    r = wwk[("I04", "L01", "L04")]
    c.eq("Coke Nest → L04 (seed price, still compared)", (r["net"], r["verdict"], r["net_term"], r["cheaper_source"]),
         (0.37, "worth_it", 4.81, "seed"))

    print("\ngold_price_comparisons")
    pc = query("gold_price_comparisons", "item_id, `rank` NULLS LAST, location_id")
    cols = ["item_id", "location_id", "price", "rank", "n_outlets", "band", "chip", "nearest_cheaper_location_id",
            "walk_best_location_id", "walk_net", "walk_verdict", "statcan_value", "statcan_ratio"]
    show(pc, cols)
    pck = by_key(pc, "item_id", "location_id")
    c.eq("rows", len(pc), 14)
    c.eq("Red Bull ranks 1 to 4", [pck[("I01", l)]["rank"] for l in ("L02", "L04", "L03", "L01")], [1, 2, 3, 4])
    c.eq("Red Bull chips", [pck[("I01", l)]["chip"] for l in ("L02", "L04", "L03", "L01")],
         ["Cheapest on campus", "2nd cheapest of 4", "3rd cheapest of 4", "$0.60 above campus average"])
    c.eq("Red Bull bands", [pck[("I01", l)]["band"] for l in ("L02", "L04", "L03", "L01")],
         ["average", "average", "average", "high"])
    r = pck[("I01", "L01")]
    c.eq("Nest: nearest cheaper, walk best, verdict, net, per term",
         (r["nearest_cheaper_location_id"], r["walk_best_location_id"], r["walk_verdict"], r["walk_net"],
          r["walk_net_term_per_weekly"]), ("L04", "L04", "about_even", 0.1, 1.3))
    c.eq("Nest: gap, pct, vs cheapest, vs grocery, minutes of work",
         (r["gap_vs_median"], r["pct_vs_median"], r["savings_vs_cheapest"], r["premium_vs_grocery"],
          r["minutes_of_work"]), (0.6, 20.7, 0.75, 1.3, 11.7))
    r = pck[("I01", "L20")]
    c.eq("grocery baseline is never ranked", (r["is_benchmark"], r["rank"], r["chip"], r["band"]),
         (True, None, None, None))
    c.eq("coffee bands", [pck[("I08", l)]["band"] for l in ("L03", "L01", "L02")], ["good", "average", "high"])
    r = pck[("I20", "L01")]
    c.eq("banana StatCan", (r["statcan_kind"], r["statcan_value"], r["statcan_ratio"], r["statcan_geo"],
                            r["statcan_ref_month"]), ("same_item", 0.22, 5.69, "British Columbia", "2026-09"))
    c.eq("banana: 2 outlets, no band, chip", (r["band"], r["chip"]), (None, "2nd cheapest of 2"))
    c.eq("drip coffee small ingredients", (pck[("I08", "L01")]["statcan_kind"], pck[("I08", "L01")]["statcan_value"],
                                           pck[("I08", "L01")]["statcan_ratio"]), ("ingredients", 0.28, None))
    c.eq("tea bag, half up", pck[("I11", "L01")]["statcan_value"], 0.23)
    c.eq("tea: 1 outlet, no chip", pck[("I11", "L01")]["chip"], None)

    print("\ngold_parity")
    gp = query("gold_parity", "item_id, location_id")
    show(gp, ["item_id", "location_id", "mismatch", "live_price", "pipeline_price", "live_band", "pipeline_band"])
    c.eq("one mismatch, the planted one", [(r["item_id"], r["location_id"], r["mismatch"]) for r in gp],
         [("I01", "L03", "price_differs")])

    print("\ngold_pitch_numbers")
    pn = query("gold_pitch_numbers", "metric")
    show(pn, ["metric", "value", "unit", "detail"])
    pnk = by_key(pn, "metric")
    c.eq("biggest gap counts seed prices: Coke, $2.95 vs seed $1.98", pnk["biggest_same_item_gap"]["value"], 0.97)
    c.eq("gap detail says it includes AI-estimated prices",
         "AI-estimated" in pnk["biggest_same_item_gap"]["detail"], True)
    c.eq("worth-the-walk share counts seed prices: 1 of 11", pnk["share_worth_the_walk_at_min_wage"]["value"], 9.1)
    c.eq("median net per term: the Coke switch, 4.81 x 4", pnk["median_net_per_term_4_a_week"]["value"], 19.24)
    c.eq("price reports count seed prices: 24", pnk["price_reports"]["value"], 24.0)

    print("\nwithout bronze_walk_matrix (02_bronze_copy skips a missing Lakebase table)")
    matrix = BRONZE.pop("bronze_walk_matrix")
    try:
        ctes_nm, _ = build_ctes(load_engine(), args.schema)
        sql = "WITH " + ",\n".join(ctes_nm) + "\nSELECT DISTINCT source FROM silver_outlet_distances"
        c.eq("every pair falls back to the formula", [r["source"] for r in run_sql(sql, args.profile,
                                                                                    args.warehouse_id)[1]],
             ["haversine"])
    finally:
        BRONZE["bronze_walk_matrix"] = matrix

    print(f"\n{c.passed} passed, {c.failed} failed")
    sys.exit(1 if c.failed else 0)


if __name__ == "__main__":
    main()
