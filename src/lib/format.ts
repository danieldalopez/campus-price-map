/** "$3.25". Every price in the app goes through this. */
export function formatPrice(price: number): string {
  // "$1,456.00" for big projections; below 1,000 nothing changes.
  return Math.abs(price) < 1000
    ? `$${price.toFixed(2)}`
    : `$${price.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "3 dollars 25", for screen readers and Read aloud. */
export function spokenPrice(price: number): string {
  const cents = Math.round(price * 100);
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  if (dollars === 0) return `${rest} cents`;
  const d = `${dollars} ${dollars === 1 ? "dollar" : "dollars"}`;
  return rest === 0 ? d : `${d} ${rest}`;
}

/**
 * A fixed tilt between -2 and 2 degrees for a given id (an outlet id for
 * PriceTags and pins). Same id, same tilt, every render: never random.
 */
export function tiltFor(id: string): number {
  // FNV-1a, 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const unit = (h >>> 0) / 0xffffffff; // 0..1
  return Math.round((unit * 4 - 2) * 10) / 10;
}
