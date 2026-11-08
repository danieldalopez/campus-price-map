// Worth the walk (docs/SPEC.md section 10, "Worth the walk: the economics"). The same formula as the
// Databricks pipeline's gold_walk_worth, checked against its export by tests/walkworth.test.ts.
//
// Rounding matches the pipeline, which works in exact decimals and rounds half away from zero. So the maths
// runs in integers: cents for money, tenths for minutes. Rounding a floating point result instead would put
// about 0.7% of nets a cent off (tests/fixtures/walk_worth.json, "rounding").
//
// Pure functions only: no React, no fetch. Imported by the browser and by the tests.

/** `app_config` as GET /api/config returns it. */
export type WalkConfig = {
  bc_min_wage: number;
  weeks_term: number;
  weeks_year: number;
  weeks_degree: number;
  /** Within this many dollars of zero counts as about even. */
  even_band: number;
  /** Count the extra walking there and back. */
  round_trip: boolean;
  /** Cheaper outlets more than this many extra minutes away aren't suggested. */
  worth_max_extra_min: number;
};

/** Used for any key that's missing or unreadable, so Worth the walk still works. Same as db/seed.sql. */
export const DEFAULT_CONFIG: WalkConfig = {
  bc_min_wage: 18.25,
  weeks_term: 13,
  weeks_year: 26,
  weeks_degree: 104,
  even_band: 0.1,
  round_trip: true,
  worth_max_extra_min: 20,
};

export type Verdict = "worth_it" | "about_even" | "not_worth_it";

export type WalkWorth = {
  saving: number;
  extra_min: number;
  time_cost: number;
  net: number;
  verdict: Verdict;
  /** $/h: worth it if your time is worth less than this. Null when there are no extra minutes. */
  break_even_wage: number | null;
  /** The most extra minutes the saving pays for, at this wage. */
  break_even_min: number;
};

const cents = (x: number) => Math.round(x * 100);
const tenths = (x: number) => Math.round(x * 10);
/** Round half away from zero. */
const half = (q: number) => Math.sign(q) * Math.round(Math.abs(q));

/**
 * One cheaper option. `saving` in dollars, `extraMin` the extra walking already doubled for a round trip,
 * `wage` in $/h.
 */
export function walkWorth(saving: number, extraMin: number, wage: number, evenBand: number): WalkWorth {
  const s = cents(saving);
  const e = tenths(extraMin);
  const w = cents(wage);
  const net = half((600 * s - e * w) / 600) / 100;
  const band = cents(evenBand);
  const n = cents(net);
  return {
    saving: s / 100,
    extra_min: e / 10,
    time_cost: half((e * w) / 600) / 100,
    net,
    verdict: n > band ? "worth_it" : n < -band ? "not_worth_it" : "about_even",
    break_even_wage: e === 0 ? null : half((600 * s) / e) / 100,
    break_even_min: w === 0 ? Infinity : half((600 * s) / w) / 10,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Live, from where the student is
// ---------------------------------------------------------------------------------------------------------

/** What the live version needs from a Results row. */
export type WalkRow = {
  id: string;
  name: string;
  /** Official price only; estimates never count (G13). */
  price: number | null;
  /** About N minutes from the student. */
  walk_min: number | null;
  sold_out: boolean;
};

export type WalkOption<R extends WalkRow = WalkRow> = { row: R } & WalkWorth;

export type LiveWalk<R extends WalkRow = WalkRow> = {
  /** The closest in-stock outlet with an official price: where they'd buy without the app. */
  near: R;
  /** Every cheaper outlet within worth_max_extra_min, best first. */
  options: WalkOption<R>[];
  /** Highest net, not the cheapest price (section 10). */
  best: WalkOption<R>;
};

/**
 * The live version (section 10): the student's position is the origin, `near` is the closest in-stock outlet
 * with an official price, and each cheaper outlet costs the extra minutes beyond walking to `near`
 * (floored at 0, doubled for a round trip). Null when nothing cheaper is within reach, including when the
 * closest is already the cheapest.
 */
export function liveWalk<R extends WalkRow>(rows: readonly R[], config: WalkConfig, wage: number): LiveWalk<R> | null {
  const usable = rows.filter(
    (r): r is R & { price: number; walk_min: number } => r.price !== null && r.walk_min !== null && !r.sold_out,
  );
  if (usable.length < 2) return null;
  const near = usable.reduce((a, b) =>
    b.walk_min < a.walk_min || (b.walk_min === a.walk_min && cents(b.price) < cents(a.price)) ? b : a,
  );
  const factor = config.round_trip ? 2 : 1;
  const options: WalkOption<R>[] = [];
  for (const r of usable) {
    if (r.id === near.id || cents(r.price) >= cents(near.price)) continue;
    const extra = Math.max(0, r.walk_min - near.walk_min) * factor;
    if (extra > config.worth_max_extra_min) continue;
    options.push({ row: r, ...walkWorth((cents(near.price) - cents(r.price)) / 100, extra, wage, config.even_band) });
  }
  if (options.length === 0) return null;
  options.sort((a, b) => b.net - a.net || a.extra_min - b.extra_min || b.saving - a.saving);
  return { near, options, best: options[0] };
}

// ---------------------------------------------------------------------------------------------------------
// Projections: the student's own frequency, never assumed (G14)
// ---------------------------------------------------------------------------------------------------------

export type Horizon = "term" | "year" | "degree";

export function horizonWeeks(config: WalkConfig, h: Horizon): number {
  return h === "term" ? config.weeks_term : h === "year" ? config.weeks_year : config.weeks_degree;
}

export type Projection = { purchases: number; saved: number; minutes: number; net: number };

/** `perWeek` purchases a week for `weeks` weeks, "if prices hold". */
export function project(option: Pick<WalkWorth, "saving" | "extra_min" | "net">, perWeek: number, weeks: number): Projection {
  const purchases = perWeek * weeks;
  return {
    purchases,
    saved: (cents(option.saving) * purchases) / 100,
    minutes: (tenths(option.extra_min) * purchases) / 10,
    net: (cents(option.net) * purchases) / 100,
  };
}

/**
 * Putting the weekly saving aside at the student's own yearly rate (never assumed): weekly deposit
 * S = net × perWeek (only if positive), i = rate / 52, FV = S × ((1 + i)^weeks − 1) / i. Null if there's
 * nothing to put aside.
 */
export function futureValue(net: number, perWeek: number, ratePct: number, weeks: number): number | null {
  const deposit = net * perWeek;
  if (!(deposit > 0) || !Number.isFinite(ratePct) || ratePct < 0) return null;
  const i = ratePct / 100 / 52;
  const fv = i === 0 ? deposit * weeks : (deposit * ((1 + i) ** weeks - 1)) / i;
  return Math.round(fv * 100) / 100;
}

/** "✓ Worth it", "≈ About even", "✗ Not worth it for the money": a symbol and words, never colour alone. */
export const VERDICT_WORDS: Record<Verdict, { symbol: string; words: string }> = {
  worth_it: { symbol: "✓", words: "Worth it" },
  about_even: { symbol: "≈", words: "About even" },
  not_worth_it: { symbol: "✗", words: "Not worth it for the money" },
};
