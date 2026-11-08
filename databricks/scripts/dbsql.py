"""Run one read-only SQL statement on a Databricks SQL warehouse through the `databricks` CLI.

Standard library only. Uses the Statement Execution API (`databricks api post /api/2.0/sql/statements`),
so it needs nothing installed beyond the CLI and a profile. Used by `export_walk_worth_fixture.py` and
`databricks/tests/check_price_engine.py`.
"""

import json
import os
import subprocess
import tempfile
import time

NUMERIC_TYPES = {"BYTE", "SHORT", "INT", "LONG", "FLOAT", "DOUBLE", "DECIMAL"}
INTEGER_TYPES = {"BYTE", "SHORT", "INT", "LONG"}


def _cli(args, profile):
    out = subprocess.run(
        ["databricks", *args, "--profile", profile, "-o", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(out.stdout) if out.stdout.strip() else {}


def pick_warehouse(profile):
    warehouses = _cli(["warehouses", "list"], profile)
    if not warehouses:
        raise SystemExit("No SQL warehouse in this workspace.")
    running = [w for w in warehouses if w.get("state") == "RUNNING"]
    return (running or warehouses)[0]["id"]


def _convert(value, type_name):
    if value is None:
        return None
    if type_name in INTEGER_TYPES:
        return int(value)
    if type_name in NUMERIC_TYPES:
        return float(value)
    if type_name == "BOOLEAN":
        return value.lower() == "true"
    return value


def run_sql(sql, profile, warehouse_id=None, timeout_s=300):
    """Return (column names, rows as dicts with typed values)."""
    warehouse_id = warehouse_id or pick_warehouse(profile)
    body = {
        "warehouse_id": warehouse_id,
        "statement": sql,
        "wait_timeout": "50s",
        "on_wait_timeout": "CONTINUE",
        "disposition": "INLINE",
        "format": "JSON_ARRAY",
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(body, f)
        body_path = f.name
    try:
        resp = _cli(["api", "post", "/api/2.0/sql/statements", "--json", f"@{body_path}"], profile)
    finally:
        os.unlink(body_path)

    deadline = time.time() + timeout_s
    while resp["status"]["state"] in ("PENDING", "RUNNING"):
        if time.time() > deadline:
            raise TimeoutError(f"statement {resp['statement_id']} still {resp['status']['state']}")
        time.sleep(2)
        resp = _cli(["api", "get", f"/api/2.0/sql/statements/{resp['statement_id']}"], profile)

    if resp["status"]["state"] != "SUCCEEDED":
        error = resp["status"].get("error", {})
        raise RuntimeError(f"{resp['status']['state']}: {error.get('message', resp['status'])}")

    columns = resp["manifest"]["schema"].get("columns", [])
    names = [c["name"] for c in columns]
    types = [c["type_name"] for c in columns]
    chunks = [resp.get("result", {})]
    next_link = chunks[0].get("next_chunk_internal_link")
    while next_link:
        chunk = _cli(["api", "get", next_link], profile)
        chunks.append(chunk)
        next_link = chunk.get("next_chunk_internal_link")
    rows = []
    for chunk in chunks:
        for raw in chunk.get("data_array", []) or []:
            rows.append({n: _convert(v, t) for n, v, t in zip(names, raw, types)})
    return names, rows
