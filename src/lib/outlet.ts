// Map constants and outlet wording shared by Home and Results. docs/SPEC.md sections 7 and 11.

import type { Outlet } from "./types";

/** UBC map centre and zoom for Home (SPEC section 7). */
export const UBC_CENTRE: [number, number] = [49.2606, -123.246];
export const HOME_ZOOM = 15;
/** OpenStreetMap's tile server goes to 19. */
export const TILE_MAX_ZOOM = 19;
/** One step past the tiles (they're stretched 2x) so the packed University Village pins come apart. */
export const MAX_ZOOM = TILE_MAX_ZOOM + 1;

/** The tier is never colour or symbol alone: list view and screen readers get these words (section 11). */
export function tierWords(outlet: Pick<Outlet, "tier" | "tier_basis" | "is_benchmark">): string {
  if (outlet.is_benchmark) return "Grocery baseline, for comparison only";
  if (!outlet.tier) return "No price tier yet";
  const word =
    outlet.tier === "$" ? "cheaper than average" : outlet.tier === "$$" ? "about average" : "pricier than average";
  return outlet.tier_basis === "estimated"
    ? `Probably ${word} · estimated from few prices and similar outlets`
    : `${word[0].toUpperCase()}${word.slice(1)}`;
}

/** The pin label: "$", "$$", "$$$" or "?" (no tier yet). */
export function tierLabel(outlet: Pick<Outlet, "tier">): string {
  return outlet.tier ?? "?";
}

/** "approximate location" for outlets placed at their building's or area's centroid (section 6). */
export function isApproximate(precision: Outlet["location_precision"]): boolean {
  return precision !== "exact";
}
