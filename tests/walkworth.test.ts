// Worth the walk parity (docs/SPEC.md section 10): the app's formula must reproduce the Databricks
// pipeline's gold_walk_worth rows exported in tests/fixtures/walk_worth.json, to the cent. Run with npm test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { futureValue, liveWalk, project, walkWorth, type WalkConfig, type WalkRow } from "../src/lib/walkworth.ts";

type FixtureRow = {
  item_name: string;
  origin_location_id: string;
  origin_name: string;
  cheaper_location_id: string;
  cheaper_name: string;
  origin_price: number;
  cheaper_price: number;
  saving: number;
  walk_min: number;
  round_trip: boolean;
  extra_min: number;
  wage: number;
  time_cost: number;
  net: number;
  even_band: number;
  verdict: string;
  break_even_wage: number | null;
  break_even_min: number;
  weeks_term: number;
  saved_term: number;
  minutes_term: number;
  net_term: number;
  weeks_degree: number;
  net_degree: number;
};

const fixture = JSON.parse(readFileSync(new URL("./fixtures/walk_worth.json", import.meta.url), "utf8")) as {
  rows: FixtureRow[];
};

describe("walkWorth matches Databricks gold_walk_worth", () => {
  it("has rows to check", () => assert.ok(fixture.rows.length >= 30, `${fixture.rows.length} rows`));

  for (const r of fixture.rows) {
    it(`${r.item_name}: ${r.origin_name} → ${r.cheaper_name}`, () => {
      // The student stands exactly at the origin outlet, so walk(you, near) = 0 and extra = walk(o, c).
      const extra = r.walk_min * (r.round_trip ? 2 : 1);
      const got = walkWorth(r.origin_price - r.cheaper_price, extra, r.wage, r.even_band);
      assert.equal(got.saving, r.saving, "saving");
      assert.equal(got.extra_min, r.extra_min, "extra_min");
      assert.equal(got.time_cost, r.time_cost, "time_cost");
      assert.equal(got.net, r.net, "net");
      assert.equal(got.verdict, r.verdict, "verdict");
      assert.equal(got.break_even_wage, r.break_even_wage, "break_even_wage");
      assert.equal(got.break_even_min, r.break_even_min, "break_even_min");

      const term = project(got, 1, r.weeks_term);
      assert.equal(term.saved, r.saved_term, "saved_term");
      assert.equal(term.minutes, r.minutes_term, "minutes_term");
      assert.equal(term.net, r.net_term, "net_term");
      assert.equal(project(got, 1, r.weeks_degree).net, r.net_degree, "net_degree");
    });
  }
});

const CONFIG: WalkConfig = {
  bc_min_wage: 18.25,
  weeks_term: 13,
  weeks_year: 26,
  weeks_degree: 104,
  even_band: 0.1,
  round_trip: true,
  worth_max_extra_min: 20,
};

const row = (id: string, price: number | null, walk: number, soldOut = false): WalkRow => ({
  id,
  name: id,
  price,
  walk_min: walk,
  sold_out: soldOut,
});

describe("liveWalk", () => {
  it("measures extra minutes beyond the closest outlet, there and back", () => {
    const got = liveWalk([row("near", 3.0, 2), row("far", 2.2, 3)], CONFIG, 18.25);
    assert.ok(got);
    assert.equal(got.near.id, "near");
    assert.equal(got.best.row.id, "far");
    assert.equal(got.best.extra_min, 2);
    assert.equal(got.best.saving, 0.8);
  });

  it("picks the highest net, not the cheapest price", () => {
    const got = liveWalk([row("near", 3.0, 1), row("cheapest-far", 2.0, 9), row("next-door", 2.7, 2)], CONFIG, 18.25);
    assert.equal(got?.best.row.id, "next-door");
  });

  it("skips sold out outlets, estimates and anything too far", () => {
    const got = liveWalk(
      [row("near", 3.0, 1), row("sold-out", 1.0, 1, true), row("estimate", null, 1), row("too-far", 1.0, 12)],
      CONFIG,
      18.25,
    );
    assert.equal(got, null);
  });

  it("is null when the closest is already the cheapest", () => {
    assert.equal(liveWalk([row("near", 2.0, 1), row("far", 3.0, 4)], CONFIG, 18.25), null);
  });
});

describe("projections", () => {
  it("SPEC example: $0.80 saving, 2 extra minutes, 4 a week for a term", () => {
    const opt = walkWorth(0.8, 2, 18, 0.1);
    assert.equal(opt.net, 0.2);
    const p = project(opt, 4, 13);
    assert.deepEqual(p, { purchases: 52, saved: 41.6, minutes: 104, net: 10.4 });
  });

  it("future value of the weekly saving at the student's own rate", () => {
    assert.equal(futureValue(0.2, 4, 0, 104), 83.2);
    assert.equal(futureValue(-0.5, 4, 5, 104), null);
    const fv = futureValue(0.2, 4, 5, 104);
    assert.ok(fv !== null && fv > 83.2 && fv < 90);
  });
});
