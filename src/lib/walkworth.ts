// Worth the walk (docs/SPEC.md section 10). The point: a few extra minutes of walking, repeated every time
// you buy the thing, adds up to real money. So it's about the money saved and how it grows over a term, a
// year and a degree. Time is shown as minutes, never priced: no wage, no "not worth it" verdict.
//
// Money in integer cents, minutes in tenths, so the totals match Databricks' gold_walk_worth to the cent
// (tests/walkworth.test.ts against tests/fixtures/walk_worth.json).
//
// Pure functions only: no React, no fetch. Imported by the browser and by the tests.

/** `app_config` as GET /api/config returns it. */
export type WalkConfig = {
  bc_min_wage: number;
  weeks_term: number;
  weeks_year: number;
  weeks_degree: number;
  /** The smallest saving each time worth suggesting a walk for (a few cents isn't a pitch). */
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

/**
 * Purchases a week the card starts with: once every school day. Shown and changeable on the card ("I buy it
 * [5] times a week"), never hidden.
 */
export const DEFAULT_PER_WEEK = 5;

const cents = (x: number) => Math.round(x * 100);
const tenths = (x: number) => Math.round(x * 10);

/** One cheaper option: what it saves each time and the extra minutes it takes (already doubled for a round trip). */
export type WalkSaving = { saving: number; extra_min: number };

/** `price(origin) − price(cheaper)` and `walk × (2 if round trip)`, in exact cents and tenths. */
export function walkSaving(originPrice: number, cheaperPrice: number, walkMin: number, roundTrip: boolean): WalkSaving {
  return {
    saving: (cents(originPrice) - cents(cheaperPrice)) / 100,
    extra_min: (tenths(walkMin) * (roundTrip ? 2 : 1)) / 10,
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

export type WalkOption<R extends WalkRow = WalkRow> = { row: R } & WalkSaving;

export type LiveWalk<R extends WalkRow = WalkRow> = {
  /** The closest in-stock outlet with an official price: where they'd buy without the app. */
  near: R;
  /** Every cheaper outlet within worth_max_extra_min, biggest saving first. */
  options: WalkOption<R>[];
  /** The biggest saving within reach; on a tie, the shorter walk. */
  best: WalkOption<R>;
};

/**
 * The live version (section 10): the student's position is the origin, `near` is the closest in-stock outlet
 * with an official price, and each cheaper outlet costs the extra minutes beyond walking to `near` (floored
 * at 0, doubled for a round trip). Savings under `even_band` each time aren't suggested. Null when nothing
 * cheaper is within reach, including when the closest is already the cheapest.
 */
export function liveWalk<R extends WalkRow>(rows: readonly R[], config: WalkConfig): LiveWalk<R> | null {
  const usable = rows.filter(
    (r): r is R & { price: number; walk_min: number } => r.price !== null && r.walk_min !== null && !r.sold_out,
  );
  if (usable.length < 2) return null;
  const near = usable.reduce((a, b) =>
    b.walk_min < a.walk_min || (b.walk_min === a.walk_min && cents(b.price) < cents(a.price)) ? b : a,
  );
  const options: WalkOption<R>[] = [];
  for (const r of usable) {
    if (r.id === near.id || cents(r.price) >= cents(near.price)) continue;
    const option = walkSaving(near.price, r.price, Math.max(0, r.walk_min - near.walk_min), config.round_trip);
    if (option.extra_min > config.worth_max_extra_min || cents(option.saving) < cents(config.even_band)) continue;
    options.push({ row: r, ...option });
  }
  if (options.length === 0) return null;
  options.sort((a, b) => b.saving - a.saving || a.extra_min - b.extra_min);
  return { near, options, best: options[0] };
}

// ---------------------------------------------------------------------------------------------------------
// What it adds up to
// ---------------------------------------------------------------------------------------------------------

export type Horizon = "term" | "year" | "degree";
export const HORIZONS: readonly Horizon[] = ["term", "year", "degree"];

export function horizonWeeks(config: WalkConfig, h: Horizon): number {
  return h === "term" ? config.weeks_term : h === "year" ? config.weeks_year : config.weeks_degree;
}

export type Projection = { purchases: number; saved: number; minutes: number };

/** `perWeek` purchases a week for `weeks` weeks, "if prices hold". */
export function project(option: WalkSaving, perWeek: number, weeks: number): Projection {
  const purchases = perWeek * weeks;
  return {
    purchases,
    saved: (cents(option.saving) * purchases) / 100,
    minutes: (tenths(option.extra_min) * purchases) / 10,
  };
}

/**
 * The weekly saving put aside at the student's own yearly rate (never assumed): weekly deposit
 * S = saving × perWeek, i = rate / 52, FV = S × ((1 + i)^weeks − 1) / i. Null for a rate that isn't a number.
 */
export function futureValue(saving: number, perWeek: number, ratePct: number, weeks: number): number | null {
  const deposit = saving * perWeek;
  if (!(deposit > 0) || !Number.isFinite(ratePct) || ratePct < 0) return null;
  const i = ratePct / 100 / 52;
  const fv = i === 0 ? deposit * weeks : (deposit * ((1 + i) ** weeks - 1)) / i;
  return Math.round(fv * 100) / 100;
}
