// Step 7's lines under each price (docs/SPEC.md section 7): the freshness line, "just confirmed" in pipeline
// mode, and the pending report as the client sees it. Pure functions, no database. Run with npm test.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveExtras, liveFields, pipelineFields, type LiveExtraCols, type PipelinePriceCols } from "../src/lib/prices.ts";
import { freshness, STALE_DAYS } from "../src/lib/pricing.ts";

const NOW = Date.parse("2026-11-08T20:00:00Z"); // noon in Vancouver
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;

describe("freshness line", () => {
  it("names each source the way section 7 words it", () => {
    const nov7 = "2026-11-07T20:00:00Z";
    assert.equal(freshness({ source: "seed", confirmations: 0, updated_at: nov7 }, NOW)?.text, "Prototype price");
    assert.equal(freshness({ source: "menu", confirmations: 0, updated_at: nov7 }, NOW)?.text, "Menu price · Nov 7");
    assert.equal(freshness({ source: "walk", confirmations: 0, updated_at: nov7 }, NOW)?.text, "From our price walk · Nov 7");
    assert.equal(freshness({ source: "grocery", confirmations: 0, updated_at: nov7 }, NOW)?.text, "Grocery baseline");
  });

  it("counts the reporter plus everyone who confirmed, with how long ago", () => {
    assert.equal(
      freshness({ source: "photo", confirmations: 1, updated_at: ago(20 * MIN) }, NOW)?.text,
      "Confirmed by 2 students · 20 min ago",
    );
    assert.equal(
      freshness({ source: "typed", confirmations: 0, updated_at: ago(30_000) }, NOW)?.text,
      "Confirmed by 1 student · just now",
    );
    assert.equal(
      freshness({ source: "receipt", confirmations: 2, updated_at: ago(3 * 60 * MIN) }, NOW)?.text,
      "Confirmed by 3 students · 3 h ago",
    );
  });

  it(`dims prices older than ${STALE_DAYS} days and says they may be out of date`, () => {
    const fresh = freshness({ source: "menu", confirmations: 0, updated_at: ago(STALE_DAYS * DAY - MIN) }, NOW);
    assert.equal(fresh?.stale, false);
    assert.doesNotMatch(fresh?.text ?? "", /out of date/);

    const old = freshness({ source: "photo", confirmations: 1, updated_at: ago(STALE_DAYS * DAY + MIN) }, NOW);
    assert.equal(old?.stale, true);
    assert.match(old?.text ?? "", / · may be out of date$/);
  });

  it("has no line when there's no official price", () => {
    assert.equal(freshness({ source: null, confirmations: 0, updated_at: null }, NOW), null);
  });
});

function pipelineRow(overrides: Partial<PipelinePriceCols>): PipelinePriceCols {
  return {
    pc_key: "blue-chip-cafe",
    price: "3.50",
    source: "seed",
    confirmations: "0",
    updated_at: "2026-11-08T18:00:00.000Z",
    n_outlets: "6",
    campus_median: "3.40",
    band: "average",
    pct_vs_median: "3",
    chip: "2nd cheapest of 6",
    nearest_cheaper_location_id: null,
    nearest_cheaper_name: null,
    nearest_cheaper_price: null,
    nearest_cheaper_walk_min: null,
    est_low: null,
    est_high: null,
    live_price: null,
    live_updated_at: null,
    walk_best_location_id: null,
    walk_best_name: null,
    walk_best_stock: null,
    walk_saving: null,
    walk_extra_min: null,
    ...overrides,
  };
}

describe("just confirmed line (pipeline mode)", () => {
  it("shows a live official price newer than the pipeline's row, and keeps the pipeline's big price", () => {
    const f = pipelineFields(
      pipelineRow({ live_price: "3.25", live_updated_at: new Date("2026-11-08T19:30:00Z") }),
    );
    assert.equal(f.price, 3.5);
    assert.equal(f.chip, "2nd cheapest of 6");
    assert.deepEqual(f.just_confirmed, { price: 3.25, updated_at: "2026-11-08T19:30:00.000Z" });
  });

  it("stays hidden when the live price is the pipeline's own row (same time, within 1 s)", () => {
    for (const at of ["2026-11-08T18:00:00Z", "2026-11-08T18:00:00.900Z", "2026-11-08T17:00:00Z"]) {
      const f = pipelineFields(pipelineRow({ live_price: "3.50", live_updated_at: new Date(at) }));
      assert.equal(f.just_confirmed, null, at);
    }
  });

  it("shows when the pipeline has no price yet for the outlet", () => {
    const f = pipelineFields(
      pipelineRow({
        pc_key: null,
        price: null,
        live_price: "2.75",
        live_updated_at: new Date("2026-11-08T19:00:00Z"),
      }),
    );
    assert.equal(f.price, null);
    assert.equal(f.chip, null);
    assert.equal(f.just_confirmed?.price, 2.75);
  });

  it("never shows in live mode", () => {
    const f = liveFields({ price: "3.25", source: "photo", confirmations: "1", updated_at: new Date() }, 3.4, 6);
    assert.equal(f.just_confirmed, null);
    assert.equal(f.chip, null);
  });
});

describe("pending report sent to the client", () => {
  const base: LiveExtraCols = {
    pending_price_id: "595",
    pending_price: "9.50",
    pending_device_id: "00000000-0000-0000-0000-000000000001",
    pending_my_vote: null,
    stock: "in_stock",
    last_confirmed_at: null,
  };

  it("marks it as mine only for the device that reported it, and never sends the reporter's id", () => {
    const reporter = liveExtras(base, "00000000-0000-0000-0000-000000000001");
    assert.deepEqual(reporter.pending, { price_id: 595, price: 9.5, mine: true, my_vote: null });

    const other = liveExtras(base, "00000000-0000-0000-0000-000000000002");
    assert.equal(other.pending?.mine, false);
    assert.ok(!JSON.stringify(other).includes(base.pending_device_id!), "other devices' ids never leave");

    assert.equal(liveExtras(base, undefined).pending?.mine, false, "no device id: not mine");
  });

  it("carries this device's earlier vote so the buttons give way to 'You voted …'", () => {
    assert.equal(liveExtras({ ...base, pending_my_vote: "unsure" }, undefined).pending?.my_vote, "unsure");
    assert.equal(liveExtras({ ...base, pending_my_vote: "bogus" }, undefined).pending?.my_vote, null);
  });

  it("is null when there's no pending report", () => {
    assert.equal(liveExtras({ ...base, pending_price_id: null, pending_price: null }, undefined).pending, null);
  });
});
