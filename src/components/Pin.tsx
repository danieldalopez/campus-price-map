"use client";

// Leaflet touches `window` when imported. Only import this file from a map
// component loaded with dynamic(() => import(...), { ssr: false }) (SPEC rule 9).
import L from "leaflet";
import { useMemo, type ReactNode } from "react";
import { Marker, Popup } from "react-leaflet";
import { tiltFor } from "@/lib/format";

export type PinKind = "outlet" | "grocery";

type PinIconOptions = {
  /** Outlet id: fixes the tilt. */
  id: string;
  /** Tier ("$", "$$", "$$$", "?") on Home, the item price on Results. */
  label: string;
  /** Accessible name, e.g. "Blue Chip Cafe, no price tier yet". */
  description: string;
  /** Estimated tier: adds the word "est." (the dashed border is extra). */
  estimated?: boolean;
  /** "grocery" = the grocery baseline: a different shape, labelled "grocery". */
  kind?: PinKind;
};

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/**
 * The pin as an L.divIcon (no default marker images): a small PriceTag.
 * The icon box is the hit area, 44 px minimum in both directions.
 */
export function pinIcon({
  id,
  label,
  description,
  estimated = false,
  kind = "outlet",
}: PinIconOptions): L.DivIcon {
  const tilt = tiltFor(id);
  const style = `style="--tilt:${tilt}deg"`;
  let visual: string;
  let width: number;
  let height = 44;

  if (kind === "grocery") {
    const top = label ? `<span class="cpm-pin__grocery-label">${esc(label)}</span>` : "";
    visual = `<span class="cpm-pin__grocery" ${style} aria-hidden="true">${top}grocery</span>`;
    width = Math.max(64, label.length * 10 + 24);
    height = label ? 52 : 44;
  } else {
    const est = estimated ? `<span class="cpm-pin__est">est.</span>` : "";
    const cls = `price-tag cpm-pin__tag${estimated ? " cpm-pin__tag--est" : ""}`;
    visual = `<span class="${cls}" ${style} aria-hidden="true">${esc(label)}${est}</span>`;
    width = Math.max(44, label.length * 11 + (estimated ? 30 : 0) + 30);
  }

  return L.divIcon({
    className: "cpm-pin",
    html: `${visual}<span class="sr-only">${esc(description)}</span>`,
    iconSize: [width, height],
    iconAnchor: [width / 2, height / 2],
    popupAnchor: [0, -height / 2],
  });
}

type PinProps = PinIconOptions & {
  position: [number, number];
  /** Popup content shown on tap or Enter. */
  children?: ReactNode;
  /**
   * Space the popup must keep clear of UI floating over the map
   * ([top, bottom] in px), so auto-pan never hides it under an overlay.
   */
  overlayInsets?: [number, number];
};

/** A tag-shaped map pin. Keyboard focusable (Leaflet gives it role="button"). */
export function Pin({ position, children, overlayInsets = [16, 16], ...icon }: PinProps) {
  const { id, label, description, estimated, kind } = icon;
  const divIcon = useMemo(
    () => pinIcon({ id, label, description, estimated, kind }),
    [id, label, description, estimated, kind],
  );
  const [top, bottom] = overlayInsets;
  return (
    <Marker position={position} icon={divIcon} keyboard riseOnHover>
      {children ? (
        <Popup
          minWidth={180}
          autoPanPaddingTopLeft={[16, top]}
          autoPanPaddingBottomRight={[72, bottom]}
        >
          {children}
        </Popup>
      ) : null}
    </Marker>
  );
}
