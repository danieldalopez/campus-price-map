// Worth the walk (docs/SPEC.md section 10). The app's maths must match the Databricks pipeline's
// gold_walk_worth rows exported in tests/fixtures/walk_worth.json, to the cent, for what the app shows:
// the saving, the extra minutes and what they add up to. Run with npm test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { futureValue, liveWalk, project, walkSaving, type WalkConfig, type WalkRow } from "../src/lib/walkworth.ts";

type FixtureRow = {
  item_name: string;
  origin_name: string;
  cheaper_name: string;
  origin_price: number;
  cheaper_price: number;
  saving: number;
  walk_min: number;
  round_trip: boolean;
  extra_min: number;
  weeks_term: number;
  saved_term: number;
  minutes_term: number;
  weeks_year: number;
  saved_year: number;
  weeks_degree: number;
  saved_degree: number;
  minutes_degree: number;
};

const fixture = JSON.parse(readFileSync(new URL("./fixtures/walk_worth.json", import.meta.url), "utf8")) as {
  rows: FixtureRow[];
};

describe("walkSaving matches Databricks gold_walk_worth", () => {
  it("has rows to check", () => assert.ok(fixture.rows.length >= 30, `${fixture.rows.length} rows`));

  for (const r of fixture.rows) {
    it(`${r.item_name}: ${r.origin_name} → ${r.cheaper_name}`, () => {
      // The student stands exactly at the origin outlet, so the extra walk is walk(origin, cheaper).
      const got = walkSaving(r.origin_price, r.cheaper_price, r.walk_min, r.round_trip);
      assert.equal(got.saving, r.saving, "saving");
      assert.equal(got.extra_min, r.extra_min, "extra_min");
      // Databricks' per-horizon numbers are per weekly purchase.
      const term = project(got, 1, r.weeks_term);
      assert.equal(term.saved, r.saved_term, "saved_term");
      assert.equal(term.minutes, r.minutes_term, "minutes_term");
      assert.equal(project(got, 1, r.weeks_year).saved, r.saved_year, "saved_year");
      const degree = project(got, 1, r.weeks_degree);
      assert.equal(degree.saved, r.saved_degree, "saved_degree");
      assert.equal(degree.minutes, r.minutes_degree, "minutes_degree");
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
    const got = liveWalk([row("near", 3.0, 2), row("far", 2.2, 3)], CONFIG);
    assert.ok(got);
    assert.equal(got.near.id, "near");
    assert.equal(got.best.row.id, "far");
    assert.equal(got.best.extra_min, 2);
    assert.equal(got.best.saving, 0.8);
  });

  it("picks the biggest saving within reach, then the shorter walk", () => {
    const got = liveWalk([row("near", 3.0, 1), row("cheapest", 2.0, 9), row("next-door", 2.7, 2)], CONFIG);
    assert.equal(got?.best.row.id, "cheapest");
    const tie = liveWalk([row("near", 3.0, 1), row("far", 2.0, 8), row("close", 2.0, 3)], CONFIG);
    assert.equal(tie?.best.row.id, "close");
  });

  it("skips sold out outlets, estimates and anything too far", () => {
    const got = liveWalk(
      [row("near", 3.0, 1), row("sold-out", 1.0, 1, true), row("estimate", null, 1), row("too-far", 1.0, 12)],
      CONFIG,
    );
    assert.equal(got, null);
  });

  it("doesn't suggest a walk for a few cents", () => {
    assert.equal(liveWalk([row("near", 3.25, 1), row("far", 3.19, 8)], CONFIG), null);
    assert.equal(liveWalk([row("near", 3.25, 1), row("far", 3.15, 8)], CONFIG)?.best.saving, 0.1);
  });

  it("is null when the closest is already the cheapest", () => {
    assert.equal(liveWalk([row("near", 2.0, 1), row("far", 3.0, 4)], CONFIG), null);
  });
});

describe("what it adds up to", () => {
  it("$0.80 saving, 2 extra minutes, 4 a week for a term", () => {
    assert.deepEqual(project({ saving: 0.8, extra_min: 2 }, 4, 13), { purchases: 52, saved: 41.6, minutes: 104 });
  });

  it("the weekly saving put aside at the student's own rate", () => {
    assert.equal(futureValue(0.8, 4, 0, 104), 332.8);
    const fv = futureValue(0.8, 4, 5, 104);
    assert.ok(fv !== null && fv > 332.8 && fv < 360, String(fv));
    assert.equal(futureValue(0.8, 4, Number.NaN, 104), null);
  });
});
