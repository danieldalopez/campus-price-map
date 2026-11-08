# Databricks notebook source
# MAGIC %md
# MAGIC # 03_price_model: outlet tiers from sparse prices (D5)
# MAGIC
# MAGIC docs/SPEC.md section 10, "Price model". A Bayesian hierarchical model of log price with partial pooling:
# MAGIC
# MAGIC     log price(i, o) = α[item] + θ_type[type(o)] + θ_op[operator(o)] + β[o] + γ[o, category(i)] + ε
# MAGIC
# MAGIC Gaussian priors and noise, so the posterior is closed form (NumPy only, no sampling). An outlet with few prices
# MAGIC is pulled toward outlets of the same type and operator, and its uncertainty says so.
# MAGIC
# MAGIC Reads `gold_official_prices` (one official price per item and outlet), `bronze_locations`, `bronze_items`,
# MAGIC `bronze_carries`. Writes `gold_outlet_scores` (synced to Lakebase as `serving.outlet_scores`),
# MAGIC `model_price_estimates` (read by the next price_engine run) and `gold_model_metrics`.

# COMMAND ----------

dbutils.widgets.text("catalog", "workspace")
dbutils.widgets.text("schema", "cpm")
CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")

# COMMAND ----------

import math

import numpy as np

# Priors (section 10). Used as-is under MIN_EB_PRICES official prices; above it, τ_o, τ_c and σ come from the
# marginal likelihood over a small grid, with floors so nothing collapses to the average.
PRIOR_ITEM_SD = 1.0
PRIOR_THETA_SD = 0.15
FIXED = {"tau_o": 0.12, "tau_c": 0.08, "sigma": 0.06}
MIN_EB_PRICES = 60
GRID = {
    "tau_o": [0.04, 0.06, 0.08, 0.12, 0.16, 0.24],
    "tau_c": [0.04, 0.06, 0.08, 0.12],
    "sigma": [0.03, 0.05, 0.08, 0.12, 0.18],
}
BAND = math.log(1.05)            # ±5% around the campus average
TIER_PROB = 0.6                  # a band needs at least this probability to set the tier
MEASURED_PROB, MEASURED_N = 0.8, 4
Z80, Z90 = 1.2815516, 1.6448536


def norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def design(obs, items, outlets, cats, types, ops, item_cat, out_type, out_op):
    """obs: list of (item_id, location_id). Column blocks: item | type | operator | outlet | outlet x category."""
    ii = {v: k for k, v in enumerate(items)}
    oi = {v: k for k, v in enumerate(outlets)}
    ci = {v: k for k, v in enumerate(cats)}
    ti = {v: k for k, v in enumerate(types)}
    pi = {v: k for k, v in enumerate(ops)}
    nI, nT, nP, nO, nC = len(items), len(types), len(ops), len(outlets), len(cats)
    off = {"item": 0, "type": nI, "op": nI + nT, "out": nI + nT + nP, "oc": nI + nT + nP + nO}
    width = off["oc"] + nO * nC
    X = np.zeros((len(obs), width))
    for r, (i, o) in enumerate(obs):
        X[r, off["item"] + ii[i]] = 1
        X[r, off["type"] + ti[out_type[o]]] = 1
        X[r, off["op"] + pi[out_op[o]]] = 1
        X[r, off["out"] + oi[o]] = 1
        X[r, off["oc"] + oi[o] * nC + ci[item_cat[i]]] = 1
    return X, off, (nI, nT, nP, nO, nC)


def prior(sizes, off, item_mean, tau_o, tau_c):
    nI, nT, nP, nO, nC = sizes
    sd = np.concatenate([
        np.full(nI, PRIOR_ITEM_SD), np.full(nT + nP, PRIOR_THETA_SD), np.full(nO, tau_o), np.full(nO * nC, tau_c)])
    m0 = np.zeros(len(sd))
    m0[off["item"]:off["item"] + nI] = item_mean
    return m0, sd


def posterior(X, y, m0, sd, sigma):
    L = np.diag(1.0 / sd**2)
    A = X.T @ X / sigma**2 + L
    V = np.linalg.inv(A)
    b = V @ (X.T @ y / sigma**2 + L @ m0)
    return b, V


def log_marginal(X, y, m0, sd, sigma):
    C = (X * sd**2) @ X.T + sigma**2 * np.eye(len(y))
    r = y - X @ m0
    Lc = np.linalg.cholesky(C)                      # C is symmetric positive definite (σ² > 0)
    alpha = np.linalg.solve(Lc, r)
    logdet = 2.0 * float(np.sum(np.log(np.diag(Lc))))
    return -0.5 * (logdet + float(alpha @ alpha) + len(y) * math.log(2 * math.pi))


def fit(rows, locations, items_meta):
    """rows: [(item_id, location_id, price)]. locations: {id: {type, operator, is_benchmark}}. items_meta: {id: category}."""
    obs = [(i, o) for i, o, _ in rows]
    y = np.log(np.array([p for _, _, p in rows], dtype=float))
    items = sorted({i for i, _ in obs})
    outlets = sorted(locations)
    cats = sorted({items_meta[i] for i in items})
    types = sorted({locations[o]["type"] for o in outlets})
    ops = sorted({locations[o]["operator"] for o in outlets})
    out_type = {o: locations[o]["type"] for o in outlets}
    out_op = {o: locations[o]["operator"] for o in outlets}
    X, off, sizes = design(obs, items, outlets, cats, types, ops, items_meta, out_type, out_op)

    # Weak item prior: centred on the category's mean log price.
    cat_mean = {c: float(np.mean([y[k] for k, (i, _) in enumerate(obs) if items_meta[i] == c])) for c in cats}
    item_mean = np.array([cat_mean[items_meta[i]] for i in items])

    if len(y) >= MIN_EB_PRICES:
        best = None
        for to in GRID["tau_o"]:
            for tc in GRID["tau_c"]:
                for s in GRID["sigma"]:
                    m0, sd = prior(sizes, off, item_mean, to, tc)
                    ll = log_marginal(X, y, m0, sd, s)
                    if best is None or ll > best[0]:
                        best = (ll, {"tau_o": to, "tau_c": tc, "sigma": s})
        hyper, method = best[1], "empirical_bayes"
    else:
        hyper, method = dict(FIXED), "fixed_priors"

    m0, sd = prior(sizes, off, item_mean, hyper["tau_o"], hyper["tau_c"])
    b, V = posterior(X, y, m0, sd, hyper["sigma"])
    return {"X": X, "y": y, "obs": obs, "b": b, "V": V, "m0": m0, "sd": sd, "hyper": hyper, "method": method,
            "off": off, "sizes": sizes, "items": items, "outlets": outlets, "cats": cats, "types": types, "ops": ops,
            "out_type": out_type, "out_op": out_op, "item_cat": items_meta}


def outlet_level_vector(m, o):
    """Coefficient vector picking an outlet's overall level: θ_type + θ_op + β."""
    off, sizes = m["off"], m["sizes"]
    v = np.zeros(m["X"].shape[1])
    v[off["type"] + m["types"].index(m["out_type"][o])] = 1
    v[off["op"] + m["ops"].index(m["out_op"][o])] = 1
    v[off["out"] + m["outlets"].index(o)] = 1
    return v


def outlet_scores(m, locations, n_obs, n_cheapest):
    """% vs the campus average, 90% interval, band probabilities, tier.

    The campus average is over non-benchmark outlets with at least one official price, the same outlets the app's
    campus median uses. Unpriced outlets only carry their type and operator prior, so averaging them in would tilt
    the zero point toward whichever types have the most unpriced outlets."""
    campus = [o for o in m["outlets"] if not locations[o]["is_benchmark"] and n_obs.get(o, 0) > 0]
    if not campus:
        campus = [o for o in m["outlets"] if not locations[o]["is_benchmark"]]
    avg = np.mean([outlet_level_vector(m, o) for o in campus], axis=0)
    out = []
    for o in m["outlets"]:
        c = outlet_level_vector(m, o) - avg
        mean = float(c @ m["b"])
        sd = float(math.sqrt(max(c @ m["V"] @ c, 1e-12)))
        p_cheap = norm_cdf((-BAND - mean) / sd)
        p_pricey = 1.0 - norm_cdf((BAND - mean) / sd)
        p_avg = max(0.0, 1.0 - p_cheap - p_pricey)
        n = n_obs.get(o, 0)
        tier, basis = None, None
        if n > 0 and not locations[o]["is_benchmark"]:
            band, prob = max((("$", p_cheap), ("$$", p_avg), ("$$$", p_pricey)), key=lambda t: t[1])
            if prob >= TIER_PROB:
                tier = band
                basis = "measured" if n >= MEASURED_N and prob >= MEASURED_PROB else "estimated"
        out.append({
            "location_id": o,
            "score_pct": round((math.exp(mean) - 1) * 100, 1),
            "ci_low": round((math.exp(mean - Z90 * sd) - 1) * 100, 1),
            "ci_high": round((math.exp(mean + Z90 * sd) - 1) * 100, 1),
            "p_cheaper": round(p_cheap, 3), "p_average": round(p_avg, 3), "p_pricier": round(p_pricey, 3),
            "n_obs": int(n), "tier": tier, "tier_basis": basis,
            "n_items_cheapest": int(n_cheapest.get(o, 0)),
        })
    return out


def leave_one_out(m, rows):
    """Closed-form LOO residuals for the posterior mean, plus the item-median baseline, in dollars."""
    X, y, V, sigma = m["X"], m["y"], m["V"], m["hyper"]["sigma"]
    pred = X @ m["b"]
    q = np.einsum("ij,jk,ik->i", X, V, X)                      # posterior variance of each fitted value
    one_minus_h = np.clip(1 - q / sigma**2, 1e-6, None)        # 1 - leverage
    loo_pred = y - (y - pred) / one_minus_h
    # Predictive sd with observation k left out (Sherman-Morrison: xᵀV₋ₖx = q / (1 - h)). Using the full-data V here
    # would understate it and push the calibration scale up.
    pred_sd = np.sqrt(q / one_minus_h + sigma**2)
    prices = np.exp(y)
    model_err = np.abs(np.exp(loo_pred) - prices)
    base_err = []
    for k, (i, o, _) in enumerate(rows):
        others = [p for j, (i2, o2, p) in enumerate(rows) if i2 == i and j != k]
        base_err.append(abs(float(np.median(others)) - prices[k]) if others else np.nan)
    base_err = np.array(base_err)
    ok = ~np.isnan(base_err)
    z = np.abs(y - loo_pred) / pred_sd
    scale = float(np.clip(np.quantile(z, 0.8) / Z80, 0.7, 2.0))
    coverage = float(np.mean(z <= Z80 * scale))
    return {
        "model_mae": float(np.mean(model_err[ok])), "baseline_mae": float(np.mean(base_err[ok])),
        "n_compared": int(ok.sum()), "interval_scale": scale, "coverage_80": coverage,
        "raw_coverage_80": float(np.mean(z <= Z80)),
    }


def estimates(m, carried_unpriced, scale, n_item, n_outlet, locations):
    """Calibrated 80% interval for carried pairs with no official price; only with est_support >= 3.

    Never for the grocery benchmark: its row is the measured baseline the app compares against, not a guess."""
    out = []
    sigma = m["hyper"]["sigma"]
    for i, o in carried_unpriced:
        if i not in m["items"] or o not in m["outlets"] or locations[o]["is_benchmark"]:
            continue
        support = n_item.get(i, 0) + n_outlet.get(o, 0)
        if support < 3:
            continue
        x, _, _ = design([(i, o)], m["items"], m["outlets"], m["cats"], m["types"], m["ops"],
                         m["item_cat"], m["out_type"], m["out_op"])
        x = x[0]
        mean = float(x @ m["b"])
        sd = float(math.sqrt(x @ m["V"] @ x + sigma**2)) * scale
        out.append({"item_id": i, "location_id": o, "est_price": round(math.exp(mean), 2),
                    "est_low": round(math.exp(mean - Z80 * sd), 2), "est_high": round(math.exp(mean + Z80 * sd), 2),
                    "est_support": int(support)})
    return out


def self_test(seed=7):
    """Fit simulated sparse data with known outlet effects; the recovered order must match (Spearman >= 0.7)."""
    rng = np.random.default_rng(seed)
    items = [f"S{k:02d}" for k in range(21)]
    cats = {it: f"c{k % 7}" for k, it in enumerate(items)}
    outlets = [f"o{k:02d}" for k in range(20)]
    types = {o: ["cafe", "convenience", "quick_service"][k % 3] for k, o in enumerate(outlets)}
    effect = {o: rng.normal(0, 0.10) for o in outlets}
    alpha = {it: math.log(rng.uniform(1.5, 9)) for it in items}
    pairs = [(i, o) for i in items for o in outlets]
    pick = rng.choice(len(pairs), 150, replace=False)
    rows = [(pairs[k][0], pairs[k][1], math.exp(alpha[pairs[k][0]] + effect[pairs[k][1]] + rng.normal(0, 0.04)))
            for k in pick]
    locs = {o: {"type": types[o], "operator": "independent", "is_benchmark": False} for o in outlets}
    m = fit(rows, locs, cats)
    n_obs = {}
    for _, o, _ in rows:
        n_obs[o] = n_obs.get(o, 0) + 1
    est = {r["location_id"]: r["score_pct"] for r in outlet_scores(m, locs, n_obs, {})}
    a = np.argsort(np.argsort([effect[o] for o in outlets]))
    b = np.argsort(np.argsort([est[o] for o in outlets]))
    spearman = float(np.corrcoef(a, b)[0, 1])
    return spearman

# END OF PURE PART (databricks/tests/check_price_model_local.py runs everything above this line)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Self-test, then the real data

# COMMAND ----------

import datetime

spearman = self_test()
print(f"Self-test on simulated data: Spearman {spearman:.2f} (needs >= 0.7)")
assert spearman >= 0.7, "Self-test failed: the model doesn't recover known outlet effects"

T = lambda name: f"{CATALOG}.{SCHEMA}.{name}"
prices = [(r.item_id, r.location_id, float(r.price))
          for r in spark.table(T("gold_official_prices")).select("item_id", "location_id", "price").collect()]
locations = {r.id: {"type": r.type, "operator": r.operator, "is_benchmark": bool(r.is_benchmark)}
             for r in spark.table(T("bronze_locations")).select("id", "type", "operator", "is_benchmark").collect()}
items_meta = {r.id: r.category for r in spark.table(T("bronze_items")).select("id", "category").collect()}
carries = {(r.item_id, r.location_id) for r in spark.table(T("bronze_carries")).select("item_id", "location_id").collect()}
cheapest = spark.sql(f"""SELECT location_id, count(*) AS n FROM {T('gold_price_comparisons')}
                         WHERE `rank` = 1 AND NOT is_benchmark GROUP BY location_id""").collect()
n_cheapest = {r.location_id: r.n for r in cheapest}

prices = [p for p in prices if p[1] in locations and p[0] in items_meta]
started = datetime.datetime.now(datetime.timezone.utc)
n_obs, n_item = {}, {}
for i, o, _ in prices:
    n_obs[o] = n_obs.get(o, 0) + 1
    n_item[i] = n_item.get(i, 0) + 1

# Too little data to fit or to validate (e.g. a freshly reset database): write empty outputs so the app shows
# no tiers and no estimates instead of the job failing and leaving stale ones in place.
MIN_FIT_PRICES = 10
if len(prices) >= MIN_FIT_PRICES:
    m = fit(prices, locations, items_meta)
    loo = leave_one_out(m, prices)
    gate = loo["n_compared"] > 0 and loo["model_mae"] < loo["baseline_mae"]
    scores = outlet_scores(m, locations, n_obs, n_cheapest)
    if not gate:  # the gate failed: keep only measured tiers (section 10)
        for s in scores:
            if s["tier_basis"] == "estimated":
                s["tier"], s["tier_basis"] = None, None
    priced = {(i, o) for i, o, _ in prices}
    est = estimates(m, sorted(carries - priced), loo["interval_scale"], n_item, n_obs, locations) if gate else []
else:
    nan = float("nan")
    m = {"method": "not_fitted", "hyper": {"tau_o": nan, "tau_c": nan, "sigma": nan}}
    loo = {"model_mae": nan, "baseline_mae": nan, "n_compared": 0, "interval_scale": nan,
           "coverage_80": nan, "raw_coverage_80": nan}
    gate, est, scores = False, [], []
    print(f"Only {len(prices)} official prices (needs {MIN_FIT_PRICES}): writing empty scores and estimates")
now = datetime.datetime.now(datetime.timezone.utc)

print(f"{len(prices)} official prices, {len(locations)} outlets, method {m['method']}, {m['hyper']}")
print(f"LOO: model ${loo['model_mae']:.3f} vs item median ${loo['baseline_mae']:.3f} → gate {'PASSED' if gate else 'FAILED'}")
print(f"80% interval coverage {loo['raw_coverage_80']:.2f} raw, scaled x{loo['interval_scale']:.2f} → {loo['coverage_80']:.2f}")
tiers = {}
for s in scores:
    key = f"{s['tier'] or '?'} {s['tier_basis'] or ''}".strip()
    tiers[key] = tiers.get(key, 0) + 1
print("Tiers:", tiers, f"| estimates written: {len(est)}")

# COMMAND ----------

from pyspark.sql import types as St

score_schema = St.StructType([
    St.StructField("location_id", St.StringType(), False),
    St.StructField("score_pct", St.DoubleType()), St.StructField("ci_low", St.DoubleType()),
    St.StructField("ci_high", St.DoubleType()), St.StructField("p_cheaper", St.DoubleType()),
    St.StructField("p_average", St.DoubleType()), St.StructField("p_pricier", St.DoubleType()),
    St.StructField("n_obs", St.IntegerType()), St.StructField("tier", St.StringType()),
    St.StructField("tier_basis", St.StringType()), St.StructField("n_items_cheapest", St.IntegerType()),
    St.StructField("method", St.StringType()), St.StructField("updated_at", St.TimestampType()),
])
spark.createDataFrame([{**s, "method": m["method"], "updated_at": now} for s in scores], score_schema) \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(T("gold_outlet_scores"))

est_schema = St.StructType([
    St.StructField("item_id", St.StringType(), False), St.StructField("location_id", St.StringType(), False),
    St.StructField("est_price", St.DoubleType()), St.StructField("est_low", St.DoubleType()),
    St.StructField("est_high", St.DoubleType()), St.StructField("est_support", St.IntegerType()),
    St.StructField("computed_at", St.TimestampType()),
])
spark.createDataFrame([{**e, "computed_at": now} for e in est], est_schema) \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(T("model_price_estimates"))

metrics = {
    "n_prices": float(len(prices)), "n_outlets_priced": float(len(n_obs)),
    "tau_o": m["hyper"]["tau_o"], "tau_c": m["hyper"]["tau_c"], "sigma": m["hyper"]["sigma"],
    "loo_mae_model": loo["model_mae"], "loo_mae_item_median": loo["baseline_mae"],
    "coverage_80_raw": loo["raw_coverage_80"], "coverage_80_calibrated": loo["coverage_80"],
    "interval_scale": loo["interval_scale"], "gate_passed": 1.0 if gate else 0.0,
    "self_test_spearman": spearman, "n_estimates": float(len(est)),
    "run_seconds": (now - started).total_seconds(),
}
metric_schema = St.StructType([St.StructField("metric", St.StringType(), False), St.StructField("value", St.DoubleType()),
                               St.StructField("method", St.StringType()), St.StructField("computed_at", St.TimestampType())])
spark.createDataFrame([{"metric": k, "value": float(v), "method": m["method"], "computed_at": now}
                       for k, v in metrics.items()], metric_schema) \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(T("gold_model_metrics"))

summary = (f"gate {'passed' if gate else 'failed'}: LOO ${loo['model_mae']:.3f} vs ${loo['baseline_mae']:.3f}; "
           f"tiers {tiers}; {len(est)} estimates")
print(summary)
dbutils.notebook.exit(summary)
