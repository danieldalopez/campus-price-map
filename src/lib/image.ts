// Photo compression on the phone, before upload (docs/SPEC.md section 7, Snap step 2; guardrail G5).
// Browser only: uses a canvas. Long edge 1280 px at JPEG quality 0.8. What we send is the base64 string, so
// that's what is measured: over 2.5 MB, redo at 1024 px and quality 0.6.

export type CompressedPhoto = {
  /** JPEG as base64, without the "data:image/jpeg;base64," prefix. */
  base64: string;
  /** The same JPEG as a data URL, for an on-screen preview. Never stored. */
  dataUrl: string;
  width: number;
  height: number;
};

const FIRST = { edge: 1280, quality: 0.8 };
const FALLBACK = { edge: 1024, quality: 0.6 };
/** 2.5 MB of base64 characters. */
const TARGET_BASE64 = 2_500_000;
const PREFIX = "data:image/jpeg;base64,";

export class PhotoDecodeError extends Error {}

type Source = { image: CanvasImageSource; width: number; height: number; close: () => void };

/** Decode with the photo's EXIF rotation applied, so a portrait shot isn't sent sideways. */
async function decode(file: Blob): Promise<Source> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Some browsers can't decode every format this way; try an <img> below.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } catch {
    throw new PhotoDecodeError("We couldn't open that photo.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(src: Source, edge: number, quality: number): CompressedPhoto {
  const scale = Math.min(1, edge / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoDecodeError("This browser can't prepare photos.");
  // JPEG has no transparency: paint white first so a transparent PNG doesn't turn black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(src.image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  if (!dataUrl.startsWith(PREFIX)) throw new PhotoDecodeError("This browser can't prepare photos.");
  return { base64: dataUrl.slice(PREFIX.length), dataUrl, width, height };
}

/** Shrink a camera photo to a JPEG small enough to send. Throws PhotoDecodeError if it can't be read. */
export async function compressPhoto(file: Blob): Promise<CompressedPhoto> {
  const src = await decode(file);
  try {
    const first = encode(src, FIRST.edge, FIRST.quality);
    if (first.base64.length <= TARGET_BASE64) return first;
    return encode(src, FALLBACK.edge, FALLBACK.quality);
  } finally {
    src.close();
  }
}
