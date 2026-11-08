// "I bought it" (docs/SPEC.md Step 8): remembering that a student probably went to buy something, so the app
// can ask them afterwards what they paid. Browser only. Kept in localStorage on this phone, never sent:
// it's a guess about where someone went, so it stays with them.
//
// A guess starts when the student taps Directions to an outlet. The app asks once, a few minutes later (or
// as soon as they're standing at the outlet), and never again for that trip. Asking is never forced.

type LatLng = { lat: number; lng: number };

/** Straight-line metres (same formula as src/lib/geo.ts; kept here so the tests can import this file alone). */
function metres(a: LatLng, b: LatLng): number {
  const r = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

const KEY = "cpm.bought_intent";

/** Ask no sooner than this after they set off, unless they're already at the outlet. */
export const ASK_AFTER_MS = 4 * 60_000;
/** After this the trip is old news: drop it without asking. */
export const FORGET_AFTER_MS = 3 * 60 * 60_000;
/** Within this many metres of the outlet counts as being there. */
export const AT_OUTLET_M = 40;

export type BoughtIntent = {
  outlet: { id: string; name: string; lat: number; lng: number };
  /** Known when they set off from an item's page (Worth the walk); otherwise they pick it. */
  item: { id: string; name: string; size: string } | null;
  /** The official price shown when they set off, to prefill "What did you pay?". */
  price: number | null;
  /** When they tapped Directions (ms since epoch). */
  at: number;
};

function read(): BoughtIntent | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as BoughtIntent;
    return v && typeof v.at === "number" && v.outlet?.id ? v : null;
  } catch {
    return null;
  }
}

/** Remember the trip. A newer trip replaces an older one. */
export function noteIntent(intent: Omit<BoughtIntent, "at">): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...intent, at: Date.now() }));
  } catch {
    // Storage blocked: we just won't ask.
  }
}

/** Forget the trip: asked, answered or dismissed. Never ask twice. */
export function clearIntent(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}

/** The trip to ask about now, if any. Old trips are forgotten here. */
export function dueIntent(now: number, position: LatLng | null): BoughtIntent | null {
  const intent = read();
  if (!intent) return null;
  const age = now - intent.at;
  if (age > FORGET_AFTER_MS || age < 0) {
    clearIntent();
    return null;
  }
  const atOutlet = position !== null && metres(position, intent.outlet) <= AT_OUTLET_M;
  return age >= ASK_AFTER_MS || (atOutlet && age >= 30_000) ? intent : null;
}
