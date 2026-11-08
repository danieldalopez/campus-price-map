// Brand + size matching for scanned products (docs/SPEC.md G16, version 15). Run with npm test.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { familyCandidates, itemForVariant, sizeInMl } from "../src/lib/variant-match.ts";

describe("itemForVariant", () => {
  it("any Red Bull flavour counts by size", () => {
    assert.equal(itemForVariant("Boisson énergisante Sans Sucre", "Red Bull", "250 ml"), "I01");
    assert.equal(itemForVariant("Red Bull Sugarfree", "Red Bull", "355 mL"), "I22");
    assert.equal(itemForVariant("The Blue Edition", "Red Bull", "473ml"), "I24");
    assert.equal(itemForVariant("Red Bull Zero", "Red Bull", "12 fl oz"), "I22");
  });

  it("other tracked drinks by brand and size", () => {
    assert.equal(itemForVariant("Monster Ultra Zero", "Monster Energy", "473 ml"), "I02");
    assert.equal(itemForVariant("Celsius Sparkling Orange", "Celsius", "355 ml"), "I03");
    assert.equal(itemForVariant("Coca-Cola Zero Sugar", "Coca-Cola", "355 mL"), "I04");
    assert.equal(itemForVariant("Diet Coke", "Coca-Cola", "591 mL"), "I05");
  });

  it("never matches multipacks, untracked sizes or other brands", () => {
    assert.equal(itemForVariant("Red Bull Sugarfree", "Red Bull", "4 x 250 ml"), null);
    assert.equal(itemForVariant("Red Bull 12 pack", "Red Bull", "250 ml"), null);
    assert.equal(itemForVariant("Monster Energy", "Monster", "355 ml"), null);
    assert.equal(itemForVariant("Bang Energy", "Bang", "473 ml"), null);
    assert.equal(itemForVariant("Red Bull", "Red Bull", null), null);
  });

  it("reads sizes in ml, cl, l and fl oz", () => {
    assert.equal(sizeInMl("250 mL"), 250);
    assert.equal(sizeInMl("25 cl"), 250);
    assert.equal(sizeInMl("0.473 l"), 473);
    assert.equal(sizeInMl("8.4 fl oz"), 250);
    assert.equal(sizeInMl("16 FL OZ"), 473);
  });
});

describe("familyCandidates", () => {
  it("asks which size when a tracked brand has no readable size", () => {
    assert.deepEqual(familyCandidates("Boisson énergisante Sans Sucre", "Red Bull", null), ["I01", "I22", "I24"]);
  });
  it("doesn't ask for untracked sizes, multipacks or other brands", () => {
    assert.deepEqual(familyCandidates("Monster Ultra", "Monster", "355 ml"), []);
    assert.deepEqual(familyCandidates("Red Bull 4 x 250 ml", "Red Bull", null), []);
    assert.deepEqual(familyCandidates("Bang", "Bang", null), []);
  });
});
