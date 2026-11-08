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
/** The "location is blocked" help fades away after this, so it doesn't sit on the map. */
const HELP_MS = 12_000;

/** Steps to allow location for this site, for the phone in hand. */
function allowSteps(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) {
    return "Your phone blocked location for this site. To allow it: tap the page icon at the left of the address bar (it looks like aA or a small page) → Website Settings → Location → Allow. Or: Settings app → Safari (under Apps) → Location → Allow. It turns on as soon as you come back.";
  }
  if (/Android/.test(ua)) {
    return "Your phone blocked location for this site. To allow it: tap the icon left of the address → Permissions → Location → Allow. It turns on as soon as you come back.";
  }
  return "Your browser blocked location for this site. Allow it in the site settings (the icon left of the address). It turns on as soon as you come back.";
}

/**
 * The location button on the home map, stacked above the zoom buttons.
 * - Off: tap to turn location on. The phone asks for permission if it's allowed to ask again.
 * - On: tap to turn it off (remembered on this phone).
 * - Blocked: the phone won't ask again (a browser rule no site can override), so a note says how to allow
 *   it. The note fades after a few seconds or on ✕, and location turns on by itself once it's allowed.
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
  // The blocked note, shown after a tap that ended in "denied", until it fades or is closed.
  const [help, setHelp] = useState<string | null>(null);
  const tapped = useRef(false);

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

  // A tap that ended in "denied": show the steps, then fade them out.
  useEffect(() => {
    if (!denied || !tapped.current) return;
    tapped.current = false;
    const show = setTimeout(() => setHelp(allowSteps()), 0);
    const hide = setTimeout(() => setHelp(null), HELP_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [denied]);

  // Once it's blocked, watch the permission: when they allow it in settings and come back, turn on by itself.
  useEffect(() => {
    if (!denied || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    const onChange = () => {
      if (status?.state === "granted") {
        centreOnFix.current = true;
        setHelp(null);
        requestLocation();
      }
    };
    navigator.permissions
      .query({ name: "geolocation" })
      .then((s) => {
        status = s;
        s.addEventListener("change", onChange);
      })
      .catch(() => {});
    return () => status?.removeEventListener("change", onChange);
  }, [denied]);

  function toggle() {
    if (on || asking) {
      turnOffLocation();
      setHelp(null);
      return;
    }
    // Off, or blocked earlier: ask again. If the phone still allows a prompt, it shows one now.
    centreOnFix.current = true;
    tapped.current = true;
    setHelp(null);
    requestLocation();
  }

  const label = on
    ? "Location is on. Turn it off"
    : asking
      ? "Finding your location. Tap to cancel"
      : "Location is off. Turn it on to see where you are";

  return createPortal(
    <div className="flex flex-col items-end gap-1">
      {help ? (
        <div
          role="status"
          className="flex max-w-64 items-start gap-1 rounded-tag border-2 border-ink bg-card p-2 text-sm shadow-ink"
        >
          <p className="m-0">{help}</p>
          <button
            type="button"
            onClick={() => setHelp(null)}
            aria-label="Close"
            className="-m-1 flex h-10 w-10 shrink-0 items-center justify-center text-lg font-bold"
          >
            ✕
          </button>
        </div>
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
