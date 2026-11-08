# Databricks notebook source
# MAGIC %md
# MAGIC # 01_statcan: StatCan files in the Volume → `statcan_*` Delta tables
# MAGIC
# MAGIC Run once by hand (StatCan publishes monthly, so this is not in the refresh Job). Spec: `docs/SPEC.md`, section 10, "StatCan".
# MAGIC
# MAGIC **Input**, uploaded as downloaded to `/Volumes/workspace/cpm/raw/statcan/` (no internet needed):
# MAGIC - Full tables `18100245-eng.zip` (retail prices) and `18100004-eng.zip` (CPI). Columns `REF_DATE, GEO, DGUID, <dimensions>, UOM, ..., VALUE, STATUS, ...`.
# MAGIC   Only rows with GEO in British Columbia, Canada or "Vancouver, British Columbia" are kept. These are the sources for everything the app shows.
# MAGIC - 9 "as displayed" CSVs (`1810024501-eng.csv`, ...), Canada level, used for pitch numbers. Title lines, footnote numbers on labels,
# MAGIC   quality letters on values, `..` for missing, thousands commas, one column per period, footnotes after the data.
# MAGIC
# MAGIC **Output**, one Delta table per file in `workspace.cpm`, named after the file: `statcan_18100245` and `statcan_18100004` (full tables),
# MAGIC `statcan_1810024501` ... (as displayed). Columns: `table_id, geo, <dimensions>, ref_period, value, status, unit, use_with_caution`.
# MAGIC - `table_id` is StatCan's id, e.g. `18-10-0245-01` (the full table and its "as displayed" view share it).
# MAGIC - `ref_period` is `YYYY-MM` for months, `YYYY` for years.
# MAGIC - `status` is StatCan's symbol (quality letter A to F, `..` not available, `t` terminated...). Rows graded F are dropped;
# MAGIC   D or E set `use_with_caution` (G9: label them "use with caution" wherever quoted).

# COMMAND ----------

CATALOG = "workspace"
SCHEMA = "cpm"
RAW_DIR = "/Volumes/workspace/cpm/raw/statcan"

FULL_TABLE_FILES = ["18100245-eng.zip", "18100004-eng.zip"]
KEEP_GEOS = {"British Columbia", "Canada", "Vancouver, British Columbia"}

DISPLAYED_FILES = [
    "1810024501-eng.csv",  # Monthly average retail prices (Canada, May to Sep 2026)
    "1810000401-eng.csv",  # CPI, monthly
    "1310083401-eng.csv",  # Food insecurity by economic family type
    "1310083501-eng.csv",  # Food insecurity by demographics
    "1110012501-eng.csv",  # Detailed food spending per household
    "1110022201-eng.csv",  # Household spending
    "1110022301-eng.csv",  # Household spending by income quintile
    "2110001901-eng.csv",  # Food services and drinking places receipts, monthly
    "1410006401-eng.csv",  # Employee wages by industry
]

# COMMAND ----------

# MAGIC %md
# MAGIC ## Parsers (plain Python, no Spark)
# MAGIC
# MAGIC Everything in this cell is plain Python so it can be tested locally:
# MAGIC `python3 -I databricks/tests/check_statcan_local.py ~/Downloads`.

# COMMAND ----------

import csv
import io
import os
import re
import zipfile

NBSP = " "
FOOTNOTE_RE = re.compile(r"(?:\s+\d+)+$")  # "Apples, per kilogram 5" / "Oranges, 1.36 kilograms 5 6"
VALUE_RE = re.compile(r"^(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)?(.*)$")  # "26.7C" / "8,389,677A" / ".." / "..t" / "F"
SCALAR_RE = re.compile(r"\(x ([\d,]+)\)")  # "(x 1,000)" in a title
MONTHS = {
    m: k
    for k, m in enumerate(
        ["january", "february", "march", "april", "may", "june", "july",
         "august", "september", "october", "november", "december"],
        start=1,
    )
}
BASE_COLUMNS = ["table_id", "geo", "ref_period", "value", "status", "unit", "use_with_caution"]


def clean_text(s):
    return (s or "").replace(NBSP, " ").strip()


def clean_label(s):
    """Strip trailing footnote numbers from a label. Never use on period cells ("May 2026")."""
    return FOOTNOTE_RE.sub("", clean_text(s)).strip()


def snake(name):
    out = re.sub(r"[^0-9a-z]+", "_", clean_text(name).lower()).strip("_")
    return out or "dimension"


def dim_column(name, taken):
    col = snake(name)
    if col in BASE_COLUMNS or col in taken:
        col = "dim_" + col
    return col


def table_id_from_stem(stem):
    """'18100245' or '1810024501' -> '18-10-0245-01'."""
    s = stem[:8]
    return f"{s[0:2]}-{s[2:4]}-{s[4:8]}-{stem[8:10] or '01'}"


def parse_value(cell):
    """'26.7C' -> (26.7, 'C'); '..' -> (None, '..'); '8,389,677A' -> (8389677.0, 'A'); '' -> (None, None)."""
    s = clean_text(cell).replace(" ", "")
    if not s:
        return None, None
    m = VALUE_RE.match(s)
    num, flag = m.group(1), m.group(2).strip()
    return (float(num.replace(",", "")) if num else None), (flag or None)


def quality_grade(status):
    """StatCan quality letter A (excellent) to F (too unreliable to publish), or None."""
    m = re.search(r"[A-F]", status or "")
    return m.group(0) if m else None


def parse_period(s):
    s = clean_text(s)
    if re.fullmatch(r"\d{4}(-\d{2}){0,2}", s) or re.fullmatch(r"\d{4}/\d{4}", s):
        return s
    m = re.fullmatch(r"([A-Za-z]+) (\d{4})", s)
    if m and m.group(1).lower() in MONTHS:
        return f"{m.group(2)}-{MONTHS[m.group(1).lower()]:02d}"
    m = re.fullmatch(r"Q([1-4]) (\d{4})", s)
    if m:
        return f"{m.group(2)}-Q{m.group(1)}"
    return None


def ffill(cells, n):
    out, last = [], None
    for k in range(n):
        c = cells[k] if k < len(cells) else ""
        if c:
            last = c
        out.append(last)
    return out


def finish_record(rec):
    """Apply the quality rules. Returns None for F-graded rows (dropped)."""
    grade = quality_grade(rec["status"])
    if grade == "F":
        return None
    rec["use_with_caution"] = grade in ("D", "E")
    return rec


def parse_displayed(text, file_name):
    """Parse a StatCan "as displayed" CSV export into long rows.

    Layout: single-cell title/metadata lines, blank lines, column-dimension rows
    (`"Geography","Canada",,,`; multi-level ones span columns and are forward-filled),
    the header row (row dimension name + one cell per period), an optional unit row
    (`,"Dollars",,,`), data rows, then a blank line and footnotes.
    """
    stem = os.path.basename(file_name).split("-")[0]
    rows = [[clean_text(c) for c in r] for r in csv.reader(io.StringIO(text.lstrip("﻿")))]

    meta = {"title": None, "table": None, "release_date": None}
    col_dims = []  # [(name, values per column)]
    header_at = None
    for i, cells in enumerate(rows):
        nonempty = [c for c in cells if c]
        if not nonempty:
            continue
        if len(nonempty) == 1 and cells[0]:
            line = cells[0]
            if line.startswith("Table:"):
                meta["table"] = line.split(":", 1)[1].split("(")[0].strip()
            elif line.startswith("Release date:"):
                meta["release_date"] = line.split(":", 1)[1].strip()
            elif meta["title"] is None:
                meta["title"] = clean_label(line)
            continue
        if not cells[0]:
            raise ValueError(f"{file_name}: unexpected row before the header: {cells}")
        tail = [c for c in cells[1:] if c]
        if all(parse_period(c) for c in tail):
            header_at = i
            break
        col_dims.append((clean_label(cells[0]), cells[1:]))
    if header_at is None:
        raise ValueError(f"{file_name}: no header row with periods found")

    header = rows[header_at]
    while header and not header[-1]:
        header.pop()
    periods = [parse_period(c) for c in header[1:]]
    n = len(periods)
    row_dim = clean_label(header[0])
    col_dims = [(name, [clean_label(v) if v else None for v in ffill(vals, n)]) for name, vals in col_dims]

    j = header_at + 1
    units = [None] * n
    if j < len(rows) and rows[j] and not rows[j][0] and any(rows[j]):
        units = ffill(rows[j][1:], n)
        j += 1
    scalar = SCALAR_RE.search(meta["title"] or "")
    if scalar:
        units = [f"{u} (x {scalar.group(1)})" if u else f"x {scalar.group(1)}" for u in units]

    # Output columns: Geography goes to `geo`, every other dimension gets its own column.
    dim_cols, taken = [], set()
    for name in [d[0] for d in col_dims] + [row_dim]:
        if name == "Geography":
            dim_cols.append("geo")
        else:
            col = dim_column(name, taken)
            taken.add(col)
            dim_cols.append(col)
    columns = ["table_id", "geo"] + [c for c in dim_cols if c != "geo"] + BASE_COLUMNS[2:]

    table_id = meta["table"] or table_id_from_stem(stem)
    records, dropped_f = [], 0
    for cells in rows[j:]:
        if not any(cells):
            break  # first blank line ends the data
        label = clean_label(cells[0])
        for k in range(n):
            value, status = parse_value(cells[k + 1] if k + 1 < len(cells) else "")
            rec = {"table_id": table_id, "geo": None}
            for (name, vals), col in zip(col_dims, dim_cols):
                rec[col] = vals[k]
            rec[dim_cols[-1]] = label
            rec.update(ref_period=periods[k], value=value, status=status, unit=units[k])
            rec = finish_record(rec)
            if rec is None:
                dropped_f += 1
            else:
                records.append(rec)
    meta.update(stem=stem, table_id=table_id, kind="as displayed", dropped_f=dropped_f)
    return meta, columns, records


def parse_full_table(zip_path, keep_geos=KEEP_GEOS):
    """Parse a StatCan full-table ZIP (`<pid>.csv` + `<pid>_MetaData.csv`), keeping only `keep_geos`."""
    stem = os.path.basename(zip_path).split("-")[0]
    meta = {"title": None, "release_date": None}
    records, dropped_f = [], 0
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        data_name = next(x for x in names if x.endswith(".csv") and "MetaData" not in x)
        meta_name = next((x for x in names if x.endswith("_MetaData.csv")), None)
        if meta_name:
            with zf.open(meta_name) as fh:
                md = csv.reader(io.TextIOWrapper(fh, encoding="utf-8-sig", newline=""))
                md_header, md_row = next(md), next(md)
                md = dict(zip(md_header, md_row))
                meta["title"] = md.get("Cube Title")
                meta["end_period"] = md.get("End Reference Period")
        with zf.open(data_name) as fh:
            reader = csv.reader(io.TextIOWrapper(fh, encoding="utf-8-sig", newline=""))
            header = next(reader)
            if not {"REF_DATE", "GEO", "VALUE", "STATUS"} <= set(header):
                raise ValueError(f"{zip_path}: not a StatCan full-table CSV: {header[:6]}")
            ix = {h: k for k, h in enumerate(header)}
            dim_names = header[ix["DGUID"] + 1 : ix["UOM"]]
            taken, dim_cols = set(), []
            for name in dim_names:
                col = dim_column(name, taken)
                taken.add(col)
                dim_cols.append(col)
            columns = ["table_id", "geo"] + dim_cols + BASE_COLUMNS[2:]
            table_id = table_id_from_stem(stem)
            i_geo, i_ref, i_val, i_st = ix["GEO"], ix["REF_DATE"], ix["VALUE"], ix["STATUS"]
            i_uom, i_sf = ix["UOM"], ix["SCALAR_FACTOR"]
            i_dims = [ix[d] for d in dim_names]
            for r in reader:
                if r[i_geo] not in keep_geos:
                    continue
                unit = r[i_uom] or None
                if r[i_sf] and r[i_sf] != "units":
                    unit = f"{unit} ({r[i_sf]})"
                rec = {"table_id": table_id, "geo": r[i_geo]}
                for col, k in zip(dim_cols, i_dims):
                    rec[col] = r[k]
                rec.update(
                    ref_period=r[i_ref],
                    value=float(r[i_val]) if r[i_val] else None,
                    status=r[i_st] or None,
                    unit=unit,
                )
                rec = finish_record(rec)
                if rec is None:
                    dropped_f += 1
                else:
                    records.append(rec)
    meta.update(stem=stem, table_id=table_id, kind="full table", dropped_f=dropped_f)
    return meta, columns, records


def parse_statcan_file(path):
    """Detect the kind of file from its header and parse it."""
    if path.endswith(".zip"):
        return parse_full_table(path)
    with open(path, encoding="utf-8-sig", newline="") as fh:
        text = fh.read()
    if text.startswith('"REF_DATE"') or text.startswith("REF_DATE"):
        raise ValueError(f"{path}: unzipped full-table CSV; upload the ZIP instead")
    return parse_displayed(text, path)

# END OF PURE-PYTHON PARSERS (databricks/tests/check_statcan_local.py runs everything above this line)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Write Delta tables

# COMMAND ----------

from pyspark.sql.types import BooleanType, DoubleType, StringType, StructField, StructType


def spark_type(col):
    return DoubleType() if col == "value" else BooleanType() if col == "use_with_caution" else StringType()


def write_delta(meta, columns, records):
    name = f"{CATALOG}.{SCHEMA}.statcan_{meta['stem']}"
    schema = StructType([StructField(c, spark_type(c), True) for c in columns])
    rows = [tuple(r.get(c) for c in columns) for r in records]
    chunk = 50_000  # keep each Spark Connect message small
    df = spark.createDataFrame(rows[:chunk], schema)
    for start in range(chunk, len(rows), chunk):
        df = df.unionByName(spark.createDataFrame(rows[start : start + chunk], schema))
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(name)
    geos = ", ".join(sorted(KEEP_GEOS)) if meta["kind"] == "full table" else "as exported"
    comment = f"StatCan {meta['table_id']} ({meta['kind']}, geography: {geos}): {meta['title']}. Loaded by 01_statcan from {RAW_DIR}."
    spark.sql(f"COMMENT ON TABLE {name} IS '{comment.replace(chr(39), '')}'")
    return name


missing = [f for f in FULL_TABLE_FILES + DISPLAYED_FILES if not os.path.exists(os.path.join(RAW_DIR, f))]
if missing:
    raise FileNotFoundError(f"Upload these to {RAW_DIR} first: {missing}")

loaded = []
for f in FULL_TABLE_FILES + DISPLAYED_FILES:
    meta, columns, records = parse_statcan_file(os.path.join(RAW_DIR, f))
    name = write_delta(meta, columns, records)
    loaded.append((name, meta["table_id"], meta["kind"], len(records), meta["dropped_f"]))
    print(f"{name}: {len(records):,} rows ({meta['kind']}, {meta['dropped_f']} F-graded rows dropped)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Checks
# MAGIC Row counts, then the latest BC values for the products in `data/statcan_map.csv` and the CPI lines quoted in the pitch
# MAGIC (Sep 2026: apples 5.01, bananas 1.83, ground coffee 9.66, tea 4.51; BC food CPI 194.8).

# COMMAND ----------

display(spark.createDataFrame(loaded, "delta_table string, table_id string, kind string, row_count long, dropped_f long"))

# COMMAND ----------

display(spark.sql(f"""
  SELECT geo, products, ref_period, value, status, unit
  FROM {CATALOG}.{SCHEMA}.statcan_18100245
  WHERE geo IN ('British Columbia', 'Canada')
    AND products IN ('Apples, per kilogram', 'Bananas, per kilogram',
                     'Roasted or ground coffee, 340 grams', 'Tea (20 bags)')
    AND ref_period = (SELECT max(ref_period) FROM {CATALOG}.{SCHEMA}.statcan_18100245)
  ORDER BY products, geo
"""))

# COMMAND ----------

display(spark.sql(f"""
  SELECT geo, products_and_product_groups, ref_period, value, status, unit
  FROM {CATALOG}.{SCHEMA}.statcan_18100004
  WHERE ((geo = 'British Columbia' AND products_and_product_groups IN ('Food', 'Food purchased from restaurants'))
      OR (geo = 'Vancouver, British Columbia' AND products_and_product_groups = 'All-items'))
    AND ref_period IN ('2025-09', '2026-09')
  ORDER BY geo, products_and_product_groups, ref_period
"""))

# COMMAND ----------

import json

# Row counts back to whoever ran this (a CLI `jobs submit` run reads them with `jobs get-run-output`).
dbutils.notebook.exit(json.dumps({name: rows for name, _, _, rows, _ in loaded}))
