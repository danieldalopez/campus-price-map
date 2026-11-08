// Walking directions hand off to Google Maps (docs/SPEC.md section 7, "Directions"). The app does no routing.
// No `origin` in the link: Google Maps starts from the phone's own location, so the student's position is
// never put in a URL (G15).

import type { Outlet } from "./types";

/** A Google Maps "directions" URL (no API key) for walking to the outlet. */
export function directionsUrl(outlet: Pick<Outlet, "lat" | "lng">): string {
  const params = new URLSearchParams({
    api: "1",
    destination: `${outlet.lat},${outlet.lng}`,
    travelmode: "walking",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
