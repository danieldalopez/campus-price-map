import { directionsUrl } from "@/lib/directions";
import type { Outlet } from "@/lib/types";
import { buttonClasses } from "./Button";

type Props = {
  outlet: Pick<Outlet, "name" | "lat" | "lng">;
  className?: string;
};

/**
 * Opens Google Maps with walking directions to the outlet (SPEC section 7, "Directions"). A plain link, so it
 * works without JavaScript and hands off to the Google Maps app when it's installed.
 */
export function DirectionsButton({ outlet, className = "" }: Props) {
  return (
    <a
      href={directionsUrl(outlet)}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses("secondary", "md", className)}
      aria-label={`Directions to ${outlet.name} in Google Maps (opens another app)`}
    >
      <span aria-hidden="true">↗</span> Directions
    </a>
  );
}
