"""Local check of 03_price_model.py's pure part on the repo's data/*.csv (no Spark, no database).

    python3 databricks/tests/check_price_model_local.py      (needs numpy)

Runs the self-test on simulated data, then fits the real prices and prints the gate, tiers and timing.
"""

import csv
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
src = (ROOT / "databricks/src/03_price_model.py").read_text()
start = src.index("import math")
end = src.index("# END OF PURE PART")
ns = {}
exec(compile(src[start:end], "03_price_model.py", "exec"), ns)

ok = True


def check(name, cond, detail=""):
    global ok
    ok &= bool(cond)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{': ' + str(detail) if detail else ''}")


spearman = ns["self_test"]()
check("self-test recovers outlet order (Spearman >= 0.7)", spearman >= 0.7, round(spearman, 2))

prices = [(r["item_id"], r["location_id"], float(r["price"])) for r in csv.DictReader(open(ROOT / "data/prices.csv"))]
locations = {r["id"]: {"type": r["type"], "operator": r["operator"], "is_benchmark": r["is_benchmark"] == "true"}
             for r in csv.DictReader(open(ROOT / "data/outlets.csv"))}
items = {r["id"]: r["category"] for r in csv.DictReader(open(ROOT / "data/items.csv"))}

t0 = time.time()
m = ns["fit"](prices, locations, items)
loo = ns["leave_one_out"](m, prices)
n_obs = {}
for _, o, _ in prices:
    n_obs[o] = n_obs.get(o, 0) + 1
scores = ns["outlet_scores"](m, locations, n_obs, {})
elapsed = time.time() - t0

print(f"\n{len(prices)} prices, {len(locations)} outlets, {m['method']} {m['hyper']}, {elapsed:.1f} s")
print(f"LOO MAE: model ${loo['model_mae']:.3f} vs item median ${loo['baseline_mae']:.3f} ({loo['n_compared']} compared)")
print(f"80% coverage raw {loo['raw_coverage_80']:.2f}, scale x{loo['interval_scale']:.2f} -> {loo['coverage_80']:.2f}")
tiers = {}
for s in scores:
    key = f"{s['tier'] or '?'} {s['tier_basis'] or ''}".strip()
    tiers[key] = tiers.get(key, 0) + 1
print("tiers:", tiers)
by_id = {s["location_id"]: s for s in scores}
for o in ("save-on-foods-wesbrook-village", "grocery-checkout", "starbucks-life-building", "blue-chip-cafe", "popeyes"):
    if o in by_id:
        s = by_id[o]
        print(f"  {o}: {s['score_pct']:+.1f}% [{s['ci_low']:+.1f}, {s['ci_high']:+.1f}] n={s['n_obs']} "
              f"tier={s['tier']} {s['tier_basis']}")

check("gate: model beats the item median", loo["model_mae"] < loo["baseline_mae"])
check("calibrated coverage near 80%", 0.75 <= loo["coverage_80"] <= 0.85, round(loo["coverage_80"], 2))
check("benchmark never gets a tier", all(by_id[o]["tier"] is None for o in locations if locations[o]["is_benchmark"]))
check("no tier without prices", all(s["tier"] is None for s in scores if s["n_obs"] == 0))
check("tiers are $ / $$ / $$$ or none", all(s["tier"] in (None, "$", "$$", "$$$") for s in scores))
check("fits in under 60 s locally", elapsed < 60, f"{elapsed:.1f} s")

# Estimates: the repo's carries all have a price, so hold out 60 real prices (plus every benchmark price), refit
# without them, and estimate them back as if they were carried but unpriced.
import random

rng = random.Random(11)
bench = {o for o in locations if locations[o]["is_benchmark"]}
campus_rows = [r for r in prices if r[1] not in bench]
held = rng.sample(campus_rows, 60) + [r for r in prices if r[1] in bench][:5]
held_keys = {(i, o) for i, o, _ in held}
train = [r for r in prices if (r[0], r[1]) not in held_keys]
m2 = ns["fit"](train, locations, items)
loo2 = ns["leave_one_out"](m2, train)
n_item2, n_obs2 = {}, {}
for i, o, _ in train:
    n_item2[i] = n_item2.get(i, 0) + 1
    n_obs2[o] = n_obs2.get(o, 0) + 1
est = ns["estimates"](m2, sorted(held_keys), loo2["interval_scale"], n_item2, n_obs2, locations)
truth = {(i, o): p for i, o, p in held}
inside = [e["est_low"] <= truth[(e["item_id"], e["location_id"])] <= e["est_high"] for e in est]
err = sum(abs(e["est_price"] - truth[(e["item_id"], e["location_id"])]) for e in est) / max(len(est), 1)
print(f"\nheld-out estimates: {len(est)} of {len(held_keys)}, MAE ${err:.3f}, "
      f"80% interval covers {sum(inside) / max(len(inside), 1):.2f}")
check("estimates written for held-out pairs", len(est) >= 40, len(est))
check("no estimates for the benchmark", all(e["location_id"] not in bench for e in est))
check("est_low <= est_price <= est_high", all(e["est_low"] <= e["est_price"] <= e["est_high"] for e in est))
check("every estimate has est_support >= 3", all(e["est_support"] >= 3 for e in est))
check("held-out 80% coverage in [0.65, 0.95]", 0.65 <= sum(inside) / max(len(inside), 1) <= 0.95,
      round(sum(inside) / max(len(inside), 1), 2))
print("\nall checks passed" if ok else "\nSOME CHECKS FAILED")
sys.exit(0 if ok else 1)
