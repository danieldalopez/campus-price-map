# Databricks notebook source
# MAGIC %pip install -U databricks-sdk pg8000

# COMMAND ----------

dbutils.library.restartPython()  # load the upgraded databricks-sdk (the postgres module needs 0.81 or newer)

# COMMAND ----------

# MAGIC %md
# MAGIC # 04_grants: let the app read the synced tables (D3)
# MAGIC
# MAGIC Synced tables land in the Lakebase schema `serving` (docs/SPEC.md section 10). A snapshot refresh can recreate
# MAGIC them, which drops grants, so the refresh Job runs this after every sync: `app_reader` gets `USAGE` on the schema
# MAGIC and `SELECT` on every table in it. Idempotent. Connects with pg8000 (pure Python) and a 1 hour OAuth credential for
# MAGIC whoever the Job runs as, who must be able to grant on `serving` (the Lakebase project owner). No password is stored.

# COMMAND ----------

dbutils.widgets.text("lakebase_endpoint", "projects/campus-price-map/branches/production/endpoints/primary")
dbutils.widgets.text("lakebase_database", "databricks_postgres")
dbutils.widgets.text("serving_schema", "serving")
dbutils.widgets.text("reader_role", "app_reader")

LAKEBASE_ENDPOINT = dbutils.widgets.get("lakebase_endpoint")
LAKEBASE_DATABASE = dbutils.widgets.get("lakebase_database")
SERVING_SCHEMA = dbutils.widgets.get("serving_schema")
READER_ROLE = dbutils.widgets.get("reader_role")

# COMMAND ----------

import re
import ssl
import time

import pg8000.dbapi
from databricks.sdk import WorkspaceClient

for value in (SERVING_SCHEMA, READER_ROLE):
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", value):
        raise ValueError(f"Not a plain Postgres identifier: {value!r}")


def connect_lakebase():
    w = WorkspaceClient()
    host = w.postgres.get_endpoint(name=LAKEBASE_ENDPOINT).status.hosts.host
    user = w.current_user.me().user_name
    token = w.postgres.generate_database_credential(endpoint=LAKEBASE_ENDPOINT).token  # never printed or stored
    print(f"Connecting to Lakebase {LAKEBASE_ENDPOINT}, database {LAKEBASE_DATABASE}, as {user}")
    last_error = None
    for attempt in range(1, 4):
        try:
            conn = pg8000.dbapi.connect(
                host=host, port=5432, database=LAKEBASE_DATABASE, user=user, password=token,
                ssl_context=ssl.create_default_context(), timeout=30, application_name="cpm_04_grants",
            )
            conn.autocommit = True
            return conn
        except (pg8000.dbapi.InterfaceError, pg8000.dbapi.DatabaseError, OSError) as e:
            last_error = e
            print(f"  attempt {attempt} failed: {str(e).splitlines()[0] if str(e) else type(e).__name__}")
            if attempt < 3:
                time.sleep(10)
    raise RuntimeError("Could not connect to Lakebase after 3 attempts") from last_error


conn = connect_lakebase()
cur = conn.cursor()
try:
    cur.execute("SELECT to_regnamespace(%s) IS NOT NULL", (SERVING_SCHEMA,))
    if not cur.fetchone()[0]:
        dbutils.notebook.exit(f"Schema {SERVING_SCHEMA} doesn't exist yet: nothing to grant (run create_synced_tables.sh)")
    cur.execute(f'GRANT USAGE ON SCHEMA "{SERVING_SCHEMA}" TO "{READER_ROLE}"')
    cur.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{SERVING_SCHEMA}" TO "{READER_ROLE}"')
    cur.execute(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = %s AND c.relkind IN ('r', 'p', 'v', 'm') AND has_table_privilege(%s, c.oid, 'SELECT') "
        "ORDER BY 1",
        (SERVING_SCHEMA, READER_ROLE),
    )
    readable = [r[0] for r in cur.fetchall()]
finally:
    conn.close()

summary = f"{READER_ROLE} can read {len(readable)} table(s) in {SERVING_SCHEMA}: {', '.join(readable) or 'none'}"
print(summary)
dbutils.notebook.exit(summary)
