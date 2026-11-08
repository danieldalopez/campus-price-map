# Databricks notebook source
# MAGIC %pip install -U databricks-sdk pg8000

# COMMAND ----------

dbutils.library.restartPython()  # load the upgraded databricks-sdk (the postgres module needs 0.81 or newer)

# COMMAND ----------

# MAGIC %md
# MAGIC # 02_bronze_copy: Lakebase → `bronze_*` Delta tables
# MAGIC
# MAGIC First task of the `refresh` Job. Spec: `docs/SPEC.md`, section 10, "Getting Lakebase data into Databricks".
# MAGIC
# MAGIC - Connects to Lakebase with `pg8000` (pure Python: psycopg's bundled libpq aborts the serverless Python process on import) and a 1 hour credential from
# MAGIC   `WorkspaceClient().postgres.generate_database_credential(...)`, issued to whoever the Job runs as. No password is stored.
# MAGIC - Reads `prices`, `price_votes`, `stock_reports`, `items`, `locations`, `carries`, `app_config`, `walk_matrix`
# MAGIC   and the `current_prices` view in **one read-only REPEATABLE READ transaction**, so every copy comes from the same
# MAGIC   snapshot (`gold_parity` compares `bronze_current_prices` with prices rebuilt from the other tables).
# MAGIC - Overwrites one Delta table per source: `workspace.cpm.bronze_<name>`, with the same columns as the Postgres
# MAGIC   table or view plus `copied_at` (the snapshot time, one value per run; `gold_parity` skips reports newer than it).
# MAGIC   Column types follow Postgres; enums (`price_source`) and anything unusual become strings.
# MAGIC - A source that doesn't exist yet in Lakebase is **skipped with a message**, not an error. Its bronze table,
# MAGIC   if any, is left as it was.
# MAGIC - Writes `bronze_copy_log`: one row per source with its status, the Lakebase `count(*)`, the Delta row count and
# MAGIC   the snapshot time. The run fails if a copied table's two counts differ.
# MAGIC
# MAGIC At hackathon scale (hundreds of rows) a full copy takes seconds.

# COMMAND ----------

dbutils.widgets.text("catalog", "workspace")
dbutils.widgets.text("schema", "cpm")
dbutils.widgets.text("lakebase_endpoint", "projects/campus-price-map/branches/production/endpoints/primary")
dbutils.widgets.text("lakebase_database", "databricks_postgres")
dbutils.widgets.text("lakebase_schema", "public")

CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")
LAKEBASE_ENDPOINT = dbutils.widgets.get("lakebase_endpoint")
LAKEBASE_DATABASE = dbutils.widgets.get("lakebase_database")
LAKEBASE_SCHEMA = dbutils.widgets.get("lakebase_schema")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Sources and type mapping (plain Python, no Spark)
# MAGIC
# MAGIC Testable locally: `python3 -I databricks/tests/check_bronze_copy_local.py`.

# COMMAND ----------

import re

# Lakebase relations to copy, in this order. Each lands in bronze_<name>.
SOURCES = [
    "prices",
    "price_votes",
    "stock_reports",
    "items",
    "locations",
    "carries",
    "app_config",
    "walk_matrix",
    "current_prices",  # view (db/views.sql)
]

# Extra column on every bronze table: when this copy's snapshot was taken (UTC).
COPIED_AT = "copied_at"

# Postgres type name (format_type, without length or precision) → Spark SQL type.
_SIMPLE_TYPES = {
    "bigint": "BIGINT",
    "integer": "INT",
    "smallint": "SMALLINT",
    "double precision": "DOUBLE",
    "real": "FLOAT",
    "boolean": "BOOLEAN",
    "text": "STRING",
    "character varying": "STRING",
    "character": "STRING",
    "timestamp with time zone": "TIMESTAMP",
    "timestamp without time zone": "TIMESTAMP_NTZ",
    "date": "DATE",
}


def column_plan(pg_type):
    """Map a Postgres column type, as format_type() prints it, to (cast, spark_type).

    cast is the Postgres type to cast to in the SELECT, or None to read the column as it is.
    - numeric(p,s) keeps its precision: DECIMAL(p,s).
    - numeric with no precision (aggregates in views) is read as double precision.
    - enums (price_source), uuid, json, arrays and anything else are read as text.
    """
    t = " ".join(pg_type.lower().split())
    if t.endswith("[]"):
        return "text", "STRING"
    m = re.fullmatch(r"numeric\((\d+)(?:,(\d+))?\)", t)
    if m:
        precision, scale = int(m.group(1)), int(m.group(2) or 0)
        if precision <= 38:
            return None, f"DECIMAL({precision},{scale})"
        return "double precision", "DOUBLE"
    if t == "numeric":
        return "double precision", "DOUBLE"
    base = re.sub(r"\(\d+\)", "", t).strip()  # character varying(50), timestamp(3) with time zone
    if base in _SIMPLE_TYPES:
        return None, _SIMPLE_TYPES[base]
    return "text", "STRING"


def quote_pg(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def qualified_pg(schema, relation):
    return f"{quote_pg(schema)}.{quote_pg(relation)}"


def select_sql(schema, relation, columns):
    """SELECT for one relation. columns: [(name, pg_type), ...] in table order."""
    parts = []
    for name, pg_type in columns:
        cast, _ = column_plan(pg_type)
        q = quote_pg(name)
        parts.append(f"{q}::{cast} AS {q}" if cast else q)
    return f"SELECT {', '.join(parts)} FROM {qualified_pg(schema, relation)}"


def spark_ddl(columns):
    """Spark schema as DDL, so an empty table still gets the right columns."""
    return ", ".join(f"`{name.replace('`', '``')}` {column_plan(pg_type)[1]}" for name, pg_type in columns)

# END OF PURE-PYTHON PART (databricks/tests/check_bronze_copy_local.py runs everything above this line)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Read Lakebase (one consistent snapshot)

# COMMAND ----------

import ssl
import time

import pg8000.dbapi
from databricks.sdk import WorkspaceClient

COLUMNS_SQL = """
    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass(%s) AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
"""
KIND_SQL = "SELECT relkind FROM pg_class WHERE oid = to_regclass(%s)"
KINDS = {"r": "table", "p": "table", "v": "view", "m": "materialized view", "f": "foreign table"}


def connect_lakebase():
    """Open a pg8000 connection with a 1 hour OAuth credential and verified TLS. Retries while Lakebase wakes from
    scale to zero. pg8000 is pure Python, so nothing native can clash with the serverless runtime."""
    w = WorkspaceClient()
    host = w.postgres.get_endpoint(name=LAKEBASE_ENDPOINT).status.hosts.host
    user = w.current_user.me().user_name
    token = w.postgres.generate_database_credential(endpoint=LAKEBASE_ENDPOINT).token  # never printed or stored
    print(f"Connecting to Lakebase {LAKEBASE_ENDPOINT}, database {LAKEBASE_DATABASE}, as {user}")
    last_error = None
    for attempt in range(1, 4):
        try:
            conn = pg8000.dbapi.connect(
                host=host,
                port=5432,
                database=LAKEBASE_DATABASE,
                user=user,
                password=token,
                ssl_context=ssl.create_default_context(),
                timeout=30,
                application_name="cpm_02_bronze_copy",
            )
            conn.autocommit = True  # the only transaction is the explicit BEGIN ... COMMIT below
            return conn
        # DatabaseError covers server-side refusals such as 57P03 "the database system is starting up" while
        # Lakebase wakes from scale to zero; InterfaceError and OSError cover network failures.
        except (pg8000.dbapi.InterfaceError, pg8000.dbapi.DatabaseError, OSError) as e:
            last_error = e
            first_line = str(e).splitlines()[0] if str(e) else type(e).__name__
            print(f"  attempt {attempt} failed: {first_line}")
            if attempt < 3:
                time.sleep(10)
    raise RuntimeError("Could not connect to Lakebase after 3 attempts") from last_error


fetched = {}  # name -> (kind, columns, rows, lakebase_count)
skipped = {}  # name -> message

conn = connect_lakebase()
cur = conn.cursor()
try:
    # One read-only REPEATABLE READ transaction, so every table comes from the same snapshot.
    cur.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
    cur.execute("SET LOCAL TIME ZONE 'UTC'")
    cur.execute("SELECT now()")
    snapshot_at = cur.fetchone()[0]
    for name in SOURCES:
        relation = qualified_pg(LAKEBASE_SCHEMA, name)
        cur.execute(KIND_SQL, (relation,))
        found = cur.fetchone()
        if found is None:
            skipped[name] = (
                f"{LAKEBASE_SCHEMA}.{name} doesn't exist in Lakebase yet "
                "(app Step 2 creates it: db/schema.sql, db/views.sql, db/seed.sql)"
            )
            continue
        kind = KINDS.get(found[0], found[0])
        cur.execute(COLUMNS_SQL, (relation,))
        columns = [tuple(c) for c in cur.fetchall()]
        cur.execute(select_sql(LAKEBASE_SCHEMA, name, columns))
        rows = [tuple(r) for r in cur.fetchall()]
        cur.execute(f"SELECT count(*) FROM {relation}")
        lakebase_count = cur.fetchone()[0]
        fetched[name] = (kind, columns, rows, lakebase_count)
        print(f"  read {LAKEBASE_SCHEMA}.{name} ({kind}): {len(rows)} rows, {len(columns)} columns")
    cur.execute("COMMIT")
finally:
    conn.close()

print(f"Snapshot at {snapshot_at.isoformat()}: {len(fetched)} read, {len(skipped)} skipped")
for name, message in skipped.items():
    print(f"  SKIPPED {name}: {message}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Write `bronze_*` Delta tables

# COMMAND ----------

log = []
for name in SOURCES:
    target = f"{CATALOG}.{SCHEMA}.bronze_{name}"
    if name in skipped:
        left = "left as it was" if spark.catalog.tableExists(target) else "not created"
        log.append((name, None, "skipped", None, None, target, snapshot_at, f"{skipped[name]}; {target} {left}"))
        continue
    kind, columns, rows, lakebase_count = fetched[name]
    # copied_at: the snapshot time, the same on every row of every bronze table this run.
    # gold_parity skips reports newer than it.
    df = spark.createDataFrame(
        [row + (snapshot_at,) for row in rows],
        schema=spark_ddl(columns) + f", `{COPIED_AT}` TIMESTAMP",
    )
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(target)
    delta_count = spark.table(target).count()
    log.append((name, kind, "copied", lakebase_count, delta_count, target, snapshot_at, None))
    print(f"{target}: {delta_count} rows (Lakebase count(*) = {lakebase_count})")

log_df = spark.createDataFrame(
    log,
    "source STRING, kind STRING, status STRING, lakebase_count BIGINT, delta_count BIGINT, "
    "delta_table STRING, snapshot_at TIMESTAMP, message STRING",
)
log_df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{CATALOG}.{SCHEMA}.bronze_copy_log")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Check: Delta row counts equal Lakebase `count(*)`
# MAGIC
# MAGIC D1 **Show me**: `bronze_prices` has as many rows as `select count(*) from prices` in Lakebase.

# COMMAND ----------

display(spark.table(f"{CATALOG}.{SCHEMA}.bronze_copy_log"))

mismatches = [row for row in log if row[2] == "copied" and row[3] != row[4]]
if mismatches:
    raise AssertionError(f"Row counts differ between Lakebase and Delta: {[(m[0], m[3], m[4]) for m in mismatches]}")

copied = [row[0] for row in log if row[2] == "copied"]
summary = f"copied {len(copied)} of {len(SOURCES)} sources at {snapshot_at.isoformat()}"
if skipped:
    summary += f"; skipped (not in Lakebase yet): {', '.join(skipped)}"
print(summary)
dbutils.notebook.exit(summary)
