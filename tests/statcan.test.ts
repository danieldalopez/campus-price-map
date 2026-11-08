// The StatCan line on Results (src/lib/statcan.ts). Run with `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { statcanGeo, statcanLine, statcanMonth } from "../src/lib/statcan.ts";

const banana = {
  kind: "same_item" as const,
  value: 0.22,
  geo: "British Columbia",
  ref_month: "2026-09",
  note: "a medium banana, about 120 g",
};
const coffee = {
  kind: "ingredients" as const,
  value: 0.28,
  geo: "British Columbia",
  ref_month: "2026-09",
  note: "about 10 g of ground coffee for a small cup",
};

describe("statcanMonth and statcanGeo", () => {
  it("formats the month and shortens BC only", () => {
    assert.equal(statcanMonth("2026-09"), "Sep 2026");
    assert.equal(statcanMonth("2026-01-01"), "Jan 2026");
    assert.equal(statcanMonth(null), null);
    assert.equal(statcanGeo("British Columbia"), "BC");
    assert.equal(statcanGeo("Canada"), "Canada");
  });
});

describe("statcanLine", () => {
  it("same_item: stamp and the ratio to the grocery price", () => {
    assert.deepEqual(statcanLine(banana, 1.25), {
      stamp: true,
      text: "5.7x the BC grocery price · StatCan, BC, Sep 2026 · assuming a medium banana, about 120 g",
    });
  });

  it("same_item without a campus price shows the StatCan price", () => {
    assert.equal(statcanLine(banana, null)?.text.startsWith("$0.22 at the BC grocery price · "), true);
  });

  it("ingredients: no stamp, cost per cup", () => {
    assert.deepEqual(statcanLine(coffee, 2.1), {
      stamp: false,
      text: "Brewing it yourself costs about $0.28 a cup · StatCan, BC, Sep 2026 · about 10 g of ground coffee for a small cup",
    });
  });

  it("labels the Canada fallback as Canada", () => {
    assert.equal(statcanLine({ ...banana, geo: "Canada" }, 1.1)?.text, "5.0x the Canada grocery price · StatCan, Canada, Sep 2026 · assuming a medium banana, about 120 g");
  });

  it("hides the line for a zero or missing value", () => {
    assert.equal(statcanLine({ ...banana, value: 0 }, 1.25), null);
  });
});
