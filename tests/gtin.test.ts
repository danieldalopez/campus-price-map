// Barcode number tests (docs/SPEC.md sections 6 "Barcodes" and 8). Run with `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { barcodeKeys, checkDigit, hasValidCheckDigit, upcEToUpcA } from "../src/lib/gtin.ts";

describe("check digits", () => {
  it("accepts real codes from data/barcodes.csv", () => {
    for (const code of ["0180854000101", "0889392607215", "0629071000650", "06717605"]) {
      assert.equal(hasValidCheckDigit(code) || upcEToUpcA(code) !== null, true, code);
    }
    assert.equal(checkDigit("018085400010"), 1);
  });

  it("rejects a wrong check digit and non digits", () => {
    assert.equal(hasValidCheckDigit("0180854000102"), false);
    assert.equal(hasValidCheckDigit("01808540001x1"), false);
    assert.equal(hasValidCheckDigit("1234567"), false);
  });
});

describe("UPC-E", () => {
  it("expands the Dasani can's UPC-E to Coca-Cola Canada's UPC-A", () => {
    assert.equal(upcEToUpcA("06717605"), "067000001765");
  });

  it("covers every last-digit rule", () => {
    assert.equal(upcEToUpcA("04252614"), "042100005264"); // 0 to 2: manufacturer keeps it
    assert.equal(upcEToUpcA("01234531"), "012300000451"); // 3
    assert.equal(upcEToUpcA("01234543"), "012340000053"); // 4
    assert.equal(upcEToUpcA("01234565"), "012345000065"); // 5 to 9 (the textbook example)
  });

  it("rejects a UPC-E whose check digit doesn't fit", () => {
    assert.equal(upcEToUpcA("01234566"), null);
  });

  it("isn't a UPC-E unless it starts with 0 or 1", () => {
    assert.equal(upcEToUpcA("96717605"), null);
  });
});

describe("barcodeKeys", () => {
  it("makes a UPC-A and its EAN-13 the same product", () => {
    assert.deepEqual(barcodeKeys("889392607215"), barcodeKeys("0889392607215"));
  });

  it("gives an 8-digit code both its EAN-8 and UPC-E readings", () => {
    assert.deepEqual(barcodeKeys("06717605"), ["00000006717605", "00067000001765"]);
    assert.ok(barcodeKeys("067000001765").includes("00067000001765"));
  });

  it("refuses anything that isn't 8 to 14 digits", () => {
    assert.deepEqual(barcodeKeys("1234567"), []);
    assert.deepEqual(barcodeKeys("123456789012345"), []);
    assert.deepEqual(barcodeKeys("abc"), []);
  });
});
