// Reading a barcode from a camera frame (docs/SPEC.md sections 3 and 7, Scan). Browser only.
// The browser's own BarcodeDetector where it has one (Chrome on Android, Safari on macOS), else @zxing/browser
// (iPhone Safari has no native detector). Only EAN-13, EAN-8, UPC-A and UPC-E: the codes on packaged food.

import type { DecodeHintType } from "@zxing/library";
import { hasValidCheckDigit, upcEToUpcA } from "./gtin";

/** The formats we read, by their BarcodeDetector names. */
export const SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

export type BarcodeReader = {
  kind: "native" | "zxing";
  /** The digits of the first EAN or UPC code in the frame, or null if there isn't one. */
  read: (frame: HTMLCanvasElement) => Promise<string | null>;
};

// The Barcode Detection API isn't in TypeScript's DOM types yet.
type DetectedBarcode = { rawValue: string; format: string };
type NativeDetector = { detect: (source: HTMLCanvasElement) => Promise<DetectedBarcode[]> };
type NativeDetectorClass = {
  new (options?: { formats?: readonly string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

/** Digits only, with a valid check digit. A UPC-E has its own check, worked out on the expanded UPC-A. */
export function cleanCode(raw: string): string | null {
  const code = raw.trim();
  if (!/^\d{8,14}$/.test(code)) return null;
  if (hasValidCheckDigit(code)) return code;
  return code.length === 8 && upcEToUpcA(code) ? code : null;
}

async function nativeReader(): Promise<BarcodeReader | null> {
  const Detector = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Detector) return null;
  try {
    // Some builds have the class but no 1D support (or no support at all on this device).
    const supported = (await Detector.getSupportedFormats?.()) ?? [...SCAN_FORMATS];
    const formats = SCAN_FORMATS.filter((f) => supported.includes(f));
    if (!formats.includes("ean_13")) return null;
    const detector = new Detector({ formats });
    return {
      kind: "native",
      read: async (frame) => {
        const found = await detector.detect(frame);
        for (const b of found) {
          const code = cleanCode(b.rawValue);
          if (code) return code;
        }
        return null;
      },
    };
  } catch {
    return null;
  }
}

async function zxingReader(): Promise<BarcodeReader> {
  // Loaded only when needed, so phones with a native detector never download it.
  const [{ BrowserMultiFormatOneDReader }, { BarcodeFormat, DecodeHintType: Hint }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const hints = new Map<DecodeHintType, unknown>([
    [Hint.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
    [Hint.TRY_HARDER, true],
  ]);
  const reader = new BrowserMultiFormatOneDReader(hints);
  return {
    kind: "zxing",
    read: async (frame) => {
      try {
        return cleanCode(reader.decodeFromCanvas(frame).getText());
      } catch {
        // zxing throws NotFound (or a checksum or format miss) when there's no readable barcode in the frame.
        return null;
      }
    },
  };
}

/** `frame` turned 90° clockwise onto `out`, so a vertical barcode reads like a horizontal one. */
function rotate90(frame: HTMLCanvasElement, out: HTMLCanvasElement): HTMLCanvasElement | null {
  out.width = frame.height;
  out.height = frame.width;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(out.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(frame, 0, 0);
  return out;
}

/**
 * Any orientation: read the frame as it is, then turned 90°. People hold a can upright, so its barcode is
 * often vertical; 1D readers (zxing above all) scan along rows and miss it unless the frame is turned.
 */
function anyOrientation(reader: BarcodeReader): BarcodeReader {
  const turned = document.createElement("canvas");
  return {
    kind: reader.kind,
    read: async (frame) => {
      const code = await reader.read(frame);
      if (code) return code;
      const rotated = rotate90(frame, turned);
      return rotated ? reader.read(rotated) : null;
    },
  };
}

/** The best reader this browser has, reading barcodes held either way up. */
export async function createBarcodeReader(): Promise<BarcodeReader> {
  return anyOrientation((await nativeReader()) ?? (await zxingReader()));
}
