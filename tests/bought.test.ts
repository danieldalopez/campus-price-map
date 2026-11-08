// "I bought it" timing (docs/SPEC.md Step 8): when the app asks after a Directions tap. Run with npm test.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

// src/lib/bought.ts keeps the trip in localStorage: a tiny in-memory stand-in.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const { ASK_AFTER_MS, FORGET_AFTER_MS, clearIntent, dueIntent, noteIntent } = await import("../src/lib/bought.ts");

const OUTLET = { id: "tim-hortons", name: "Tim Hortons", lat: 49.2606, lng: -123.246 };

describe("dueIntent", () => {
  beforeEach(() => store.clear());

  it("asks nothing without a trip", () => assert.equal(dueIntent(Date.now(), null), null));

  it("waits a few minutes, then asks", () => {
    noteIntent({ outlet: OUTLET, item: null, price: 2.19 });
    const at = Date.now();
    assert.equal(dueIntent(at + 60_000, null), null);
    assert.equal(dueIntent(at + ASK_AFTER_MS + 1_000, null)?.outlet.id, "tim-hortons");
  });

  it("asks sooner when they're standing at the outlet", () => {
    noteIntent({ outlet: OUTLET, item: null, price: 2.19 });
    const at = Date.now();
    assert.equal(dueIntent(at + 60_000, { lat: 49.26062, lng: -123.24602 })?.outlet.id, "tim-hortons");
    assert.equal(dueIntent(at + 60_000, { lat: 49.27, lng: -123.25 }), null, "1 km away");
  });

  it("forgets old trips and never asks twice", () => {
    noteIntent({ outlet: OUTLET, item: null, price: 2.19 });
    assert.equal(dueIntent(Date.now() + FORGET_AFTER_MS + 1_000, null), null);
    assert.equal(store.size, 0);
    noteIntent({ outlet: OUTLET, item: null, price: 2.19 });
    clearIntent();
    assert.equal(dueIntent(Date.now() + ASK_AFTER_MS + 1_000, null), null);
  });
});
