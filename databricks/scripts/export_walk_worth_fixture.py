"""D8: export 30 rows of gold_walk_worth to tests/fixtures/walk_worth.json (docs/SPEC.md, section 10).

`tests/walkworth.test.ts` (app Step 14) puts the student exactly at the origin outlet and must reproduce
saving, extra_min, net, verdict and break_even_wage to the cent. One formula, two implementations.

Read only: one SELECT on a SQL warehouse. Run from the repo root after a pipeline run:

    python3 databricks/scripts/export_walk_worth_fixture.py --profile campus-price-map

Rows are picked round robin across the three verdicts, so the fixture covers worth_it, about_even and
not_worth_it whenever the data has them. Every row carries the constants it was computed with
(wage, round_trip, even_band, weeks_*) and both outlets' coordinates, so the test needs no other input.
"""

import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbsql import run_sql  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_OUT = os.path.join(REPO_ROOT, "tests", "fixtures", "walk_worth.json")

COLUMNS = [
    "item_id", "item_name",
    "origin_location_id", "origin_name", "origin_lat", "origin_lng",
    "cheaper_location_id", "cheaper_name", "cheaper_lat", "cheaper_lng",
    "origin_price", "cheaper_price", "saving",
    "walk_min", "walk_source", "round_trip", "extra_min",
    "wage", "time_cost", "net", "even_band", "verdict",
    "break_even_wage", "break_even_min",
    "weeks_term", "saved_term", "minutes_term", "net_term",
    "weeks_year", "saved_year", "minutes_year", "net_year",
    "weeks_degree", "saved_degree", "minutes_degree", "net_degree",
    "net_rank",
]


def build_query(schema, n):
    cols = ", ".join(f"w.{c}" for c in COLUMNS if not c.endswith(("_lat", "_lng")))
    return f"""
        SELECT {cols},
               CAST(lo.lat AS DOUBLE) AS origin_lat, CAST(lo.lng AS DOUBLE) AS origin_lng,
               CAST(lc.lat AS DOUBLE) AS cheaper_lat, CAST(lc.lng AS DOUBLE) AS cheaper_lng
        FROM (
          SELECT *, row_number() OVER (PARTITION BY verdict
                                       ORDER BY item_id, origin_location_id, cheaper_location_id) AS pick
          FROM {schema}.gold_walk_worth
          WHERE verdict IS NOT NULL
        ) w
        JOIN {schema}.bronze_locations lo ON CAST(lo.id AS STRING) = w.origin_location_id
        JOIN {schema}.bronze_locations lc ON CAST(lc.id AS STRING) = w.cheaper_location_id
        ORDER BY w.pick, w.verdict
        LIMIT {int(n)}
    """


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--profile", required=True, help="Databricks CLI profile (SPEC rule 11)")
    parser.add_argument("--schema", default="workspace.cpm", help="catalog.schema of the pipeline tables")
    parser.add_argument("--warehouse-id", default=None, help="SQL warehouse; default: the first running one")
    parser.add_argument("--rows", type=int, default=30)
    parser.add_argument("--out", default=DEFAULT_OUT)
    args = parser.parse_args()

    _, rows = run_sql(build_query(args.schema, args.rows), args.profile, args.warehouse_id)
    if not rows:
        raise SystemExit(f"{args.schema}.gold_walk_worth has no rows with a verdict. Run the pipeline first.")

    fixture = {
        "source": f"{args.schema}.gold_walk_worth",
        "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "spec": "docs/SPEC.md, section 10, Worth the walk",
        "formula": {
            "saving": "origin_price - cheaper_price",
            "extra_min": "walk_min * (2 if round_trip else 1); student at the origin, so walk(you, near) = 0",
            "time_cost": "extra_min / 60 * wage",
            "net": "round(saving - extra_min / 60 * wage, 2)",
            "rounding": (
                "Every rounded value is rounded half away from zero on its shortest decimal form, like Spark's round: "
                "-5.175 -> -5.18 (JS Math.round gives -5.17). In JS: const r = Number(x.toPrecision(12)); "
                "Math.sign(r) * Math.round(Math.abs(r) * 100) / 100"
            ),
            "verdict": "worth_it if net > even_band; not_worth_it if net < -even_band; else about_even",
            "break_even_wage": "saving / (extra_min / 60), null when extra_min is 0",
            "break_even_min": "saving / wage * 60",
            "per horizon H": "saved_H = saving * H, minutes_H = extra_min * H, net_H = net * H",
        },
        "rows": [{c: r.get(c) for c in COLUMNS} for r in rows],
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(fixture, f, indent=2, ensure_ascii=False)
        f.write("\n")
    verdicts = {}
    for r in rows:
        verdicts[r["verdict"]] = verdicts.get(r["verdict"], 0) + 1
    print(f"Wrote {len(rows)} rows to {os.path.relpath(args.out, REPO_ROOT)}: {verdicts}")


if __name__ == "__main__":
    main()
