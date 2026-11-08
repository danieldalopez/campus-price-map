#!/bin/bash
# D3: sync the gold tables the app serves into Lakebase, as Postgres schema "serving" (docs/SPEC.md section 10).
# Run once, from the repo root, after a refresh run has built the gold tables:
#   bash databricks/create_synced_tables.sh                 creates what's missing, skips what exists
#   bash databricks/create_synced_tables.sh --status        only reports
# Snapshot mode: the sources are materialized views (no change data feed) and a few hundred rows copy in seconds.
# Bundles can't define Lakebase synced tables yet, so this uses the CLI. Always the campus-price-map profile.
set -euo pipefail

PROFILE=campus-price-map
CATALOG=workspace
SOURCE_SCHEMA=cpm          # where the pipeline publishes gold_*
SERVING_SCHEMA=serving     # UC schema of the synced table entries; also the Postgres schema the app reads
BRANCH=projects/campus-price-map/branches/production
PG_DATABASE=databricks_postgres

# synced table name | source table | primary key columns (comma separated)
TABLES=(
  "price_comparisons|gold_price_comparisons|item_id,location_id"
  "outlet_scores|gold_outlet_scores|location_id"          # D5: exists once 03_price_model.py has run
)

sql() { databricks experimental aitools tools query "$1" --profile "$PROFILE" >/dev/null; }
exists_uc() {
  databricks tables get "$1" --profile "$PROFILE" >/dev/null 2>&1
}
synced_state() {
  databricks postgres get-synced-table "synced_tables/$1" --profile "$PROFILE" -o json 2>/dev/null \
    | python3 -I -c "import json,sys; d=json.load(sys.stdin); s=d.get('status',{}); print(s.get('detailed_state') or s.get('state') or 'UNKNOWN')" 2>/dev/null \
    || echo "MISSING"
}

if [ "${1:-}" != "--status" ]; then
  sql "CREATE SCHEMA IF NOT EXISTS ${CATALOG}.${SERVING_SCHEMA} COMMENT 'Synced table entries for the Campus Price Map app (Lakebase schema serving)'"
fi

for row in "${TABLES[@]}"; do
  IFS='|' read -r name source pk <<<"${row%%#*}"
  name=$(echo "$name" | xargs); source=$(echo "$source" | xargs); pk=$(echo "$pk" | xargs)
  target="${CATALOG}.${SERVING_SCHEMA}.${name}"
  state=$(synced_state "$target")
  if [ "${1:-}" = "--status" ] || [ "$state" != "MISSING" ]; then
    echo "${target}: ${state}"
    continue
  fi
  if ! exists_uc "${CATALOG}.${SOURCE_SCHEMA}.${source}"; then
    echo "${target}: skipped, source ${CATALOG}.${SOURCE_SCHEMA}.${source} doesn't exist yet"
    continue
  fi
  keys=$(python3 -I -c "import json,sys; print(json.dumps(sys.argv[1].split(',')))" "$pk")
  echo "${target}: creating from ${CATALOG}.${SOURCE_SCHEMA}.${source} (primary key ${pk}, snapshot)"
  databricks postgres create-synced-table "$target" --profile "$PROFILE" --json "{
    \"spec\": {
      \"source_table_full_name\": \"${CATALOG}.${SOURCE_SCHEMA}.${source}\",
      \"primary_key_columns\": ${keys},
      \"scheduling_policy\": \"SNAPSHOT\",
      \"branch\": \"${BRANCH}\",
      \"postgres_database\": \"${PG_DATABASE}\",
      \"create_database_objects_if_missing\": true
    }
  }" >/dev/null
  echo "${target}: $(synced_state "$target")"
done

echo
echo "Next: grant the app's reader on schema ${SERVING_SCHEMA} (databricks/src/04_grants.py, or the SQL in db/roles.sql),"
echo "and put each table's sync pipeline id in databricks.yml for the refresh Job:"
echo "  databricks postgres get-synced-table synced_tables/${CATALOG}.${SERVING_SCHEMA}.<name> --profile ${PROFILE} -o json"
