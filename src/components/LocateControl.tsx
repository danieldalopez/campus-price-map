"use client";

// Loaded only inside HomeMap (client only, SPEC rule 9).
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";
import { requestLocation, turnOffLocation } from "@/lib/geo";
import { useLocation } from "@/lib/use-location";

/** Zoom used when centring on the student. */
const HERE_ZOOM = 17;

/**
 * The location button on the home map, stacked above the zoom buttons: tap to turn location on (the browser
 * asks the first time) and centre the map on you; tap again to turn it off. Off is remembered on this phone.
 * The state is in words for screen readers, and in the icon and fill for everyone else.
 */
export function LocateControl() {
  const map = useMap();
  const location = useLocation();
  const [container] = useState(() => {
    const div = L.DomUtil.create("div", "leaflet-control cpm-locate");
    L.DomEvent.disableClickPropagation(div);
    return div;
  });
  // Set when the student turns location on: centre the map on their first fix.
  const centreOnFix = useRef(false);

  useEffect(() => {
    const Control = L.Control.extend({ onAdd: () => container });
    const control = new Control({ position: "bottomright" });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, container]);

  useEffect(() => {
    if (centreOnFix.current && location.position) {
      centreOnFix.current = false;
      map.flyTo([location.position.lat, location.position.lng], Math.max(map.getZoom(), HERE_ZOOM));
    }
  }, [map, location.position]);

  const on = location.status === "on";
  const asking = location.status === "asking";
  const denied = location.status === "fallback" && location.reason === "denied";

  function toggle() {
    if (on || asking) {
      turnOffLocation();
      return;
    }
    centreOnFix.current = true;
    requestLocation();
  }

  const label = on
    ? "Location is on. Turn it off"
    : asking
      ? "Finding your location. Tap to cancel"
      : "Location is off. Turn it on to see where you are";

  return createPortal(
    <div className="flex flex-col items-end gap-1">
      {denied ? (
        <p role="status" className="max-w-56 rounded-tag border-2 border-ink bg-card p-2 text-sm shadow-ink">
          Location is blocked for this site. Allow it in your browser&apos;s site settings, then tap again.
        </p>
      ) : null}
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        aria-label={label}
        title={label}
        className={`flex h-12 w-12 items-center justify-center rounded-tag border-2 border-ink text-2xl shadow-ink ${
          on ? "bg-ink text-card" : "bg-card text-ink"
        }`}
      >
        <span aria-hidden="true">{asking ? "…" : on ? "◉" : "◎"}</span>
      </button>
    </div>,
    container,
  );
}
