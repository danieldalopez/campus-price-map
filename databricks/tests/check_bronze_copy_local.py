"""Local check of the 02_bronze_copy type mapping, plain Python, no Spark and no database.

    python3 -I databricks/tests/check_bronze_copy_local.py

Runs the pure-Python part of databricks/src/02_bronze_copy.py (everything above its
"END OF PURE-PYTHON PART" line) and checks how every column type in docs/SPEC.md section 6
is read from Postgres and written to Delta.
"""

import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
NOTEBOOK = REPO / "databricks" / "src" / "02_bronze_copy.py"
SENTINEL = "# END OF PURE-PYTHON PART"

source = NOTEBOOK.read_text()
assert SENTINEL in source, "sentinel line missing from the notebook"
pure = source.split(SENTINEL)[0]
# The notebook's first cells use dbutils (pip restart, widgets); skip to the pure-Python cell.
pure = pure[pure.index("import re") :]
nb = {"__name__": "bronze_copy_notebook"}
exec(compile(pure, str(NOTEBOOK), "exec"), nb)

failures = []


def check(label, got, want):
    ok = got == want
    print(f"  {'ok  ' if ok else 'FAIL'} {label}: {got!r}" + ("" if ok else f" (want {want!r})"))
    if not ok:
        failures.append(label)


print("Sources")
check(
    "sources",
    nb["SOURCES"],
    ["prices", "price_votes", "stock_reports", "items", "locations", "carries", "app_config", "walk_matrix", "current_prices"],
)

print("Column types (format_type output → cast, Spark type)")
plan = nb["column_plan"]
cases = {
    "bigint": (None, "BIGINT"),  # prices.id (identity)
    "integer": (None, "INT"),  # items.volume_ml, walk_matrix.meters
    "text": (None, "STRING"),
    "numeric(6,2)": (None, "DECIMAL(6,2)"),  # prices.price
    "numeric(5,1)": (None, "DECIMAL(5,1)"),  # walk_matrix.minutes
    "numeric": ("double precision", "DOUBLE"),  # an unconstrained aggregate in a view
    "numeric(40,2)": ("double precision", "DOUBLE"),  # too wide for Spark
    "double precision": (None, "DOUBLE"),  # locations.lat
    "boolean": (None, "BOOLEAN"),
    "timestamp with time zone": (None, "TIMESTAMP"),
    "timestamp(3) with time zone": (None, "TIMESTAMP"),
    "timestamp without time zone": (None, "TIMESTAMP_NTZ"),
    "character varying(50)": (None, "STRING"),
    "date": (None, "DATE"),
    "price_source": ("text", "STRING"),  # enum
    "uuid": ("text", "STRING"),
    "text[]": ("text", "STRING"),
    "jsonb": ("text", "STRING"),
}
for pg_type, want in cases.items():
    check(pg_type, plan(pg_type), want)

print("SQL and DDL")
cols = [("id", "bigint"), ("price", "numeric(6,2)"), ("source", "price_source"), ("reported_at", "timestamp with time zone")]
check(
    "select_sql",
    nb["select_sql"]("public", "prices", cols),
    'SELECT "id", "price", "source"::text AS "source", "reported_at" FROM "public"."prices"',
)
check("spark_ddl", nb["spark_ddl"](cols), "`id` BIGINT, `price` DECIMAL(6,2), `source` STRING, `reported_at` TIMESTAMP")
check("quoting", nb["qualified_pg"]("public", 'we"ird'), '"public"."we""ird"')

print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
sys.exit(1 if failures else 0)
