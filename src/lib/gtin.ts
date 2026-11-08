// Barcode numbers (EAN-13, EAN-8, UPC-A, UPC-E) and how they relate. docs/SPEC.md sections 6 "Barcodes" and 8.
// Import free on purpose: the browser, the API route and `node --test` all use it.
//
// The same product can come back from a scanner in different shapes: a UPC-A can, as "889392607215" or as the
// EAN-13 "0889392607215", and a small can's UPC-E "06717605" is short for the UPC-A "067000001765". Every
// shape is turned into 14-digit keys (GTIN-14, zero padded) so they all find the same row.

/** What `/api/barcode` returns (section 8). `matched` only ever comes from the bundled file (G16). */
export type BarcodeStatus = "matched" | "known" | "unknown";

export type BarcodeResult = {
  status: BarcodeStatus;
  item_id?: string;
  product_name?: string;
  quantity?: string;
  /** "known" from a tracked brand whose size wasn't readable: its tracked sizes, so the scanner asks which. */
  candidates?: string[];
};

/** 8 to 14 digits, the only input `/api/barcode` accepts. */
export const BARCODE_PATTERN = /^\d{8,14}$/;

/** GS1 mod-10 check digit over every digit but the last. Works for EAN-8, UPC-A, EAN-13 and GTIN-14. */
export function checkDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** True when the last digit is the right check digit for the rest. */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d{8,14}$/.test(code)) return false;
  return checkDigit(code.slice(0, -1)) === code.charCodeAt(code.length - 1) - 48;
}

/**
 * UPC-E (8 digits: number system 0 or 1, six digits, check digit) expanded to its 12-digit UPC-A, or null if
 * it can't be a UPC-E.
 */
export function upcEToUpcA(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const ns = code[0];
  const d = code.slice(1, 7);
  const check = code[7];
  const last = d[5];
  let body: string;
  if (last === "0" || last === "1" || last === "2") body = `${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`;
  else if (last === "3") body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
  else if (last === "4") body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
  else body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${last}`;
  const upcA = `${ns}${body}${check}`;
  return hasValidCheckDigit(upcA) ? upcA : null;
}

const pad14 = (code: string) => code.padStart(14, "0");

/**
 * Every 14-digit key a code can stand for. An 8-digit code is either an EAN-8 or a UPC-E, so it gets both.
 * Two codes are the same product when their keys overlap.
 */
export function barcodeKeys(code: string): string[] {
  if (!BARCODE_PATTERN.test(code)) return [];
  const keys = [pad14(code)];
  if (code.length === 8) {
    const upcA = upcEToUpcA(code);
    if (upcA) keys.push(pad14(upcA));
  }
  return keys;
}
