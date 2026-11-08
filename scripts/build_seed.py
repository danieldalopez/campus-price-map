#!/usr/bin/env python3
"""Build the seed data for Step 2 from the raw files in data/raw/. Standard library only.

    python3 -I scripts/build_seed.py

Reads   data/raw/campus_food_prices.csv   (vendor menus and prices, collected Nov 7, 2026)
        data/raw/barcode_lookup.csv       (Open Food Facts extract, ODbL)
Writes  data/items.csv data/outlets.csv data/prices.csv data/carries.csv
        data/menu_items.csv data/barcodes.csv data/build_report.md
        db/seed.sql                        (run after db/schema.sql, db/views.sql, db/roles.sql)

Rules (docs/SPEC.md section 6):
- Prices with a retrieved date are source `menu`. Undated prices are AI-estimated prototype data,
  source `seed`; the app treats them as official, but the source keeps them traceable.
- One price per tracked item and outlet: the lowest listed matching price.
- Vendors without coordinates get an approximate building or area location (`location_precision`).
"""

import csv
import math
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DATA = ROOT / "data"
LOAD_DATE = "2026-11-07"

# ---------------------------------------------------------------- items
ITEMS = [
    # id, name, size, volume_ml, category, aliases
    ("I01", "Red Bull", "250 ml can", 250, "Energy drinks", "redbull|red bull|rb|energy drink"),
    ("I02", "Monster Energy", "473 ml can", 473, "Energy drinks", "monster|monster energy"),
    ("I03", "Celsius", "355 ml can", 355, "Energy drinks", "celsius"),
    ("I04", "Coca-Cola", "355 ml can", 355, "Soft drinks", "coke|coca cola|cola|pop|soda|coke can"),
    ("I05", "Coca-Cola", "591 ml bottle", 591, "Soft drinks", "coke bottle|coca cola bottle|pop bottle"),
    ("I06", "Bottled water", "500 ml", 500, "Water", "water|bottled water|dasani|aquafina|ethos"),
    ("I07", "Sparkling water", "355 ml can", 355, "Water", "sparkling water|soda water|bubly|perrier"),
    ("I08", "Drip coffee", "small, 10 to 12 oz", 355, "Hot drinks", "coffee|drip|drip coffee|brewed coffee|regular coffee"),
    ("I09", "Drip coffee", "medium, 14 to 16 oz", 473, "Hot drinks", "medium coffee|large coffee"),
    ("I10", "Latte", "small, 10 to 12 oz", 355, "Hot drinks", "latte|caffe latte"),
    ("I11", "Tea", "small, 10 to 12 oz", 355, "Hot drinks", "tea|hot tea|steeped tea"),
    ("I12", "Iced coffee or cold brew", "12 oz", 355, "Cold coffee", "iced coffee|cold brew"),
    ("I13", "Bagel with cream cheese", "each", None, "Breakfast and bakery", "bagel"),
    ("I14", "Muffin", "each", None, "Breakfast and bakery", "muffin"),
    ("I15", "Pre-made sandwich", "each", None, "Lunch grab and go", "sandwich|sandwhich"),
    ("I16", "Pre-made wrap", "each", None, "Lunch grab and go", "wrap"),
    ("I17", "Sushi pack, California roll", "8 pieces", None, "Lunch grab and go", "sushi|california roll"),
    ("I18", "Quest Protein Bar", "60 g", None, "Snacks", "quest|protein bar"),
    ("I19", "Lay's Classic chips", "40 g", None, "Snacks", "chips|lays|lay's|crisps"),
    ("I20", "Banana", "each", None, "Fruit", "banana"),
    ("I21", "Apple", "each", None, "Fruit", "apple"),
    ("I22", "Red Bull", "355 ml can", 355, "Energy drinks", "red bull 355|big red bull"),
    ("I23", "Clif Bar", "68 g", None, "Snacks", "clif|clif bar|cliff bar|energy bar"),
]
ITEM_IDS = {i[0] for i in ITEMS}

# Fruit sold by weight is converted with the same weights as data/statcan_map.csv.
KG_PER_EACH = {"I20": 0.12, "I21": 0.18}
LB_PER_KG = 2.20462


def oz(variant):
    m = re.search(r"(\d+)\s*oz", variant, re.I)
    return int(m.group(1)) if m else None


def match_items(item, variant, category):
    """Return the tracked item ids a raw menu row counts as. Exact names first, then narrow rules."""
    n, v, c = item.strip().lower(), variant.strip().lower(), category.strip().lower()
    out = []
    if n in ("red bull energy drink",):
        if v == "250 ml":
            out.append("I01")
        elif v == "355 ml":
            out.append("I22")
    if n == "monster energy" and v == "473 ml":
        out.append("I02")
    if n == "celsius energy" and v == "355 ml":
        out.append("I03")
    if n == "coca-cola" and v == "355 ml can":
        out.append("I04")
    if n == "coca-cola" and v == "591 ml bottle":
        out.append("I05")
    if n in ("bottled water", "ethos bottled water") and v == "500 ml":
        out.append("I06")
    if n in ("drip coffee", "brewed coffee", "fresh brewed coffee", "original blend coffee"):
        size = oz(v)
        if size and 10 <= size <= 12:
            out.append("I08")
        elif size and 14 <= size <= 16:
            out.append("I09")
    if n in ("latte", "caffè latte", "caffe latte") and (oz(v) or 0) in (10, 11, 12):
        out.append("I10")
    if n in ("tea", "teavana hot tea", "steeped tea") and (oz(v) or 0) in (10, 11, 12):
        out.append("I11")
    if n in ("cold brew", "iced coffee") and oz(v) == 12:
        out.append("I12")
    if n in ("bagel with cream cheese", "plain bagel with cream cheese"):
        out.append("I13")
    if re.search(r"\bmuffin\b", n) and not re.search(r"loaf|english|mcmuffin|muffin top|sandwich|egg", n):
        out.append("I14")
    if c == "grab & go" and "sandwich" in n and "breakfast" not in n:
        out.append("I15")
    if c == "grab & go" and re.search(r"\bwrap\b", n) and "breakfast" not in n:
        out.append("I16")
    if (n == "sushi pack (california roll)" or n == "california roll") and "8" in v:
        out.append("I17")
    if n == "quest protein bar" and v == "60 g":
        out.append("I18")
    if n == "lay's classic chips" and v == "40 g":
        out.append("I19")
    if n in ("banana", "bananas", "fruit (apple / banana)"):
        out.append("I20")
    if n in ("apple", "apples", "gala apples", "fruit (apple / banana)"):
        out.append("I21")
    if n == "clif bar" and v == "68 g":
        out.append("I23")
    return out


def per_item_price(item_id, price, variant):
    """Convert per-lb fruit to a price for one fruit; everything else is already per item."""
    if item_id in KG_PER_EACH and "per lb" in variant.lower():
        return round(price * KG_PER_EACH[item_id] * LB_PER_KG, 2)
    if item_id in KG_PER_EACH and variant.lower() not in ("each", ""):
        return None
    return price


# ---------------------------------------------------------------- outlets
APPROX = {  # area or building → (lat, lng, precision); centroids from ubcv_buildings / food_outlets
    "AMS Nest": (49.266485, -123.249816, "building"),
    "Irving K. Barber Learning Centre": (49.267677, -123.252812, "building"),
    "CIRS Building": (49.262128, -123.252933, "building"),
    "David Lam Research Centre": (49.265869, -123.254446, "building"),
    "Fairview Crescent": (49.263336, -123.239668, "building"),
    "Dentistry Building, by the trolley bus loop": (49.265265, -123.245255, "building"),
    "University Blvd": (49.266200, -123.247000, "area"),
    "University Village": (49.266140, -123.242943, "area"),
    "Wesbrook Village": (49.254766, -123.236554, "area"),
}

CHAINS = (
    "starbucks", "tim hortons", "subway", "booster juice", "mcdonald", "a&w", "freshslice", "pita pit",
    "popeyes", "chipotle", "osmow", "triple o", "blenz", "freshii", "shoppers drug mart", "save-on-foods",
    "firehouse", "chatime", "share tea", "sharetea", "browns", "kinton", "bento sushi", "togo sushi",
    "body energy club", "biercraft", "big way", "ramen danbo", "nicli", "sports illustrated", "ins market",
)
AMS_VENDORS = ("blue chip", "honour roll", "grand noodle", "gallery patio", "the delly", "upmeals",
               "el cartel", "flavour lab", "soup market", "sprouts", "seoul hotdog", "kyros", "thirstyyy")
UBC_FS = ("harvest", "mercante", "hero coffee", "avenue c", "open kitchen", "feast", "gather", "magda",
          "corner store", "presto", "dabao", "law cafe", "stir it up", "pho real", "perugia", "hubbards",
          "the point grill", "sage bistro", "food hub market", "loafe", "great dane")


def outlet_type(vendor_type):
    t = vendor_type.lower()
    if "dining hall" in t:
        return "dining_hall"
    if any(k in t for k in ("supermarket", "low-cost grocery", "farmers market")) or t == "grocery":
        return "grocery"
    if any(k in t for k in ("convenience", "grab and go", "grocery")):
        return "convenience"
    if any(k in t for k in ("restaurant", "pub", "bar")):
        return "restaurant"
    if any(k in t for k in ("quick service", "fast food", "pizza")):
        return "quick_service"
    return "cafe"  # coffee, cafe, bubble tea, smoothies, bakery, ice cream


# Franchise outlets run by UBC Food Services, as listed on food.ubc.ca (the data sheet's Outlets tab, L05 to L15).
# They price like other UBC Food Services outlets, so they're not grouped with the independently run chains.
UBC_FS_FRANCHISES = {
    "Tim Hortons (Orca House)", "Starbucks (Life Building)", "Subway (Life Building)",
    "Pacific Poke (Life Building)", "Starbucks (Bookstore)", "Triple O's", "Tim Hortons (David Lam)",
    "Tim Hortons (Forest Sciences)", "Starbucks (Fred Kaiser)",
}


def operator(vendor):
    if vendor.strip() in UBC_FS_FRANCHISES:
        return "ubc_food_services"
    v = vendor.lower()
    if any(k in v for k in CHAINS):
        return "chain"
    if any(k in v for k in AMS_VENDORS):
        return "ams"
    if any(k in v for k in UBC_FS):
        return "ubc_food_services"
    return "independent"


def slug(text):
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")


# ---------------------------------------------------------------- barcodes
def gtin_ok(code):
    if not code.isdigit() or len(code) not in (8, 12, 13, 14):
        return False
    digits = [int(d) for d in code]
    body, check = digits[:-1], digits[-1]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def barcode_item(price_item, variant, off_size):
    p, v, s = price_item.lower(), variant.lower(), off_size.lower()
    if "pack" in p or " x " in v:
        return None
    if p.startswith("red bull"):
        return {"250 ml": "I01", "355 ml": "I22"}.get(v)
    if p.startswith("monster"):
        return "I02"
    if p.startswith("celsius"):
        return "I03"
    if p == "coca-cola" and "355" in v:
        return "I04"
    if p == "bottled water" or (p == "dasani water" and "500" in s):
        return "I06"  # the Dasani barcode is the 500 ml bottle, not 591 ml
    if p.startswith("lay's"):
        return "I19"
    if p.startswith("clif"):
        return "I23"
    if p.startswith("quest"):
        return "I18"
    return None


# ---------------------------------------------------------------- build
def main():
    rows = list(csv.DictReader(open(RAW / "campus_food_prices.csv", encoding="utf-8-sig")))
    stores = [r for r in rows if r["record_type"] == "store"]
    lines = [r for r in rows if r["record_type"] == "item"]
    report = []

    # outlets
    outlets, by_vendor, skipped = [], {}, []
    used = set()
    for s in stores:
        if s["latitude"].strip():
            lat, lng, prec = float(s["latitude"]), float(s["longitude"]), "exact"
        else:
            key = s["campus_location"] if s["campus_location"] in APPROX else s["area"]
            if key not in APPROX:
                skipped.append(s["vendor"])
                continue
            lat, lng, prec = APPROX[key]
        base = oid = slug(s["vendor"])
        n = 2
        while oid in used:
            oid, n = f"{base}-{n}", n + 1
        used.add(oid)
        by_vendor[s["vendor"]] = oid
        outlets.append({
            "id": oid, "name": s["vendor"].strip(), "area": s["area"].strip(),
            "operator": operator(s["vendor"]), "type": outlet_type(s["vendor_type"]),
            "address": s["address"].strip(), "hours": s["hours_listed"].strip(),
            "lat": f"{lat:.6f}", "lng": f"{lng:.6f}",
            "is_benchmark": "true" if s["vendor"].startswith("Save-On-Foods") else "false",
            "poi_id": s["map_poi_id"].strip(), "location_precision": prec,
            "vendor_type": s["vendor_type"].strip(),
        })
    # spread pins that share an approximate point so they don't sit exactly on top of each other
    groups = defaultdict(list)
    for o in outlets:
        if o["location_precision"] != "exact":
            groups[(o["lat"], o["lng"])].append(o)
    for pts in groups.values():
        for k, o in enumerate(pts):
            ring, pos = divmod(k, 6)
            if k:
                ang = pos * math.pi / 3
                r = 0.00012 * (ring + 1)  # about 13 m per ring
                o["lat"] = f"{float(o['lat']) + r * math.sin(ang):.6f}"
                o["lng"] = f"{float(o['lng']) + r * 1.5 * math.cos(ang):.6f}"

    # menu items, tracked prices, carries
    menu, best = [], {}
    unmatched_names = Counter()
    for r in lines:
        vendor = r["vendor"]
        if vendor not in by_vendor or not r["price_cad"].strip():
            continue
        price = float(r["price_cad"])
        source = "menu" if r["retrieved_date"].strip() else "seed"
        date = r["retrieved_date"].strip() or LOAD_DATE
        ids = match_items(r["item"], r["variant_or_size"], r["category"])
        menu.append({
            "location_id": by_vendor[vendor], "category": r["category"].strip(), "item": r["item"].strip(),
            "variant": r["variant_or_size"].strip(), "price": f"{price:.2f}", "source": source,
            "reported_on": date, "item_ids": "|".join(ids),
        })
        for iid in ids:
            p = per_item_price(iid, price, r["variant_or_size"])
            if p is None or not (0.25 <= p <= 25):
                continue
            key = (iid, by_vendor[vendor])
            if key not in best or p < float(best[key]["price"]):
                best[key] = {"item_id": iid, "location_id": key[1], "price": f"{p:.2f}", "source": source,
                             "reported_on": date, "raw_item": r["item"].strip(),
                             "raw_variant": r["variant_or_size"].strip()}
        if not ids and re.search(r"red bull|monster|coke|coca|water|coffee|latte|bagel|muffin", r["item"], re.I):
            unmatched_names[(r["item"].strip(), r["variant_or_size"].strip())] += 1
    prices = sorted(best.values(), key=lambda x: (x["item_id"], x["location_id"]))
    carries = sorted({(p["item_id"], p["location_id"]) for p in prices})

    # barcodes
    bars, dropped = [], Counter()
    for b in csv.DictReader(open(RAW / "barcode_lookup.csv", encoding="utf-8-sig")):
        code = b["barcode"].strip()
        if not gtin_ok(code):
            dropped["invalid check digit"] += 1
            continue
        iid = barcode_item(b["price_item"], b["price_variant_or_size"], b["off_size"])
        if iid is None and ("pack" in b["price_item"].lower()):
            dropped["multipack"] += 1
            continue
        mt = b["match_type"].strip()
        bars.append({
            "barcode": code, "product_name": b["off_product_name"].strip(), "brand": b["brand"].strip(),
            "quantity": b["off_size"].strip(), "item_id": iid or "",
            "mapped_by": ("not_tracked" if iid is None else
                          "brand_size_unverified" if mt == "size unverified" else
                          "flavour_variant" if mt == "flavour variant" else "exact"),
        })

    # write CSVs
    def write(name, fields, data):
        with open(DATA / name, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(data)

    write("items.csv", ["id", "name", "size", "volume_ml", "category", "image", "aliases"],
          [{"id": i, "name": n, "size": s, "volume_ml": v or "", "category": c, "image": f"/items/{i}.webp",
            "aliases": a} for i, n, s, v, c, a in ITEMS])
    write("outlets.csv", list(outlets[0].keys()), outlets)
    write("prices.csv", ["item_id", "location_id", "price", "source", "reported_on", "raw_item", "raw_variant"], prices)
    write("carries.csv", ["item_id", "location_id"], [{"item_id": a, "location_id": b} for a, b in carries])
    write("menu_items.csv", list(menu[0].keys()), menu)
    write("barcodes.csv", ["barcode", "product_name", "brand", "quantity", "item_id", "mapped_by"], bars)

    # seed.sql
    q = lambda v: "null" if v in ("", None) else "'" + str(v).replace("'", "''") + "'"
    out = ["-- Generated by scripts/build_seed.py. Do not edit by hand; rerun the script.",
           "-- Run after db/schema.sql and db/views.sql, as the owner role.", "begin;", ""]
    out.append("insert into locations (id, name, area, operator, type, address, hours, lat, lng, is_benchmark, poi_id, location_precision) values")
    out.append(",\n".join(
        f"  ({q(o['id'])}, {q(o['name'])}, {q(o['area'])}, {q(o['operator'])}, {q(o['type'])}, {q(o['address'])}, "
        f"{q(o['hours'])}, {o['lat']}, {o['lng']}, {o['is_benchmark']}, {q(o['poi_id'])}, {q(o['location_precision'])})"
        for o in outlets) + ";\n")
    out.append("insert into items (id, name, size, volume_ml, category, image, aliases) values")
    out.append(",\n".join(
        f"  ({q(i)}, {q(n)}, {q(s)}, {v if v else 'null'}, {q(c)}, {q('/items/' + i + '.webp')}, {q(a)})"
        for i, n, s, v, c, a in ITEMS) + ";\n")
    out.append("insert into prices (item_id, location_id, price, source, reported_at) values")
    out.append(",\n".join(
        f"  ({q(p['item_id'])}, {q(p['location_id'])}, {p['price']}, {q(p['source'])}, {q(p['reported_on'] + ' 12:00:00-08')})"
        for p in prices) + ";\n")
    out.append("insert into carries (item_id, location_id) values")
    out.append(",\n".join(f"  ({q(a)}, {q(b)})" for a, b in carries) + ";\n")
    out.append("insert into menu_items (location_id, category, item, variant, price, source, reported_on, item_ids) values")
    out.append(",\n".join(
        f"  ({q(m['location_id'])}, {q(m['category'])}, {q(m['item'])}, {q(m['variant'])}, {m['price']}, "
        f"{q(m['source'])}, {q(m['reported_on'])}, '{m['item_ids']}')" for m in menu) + ";\n")
    out.append("insert into app_config (key, value, source) values")
    out.append(",\n".join([
        "  ('bc_min_wage', '17.85', 'BC general minimum wage from June 1, 2025. Check gov.bc.ca for the June 2026 rate and update.')",
        "  ('weeks_term', '13', 'UBC term: 13 teaching weeks')",
        "  ('weeks_year', '26', 'two terms')",
        "  ('weeks_degree', '104', 'four years of two terms')",
        "  ('even_band', '0.10', 'Worth the walk: within this many dollars counts as about even')",
        "  ('round_trip', 'true', 'extra walking counts there and back')",
        "  ('worth_max_extra_min', '20', 'cheaper outlets more than this many extra minutes away are not suggested')",
    ]) + ";\n")
    out.append("commit;")
    (ROOT / "db").mkdir(exist_ok=True)
    (ROOT / "db" / "seed.sql").write_text("\n".join(out) + "\n", encoding="utf-8")

    # report
    per_item = Counter(p["item_id"] for p in prices)
    per_item_menu = Counter(p["item_id"] for p in prices if p["source"] == "menu")
    report += [
        "# Seed build report", "",
        f"Generated by `scripts/build_seed.py` from `data/raw/` ({LOAD_DATE}).", "",
        f"- Outlets: {len(outlets)} ({sum(o['location_precision'] == 'exact' for o in outlets)} exact, "
        f"{sum(o['location_precision'] == 'building' for o in outlets)} building centroid, "
        f"{sum(o['location_precision'] == 'area' for o in outlets)} area centroid). "
        f"Grocery baseline: {', '.join(o['name'] for o in outlets if o['is_benchmark'] == 'true')}.",
        f"- Skipped outlets (no location at all): {', '.join(skipped) or 'none'}.",
        f"- Menu rows kept: {len(menu)} ({sum(m['source'] == 'menu' for m in menu)} dated menu prices, "
        f"{sum(m['source'] == 'seed' for m in menu)} undated AI-estimated prototype prices, source `seed`).",
        f"- Tracked prices (one per item and outlet, lowest listed): {len(prices)} "
        f"({sum(p['source'] == 'menu' for p in prices)} menu, {sum(p['source'] == 'seed' for p in prices)} seed).",
        f"- Barcodes kept: {len(bars)} ({sum(b['item_id'] != '' for b in bars)} mapped to an item). "
        f"Dropped: {dict(dropped) or 'none'}.", "",
        "| Item | Outlets with a price | of which dated menu prices |", "|---|---|---|",
    ]
    for i, n, s, *_ in ITEMS:
        report.append(f"| {i} {n}, {s} | {per_item[i]} | {per_item_menu[i]} |")
    if unmatched_names:
        report += ["", "Rows that look like tracked items but didn't match a rule (check these):", ""]
        report += [f"- {n} | {v} ({k})" for (n, v), k in unmatched_names.most_common(25)]
    (DATA / "build_report.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    main()
