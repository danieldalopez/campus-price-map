"use client";

import { noteIntent, type BoughtIntent } from "@/lib/bought";
import { directionsUrl } from "@/lib/directions";
import type { Outlet } from "@/lib/types";
import { buttonClasses } from "./Button";

type Props = {
  outlet: Pick<Outlet, "id" | "name" | "lat" | "lng">;
  /** What they're probably going to buy, so "I bought it" can ask about it afterwards (Step 8). */
  item?: BoughtIntent["item"];
  /** The official price shown for that item there. */
  price?: number | null;
  className?: string;
};

/**
 * Opens Google Maps with walking directions to the outlet (SPEC section 7, "Directions"). A plain link, so it
 * works without JavaScript and hands off to the Google Maps app when it's installed. Tapping it also
 * remembers the trip on this phone, so the app can ask "Did you buy it?" later (src/lib/bought.ts).
 */
export function DirectionsButton({ outlet, item = null, price = null, className = "" }: Props) {
  return (
    <a
      href={directionsUrl(outlet)}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses("secondary", "md", className)}
      aria-label={`Directions to ${outlet.name} in Google Maps (opens another app)`}
      onClick={() =>
        noteIntent({
          outlet: { id: outlet.id, name: outlet.name, lat: outlet.lat, lng: outlet.lng },
          item,
          price,
        })
      }
    >
      <span aria-hidden="true">↗</span> Directions
    </a>
  );
}
