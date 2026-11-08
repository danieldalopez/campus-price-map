// Brand + size → tracked item, for scanned products we don't have an exact barcode for (docs/SPEC.md G16,
// version 15). Energy drinks and soft drinks are priced by brand and size, not flavour: a Red Bull Sugarfree
// 250 ml costs the same as a Red Bull 250 ml, so it counts as I01. Pure, no imports, so the tests can load it.

/** One brand's tracked sizes: millilitres → item id. */
const FAMILIES: { brand: RegExp; sizes: Record<number, string> }[] = [
  { brand: /red\s*bull/, sizes: { 250: "I01", 355: "I22", 473: "I24" } },
  { brand: /monster/, sizes: { 473: "I02" } },
  { brand: /celsius/, sizes: { 355: "I03" } },
  { brand: /coca[\s-]*cola|\bcoke\b/, sizes: { 355: "I04", 591: "I05" } },
];

/** US fluid ounces printed on cans → the metric size they're sold as. */
const FL_OZ_TO_ML: Record<string, number> = { "8.4": 250, "12": 355, "16": 473, "20": 591 };

/** A size within this many ml of a tracked size counts as it (labels round: 250 / 248, 473 / 475). */
const TOLERANCE_ML = 6;

/** Multipacks are priced differently: "4 x 250 ml", "12 pack", "24 cans". */
const MULTIPACK = /(\d+\s*[x×]\s*\d)|\bpack\b|\bcase\b|\b(\d{1,2})\s*(cans|bottles)\b/;

/** The container size in ml from a quantity like "250 mL", "355ml", "0.5 l", "12 fl oz"; null if unclear. */
export function sizeInMl(quantity: string): number | null {
  const q = quantity.toLowerCase().replace(",", ".");
  const ml = q.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (ml) return Math.round(Number(ml[1]));
  const cl = q.match(/(\d+(?:\.\d+)?)\s*cl\b/);
  if (cl) return Math.round(Number(cl[1]) * 10);
  const l = q.match(/(\d+(?:\.\d+)?)\s*l\b/);
  if (l) return Math.round(Number(l[1]) * 1000);
  const oz = q.match(/(\d+(?:\.\d+)?)\s*(?:us\s*)?fl\.?\s*oz/);
  if (oz) return FL_OZ_TO_ML[String(Number(oz[1]))] ?? Math.round(Number(oz[1]) * 29.5735);
  return null;
}

/**
 * The tracked item a scanned product counts as, by brand and size only, or null. `name` and `brands` are
 * Open Food Facts' product_name and brands; `quantity` is its quantity text (falls back to the name).
 */
export function itemForVariant(name: string | null, brands: string | null, quantity: string | null): string | null {
  const text = `${brands ?? ""} ${name ?? ""}`.toLowerCase();
  const sizeText = `${quantity ?? ""} ${name ?? ""}`.toLowerCase();
  if (MULTIPACK.test(sizeText)) return null;
  const family = FAMILIES.find((f) => f.brand.test(text));
  if (!family) return null;
  const ml = sizeInMl(quantity ?? "") ?? sizeInMl(name ?? "");
  if (ml === null) return null;
  for (const [size, id] of Object.entries(family.sizes)) {
    if (Math.abs(ml - Number(size)) <= TOLERANCE_ML) return id;
  }
  return null;
}

/**
 * A tracked brand whose size we couldn't read: every tracked size of that brand, so the scanner can ask
 * "Which size?" instead of showing every item. Empty for multipacks and brands we don't track.
 */
export function familyCandidates(name: string | null, brands: string | null, quantity: string | null): string[] {
  const text = `${brands ?? ""} ${name ?? ""}`.toLowerCase();
  if (MULTIPACK.test(`${quantity ?? ""} ${name ?? ""}`.toLowerCase())) return [];
  // A readable size that isn't tracked (Monster 355 ml) is "we don't track it", not "which size?".
  if ((sizeInMl(quantity ?? "") ?? sizeInMl(name ?? "")) !== null) return [];
  const family = FAMILIES.find((f) => f.brand.test(text));
  return family ? Object.values(family.sizes) : [];
}
