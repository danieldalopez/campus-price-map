// Group map pins that would overlap when zoomed out. No library: a greedy pass in screen pixels.
// docs/SPEC.md section 7 (Home map) and the Results map.

export type Projected = { x: number; y: number };
/** How close two pins can be, in screen pixels, before they're grouped (about a pin's width and height). */
export type Spacing = { x: number; y: number };

/**
 * Greedy clustering. Points are taken in the order given (put the most important first, e.g. the cheapest
 * price): each joins the first group whose first point is within `spacing` on both axes, or starts a new
 * group. Groups are drawn at their first point, so no two groups are ever closer than `spacing`.
 */
export function clusterByDistance<T>(points: readonly T[], position: (p: T) => Projected, spacing: Spacing): T[][] {
  const clusters: { seed: Projected; members: T[] }[] = [];
  for (const point of points) {
    const at = position(point);
    const home = clusters.find((c) => Math.abs(c.seed.x - at.x) < spacing.x && Math.abs(c.seed.y - at.y) < spacing.y);
    if (home) home.members.push(point);
    else clusters.push({ seed: at, members: [point] });
  }
  return clusters.map((c) => c.members);
}
