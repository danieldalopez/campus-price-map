// Location and walking distance. docs/SPEC.md section 7 ("Location") and guardrail G15.
//
// The maths at the top is shared by the browser and /api/prices. The location store below only runs in the
// browser: it asks for location on the first search or tile tap (never on page load), watches the position
// while the page is visible, and falls back to the AMS Nest. Location is never stored, and it leaves the
// phone only as coordinates rounded to 4 decimals (about 11 m).

export type LatLng = { lat: number; lng: number };

/** Where walk times are measured from when location is off, denied, unavailable or timed out. */
export const AMS_NEST: LatLng = { lat: 49.2666, lng: -123.2499 };
export const NEST_MESSAGE =
  "Using the AMS Nest as your starting point. Turn on location for walk times from where you are.";

export const LOCATION_TIMEOUT_MS = 8_000;
/** Re-sort results only once the student has moved more than this, so the list doesn't jump. */
export const RESORT_METERS = 30;

// Same constants as silver_outlet_distances in databricks/src/price_engine.py, so both numbers agree.
const EARTH_RADIUS_M = 6_371_000;
const WALK_DETOUR = 1.3;
const WALK_M_PER_MIN = 80;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Walk minutes = haversine metres x 1.3 / 80 m per min, rounded up. */
export function walkMinutes(a: LatLng, b: LatLng): number {
  // Exactly the pipeline's expression (ceil(straight_m * 1.3 / 80)), so the two never disagree by a minute.
  return Math.ceil((haversineMeters(a, b) * WALK_DETOUR) / WALK_M_PER_MIN);
}

/** Always "about N min walk". */
export function walkLabel(minutes: number): string {
  return minutes < 1 ? "less than 1 min walk" : `about ${minutes} min walk`;
}

/** 4 decimals, about 11 m: the only precision that ever leaves the phone. */
export function roundCoord(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

export function roundLatLng(p: LatLng): LatLng {
  return { lat: roundCoord(p.lat), lng: roundCoord(p.lng) };
}

// ---------------------------------------------------------------------------------------------------------
// Browser location store. React components read it through useLocation() in src/lib/use-location.ts
// (kept out of this file because /api/prices imports the maths above, and server modules can't import hooks).
// ---------------------------------------------------------------------------------------------------------

/**
 * off: not asked yet. asking: waiting for the first fix (up to 8 s). on: we have a position.
 * fallback: denied, unavailable, timed out or unsupported: walk times are from the AMS Nest.
 */
export type LocationStatus = "off" | "asking" | "on" | "fallback";
export type FallbackReason = "denied" | "unavailable" | "timeout" | "unsupported";

export type LocationState = {
  status: LocationStatus;
  /** Latest fix, for the live dot. Null until location is on. */
  position: LatLng | null;
  /** Accuracy of the latest fix in metres. */
  accuracy: number | null;
  /** Where walk times are measured from. Moves only after the student has gone more than 30 m. */
  origin: LatLng;
  /** True while `origin` is the AMS Nest. */
  usingNest: boolean;
  reason: FallbackReason | null;
};

const INITIAL: LocationState = {
  status: "off",
  position: null,
  accuracy: null,
  origin: AMS_NEST,
  usingNest: true,
  reason: null,
};

let state: LocationState = INITIAL;
const listeners = new Set<() => void>();
/** The student turned location on (first search or tile tap), or had already granted it. */
let wanted = false;
let watchId: number | null = null;
let firstFixTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityHooked = false;

function update(next: Partial<LocationState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function clearFirstFixTimer() {
  if (firstFixTimer !== null) clearTimeout(firstFixTimer);
  firstFixTimer = null;
}

function stopWatch() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearFirstFixTimer();
}

function fallback(reason: FallbackReason) {
  // Keep the last known position if we ever had one: a later timeout shouldn't throw it away.
  if (state.position) return;
  update({ status: "fallback", reason, origin: AMS_NEST, usingNest: true });
}

function onFix(pos: GeolocationPosition) {
  clearFirstFixTimer();
  const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  const moved = state.usingNest || haversineMeters(state.origin, here) > RESORT_METERS;
  update({
    status: "on",
    position: here,
    accuracy: pos.coords.accuracy,
    reason: null,
    ...(moved ? { origin: here, usingNest: false } : {}),
  });
}

function onError(err: GeolocationPositionError) {
  if (err.code === err.PERMISSION_DENIED) {
    stopWatch();
    wanted = false;
    update({ status: "fallback", reason: "denied", position: null, accuracy: null, origin: AMS_NEST, usingNest: true });
    return;
  }
  // Unavailable or timed out: use the Nest for now, but keep watching in case a fix arrives later.
  fallback(err.code === err.TIMEOUT ? "timeout" : "unavailable");
}

function startWatch() {
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(onFix, onError, {
    enableHighAccuracy: true,
    timeout: LOCATION_TIMEOUT_MS,
    maximumAge: 15_000,
  });
  // The API's own timeout only starts once permission is granted; this one also covers an unanswered prompt.
  if (!state.position) {
    clearFirstFixTimer();
    firstFixTimer = setTimeout(() => fallback("timeout"), LOCATION_TIMEOUT_MS);
  }
}

function hookVisibility() {
  if (visibilityHooked) return;
  visibilityHooked = true;
  // Watch only while the page is visible (G15).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stopWatch();
    else if (wanted) startWatch();
  });
}

/**
 * Turn location on. Call it from the first search or tile tap, never on page load.
 * Safe to call again: it only asks once.
 */
export function requestLocation(): void {
  if (typeof navigator === "undefined" || wanted) return;
  if (!("geolocation" in navigator)) {
    update({ status: "fallback", reason: "unsupported" });
    return;
  }
  wanted = true;
  if (state.status !== "on") update({ status: "asking", reason: null });
  hookVisibility();
  if (document.visibilityState !== "hidden") startWatch();
}

/**
 * If the student already allowed location on an earlier visit, start watching without asking (no prompt
 * appears). Otherwise do nothing: the first search or tile tap asks.
 */
export function resumeLocationIfGranted(): void {
  if (typeof navigator === "undefined" || wanted || !navigator.permissions?.query) return;
  navigator.permissions
    .query({ name: "geolocation" })
    .then((status) => {
      if (status.state === "granted") requestLocation();
    })
    .catch(() => {});
}

export function subscribeLocation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getLocationSnapshot = (): LocationState => state;
export const getServerLocationSnapshot = (): LocationState => INITIAL;
