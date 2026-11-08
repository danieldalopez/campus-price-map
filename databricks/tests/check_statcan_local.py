"""Local check of the 01_statcan parsers on the real StatCan files, plain Python, no Spark.

    python3 -I databricks/tests/check_statcan_local.py ~/Downloads

Runs the pure-Python part of databricks/src/01_statcan.py (everything above its
"END OF PURE-PYTHON PARSERS" line), parses the 2 full-table ZIPs and the 9 "as displayed"
CSVs from the folder given, and checks the values quoted in docs/SPEC.md section 10.
Files are only read.
"""

import csv
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
NOTEBOOK = REPO / "databricks" / "src" / "01_statcan.py"
MAP_CSV = REPO / "data" / "statcan_map.csv"
SENTINEL = "# END OF PURE-PYTHON PARSERS"

source = NOTEBOOK.read_text()
assert SENTINEL in source, "sentinel line missing from the notebook"
nb = {"__name__": "statcan_notebook"}
exec(compile(source.split(SENTINEL)[0], str(NOTEBOOK), "exec"), nb)

raw = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "~/Downloads").expanduser()
failures = []


def check(label, got, want):
    ok = got == want
    print(f"  {'ok  ' if ok else 'FAIL'} {label}: {got!r}" + ("" if ok else f" (want {want!r})"))
    if not ok:
        failures.append(label)


def lookup(records, **where):
    hits = [r for r in records if all(r.get(k) == v for k, v in where.items())]
    if len(hits) != 1:
        return f"<{len(hits)} rows>"
    return hits[0]


# ---------------------------------------------------------------- unit checks
print("Value and label parsing")
check("26.7C", nb["parse_value"]("26.7C"), (26.7, "C"))
check("8,389,677A", nb["parse_value"]("8,389,677A"), (8389677.0, "A"))
check("..", nb["parse_value"](".."), (None, ".."))
check("..t", nb["parse_value"]("..t"), (None, "..t"))
check("F alone", nb["parse_value"]("F"), (None, "F"))
check("10,311", nb["parse_value"]("10,311"), (10311.0, None))
check("footnotes", nb["clean_label"]("Oranges, 1.36 kilograms 5 6"), "Oranges, 1.36 kilograms")
check("no footnote", nb["clean_label"]("Persons 18 to 24 years"), "Persons 18 to 24 years")
check("period month", nb["parse_period"]("September 2026"), "2026-09")
check("period year", nb["parse_period"]("2023"), "2023")
check("table id", nb["table_id_from_stem"]("18100245"), "18-10-0245-01")

print("F dropped, D and E flagged (synthetic as-displayed file)")
synthetic = "\n".join([
    '"Synthetic table 1 2"', '"Table: 99-10-0001-01"', '""', "",
    '"Geography","Canada",,', '"Thing","2023","2024","2025"', ',"Percent",,',
    '"Row A 3","1.0A","2.0F","3.0D"', '"Row B","..","4,000E","5.5"', "", "Footnotes:", '1,"note"',
])
meta, cols, recs = nb["parse_displayed"](synthetic, "9910000101-eng.csv")
check("rows kept", len(recs), 5)
check("F dropped", meta["dropped_f"], 1)
check("D caution", lookup(recs, thing="Row A", ref_period="2025")["use_with_caution"], True)
check("E caution", lookup(recs, thing="Row B", ref_period="2024")["use_with_caution"], True)
check("A not caution", lookup(recs, thing="Row A", ref_period="2023")["use_with_caution"], False)
check("E value", lookup(recs, thing="Row B", ref_period="2024")["value"], 4000.0)
check("columns", cols, ["table_id", "geo", "thing", "ref_period", "value", "status", "unit", "use_with_caution"])

# ---------------------------------------------------------------- full tables
print("\nFull tables (BC, Canada, Vancouver only)")
full = {}
for f in ["18100245-eng.zip", "18100004-eng.zip"]:
    meta, cols, recs = nb["parse_statcan_file"](str(raw / f))
    geos = sorted({r["geo"] for r in recs})
    print(f"  statcan_{meta['stem']}: {len(recs):,} rows, geos {geos}, columns {cols}, F dropped {meta['dropped_f']}")
    assert set(geos) <= nb["KEEP_GEOS"], geos
    full[meta["stem"]] = recs

prices = full["18100245"]
latest = max(r["ref_period"] for r in prices)
check("latest month in 18-10-0245", latest, "2026-09")
spec_prices = {  # product: (BC Sep 2026, Canada Sep 2026, BC Sep 2025), docs/SPEC.md section 10
    "Apples, per kilogram": (5.01, 4.79, 4.99),
    "Bananas, per kilogram": (1.83, 1.88, 1.63),
    "Roasted or ground coffee, 340 grams": (9.66, 9.27, 9.31),
    "Tea (20 bags)": (4.51, 4.46, 4.34),
}
for product, (bc, ca, bc_prev) in spec_prices.items():
    r = lookup(prices, geo="British Columbia", products=product, ref_period="2026-09")
    check(f"BC Sep 2026 {product}", (r["value"], r["status"]), (bc, None))
    check(f"Canada Sep 2026 {product}", lookup(prices, geo="Canada", products=product, ref_period="2026-09")["value"], ca)
    check(f"BC Sep 2025 {product}", lookup(prices, geo="British Columbia", products=product, ref_period="2025-09")["value"], bc_prev)
check("unit", lookup(prices, geo="British Columbia", products="Tea (20 bags)", ref_period="2026-09")["unit"], "Dollars")

cpi = full["18100004"]
for geo, item, period, want in [
    ("British Columbia", "Food", "2026-09", 194.8),
    ("British Columbia", "Food", "2025-09", 190.5),
    ("British Columbia", "Food purchased from restaurants", "2026-09", 191.6),
    ("British Columbia", "Food purchased from restaurants", "2025-09", 186.4),
    ("Vancouver, British Columbia", "All-items", "2026-09", 166.8),
    ("Vancouver, British Columbia", "All-items", "2025-09", 161.9),
]:
    r = lookup(cpi, geo=geo, products_and_product_groups=item, ref_period=period)
    check(f"CPI {geo} {item} {period}", r["value"], want)

print("\nItem mapping (data/statcan_map.csv) against BC Sep 2026")
want_cost = {"I20": 0.22, "I21": 0.90, "I08": 0.28, "I09": 0.43, "I11": 0.23}  # SPEC section 10
with open(MAP_CSV, newline="") as fh:
    rows = list(csv.DictReader(fh))
check("mapped items", sorted(r["item_id"] for r in rows), sorted(want_cost))
for m in rows:
    r = lookup(prices, geo="British Columbia", products=m["statcan_product"], ref_period=latest)
    cost = r["value"] * float(m["item_amount"]) / float(m["statcan_amount"])
    # round half up, as the app prints cents
    check(f"{m['item_id']} {m['kind']} per item", float(f"{cost + 1e-9:.2f}"), want_cost[m["item_id"]])

# ---------------------------------------------------------------- as displayed
print("\nAs displayed CSVs")
displayed = {}
for f in [
    "1810024501-eng.csv", "1810000401-eng.csv", "1310083401-eng.csv", "1310083501-eng.csv",
    "1110012501-eng.csv", "1110022201-eng.csv", "1110022301-eng.csv", "2110001901-eng.csv", "1410006401-eng.csv",
]:
    meta, cols, recs = nb["parse_statcan_file"](str(raw / f))
    print(f"  statcan_{meta['stem']} [{meta['table_id']}]: {len(recs):,} rows, columns {cols[2:-5]}, "
          f"periods {sorted({r['ref_period'] for r in recs})}, F dropped {meta['dropped_f']}")
    assert all(r["geo"] for r in recs), f"{f}: rows without geo"
    displayed[meta["stem"]] = recs

d = displayed
check("1810024501 Canada apples Sep 2026",
      lookup(d["1810024501"], geo="Canada", products="Apples, per kilogram", ref_period="2026-09")["value"], 4.79)
check("1810024501 footnote stripped", lookup(d["1810024501"], products="Oranges, 1.36 kilograms", ref_period="2026-05")["value"], 5.76)
check("1810000401 Canada food Sep 2026",
      lookup(d["1810000401"], products_and_product_groups="Food", ref_period="2026-09")["value"], 201.8)
r = lookup(d["2110001901"], geo="Canada", ref_period="2026-04")
check("2110001901 geo row dim, thousands, flag", (r["value"], r["status"], r["unit"]), (8389677.0, "A", "Dollars (x 1,000)"))
r = lookup(d["1310083501"], demographic_characteristics="Persons 18 to 24 years",
           household_food_security_status="Food insecure", ref_period="2024")
check("1310083501 18 to 24 food insecure 2024", (r["value"], r["status"]), (26.7, "C"))
r = lookup(d["1310083401"], economic_family_type="Persons in senior families",
           household_food_security_status="Food insecure, moderate or severe", ref_period="2024")
check("1310083401 multi-level header, grade D", (r["value"], r["status"], r["use_with_caution"]), (6.9, "D", True))
r = lookup(d["1110022201"], household_expenditures_summary_level_categories="Tobacco products and alcoholic beverages (Terminated)",
           ref_period="2023")
check("1110022201 ..t is null", (r["value"], r["status"]), (None, "..t"))
check("1110022301 quintile dim", lookup(d["1110022301"], household_expenditures_summary_level_categories="Food purchased from restaurants",
                                        ref_period="2023")["before_tax_household_income_quintile"], "All quintiles")
check("1110012501 restaurants 2023", lookup(d["1110012501"], food_expenditures_summary_level_categories="Food purchased from restaurants",
                                           ref_period="2023")["value"], 3316.0)
check("1410006401 food services wage 2025", lookup(d["1410006401"], north_american_industry_classification_system_naics="Accommodation and food services",
                                                  ref_period="2025")["value"], 20.98)

print()
if failures:
    print(f"{len(failures)} check(s) FAILED: {failures}")
    sys.exit(1)
print("All checks passed.")
