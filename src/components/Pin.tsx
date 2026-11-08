"use client";

// Leaflet touches `window` when imported. Only import this file from a map
// component loaded with dynamic(() => import(...), { ssr: false }) (SPEC rule 9).
import L, { type LeafletKeyboardEvent } from "leaflet";
import { useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { Marker, Popup } from "react-leaflet";
import { tiltFor } from "@/lib/format";
import type { Band } from "@/lib/types";

export type PinKind = "outlet" | "grocery";

const BAND_ICON: Record<Band, string> = { good: "✓", average: "=", high: "↑" };

type PinIconOptions = {
  /** Outlet id: fixes the tilt. */
  id: string;
  /** Tier ("$", "$$", "$$$", "?") on Home, the item price on Results. */
  label: string;
  /** Accessible name, e.g. "Blue Chip Cafe, no price tier yet". */
  description: string;
  /** Estimated tier: shown as "$$ est." with a dashed border. */
  estimated?: boolean;
  /** "grocery" = the grocery baseline: a different shape, labelled "grocery". */
  kind?: PinKind;
  /** Results map: the price band, as the pin's border colour plus its icon next to the price. */
  band?: Band | null;
  /** Results map: the cheapest outlet gets a CHEAPEST stamp. */
  cheapest?: boolean;
  /** Results map: sold out (struck through, plus the words in the accessible name). */
  soldOut?: boolean;
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
  band = null,
  cheapest = false,
  soldOut = false,
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
    // Estimated tier: "$$ est." in words (the dashed border is extra; the full sentence is in the accessible
    // name). No tier yet: a small blank paper tag, no words and no yellow, so it never reads as a price;
    // the accessible name says "no price tier yet".
    const none = label === "?";
    const shown = none ? "" : label;
    const est = estimated && !none ? `<span class="cpm-pin__est">est.</span>` : "";
    const icon = band ? `<span class="cpm-pin__band">${BAND_ICON[band]}</span>` : "";
    const cls = [
      "price-tag cpm-pin__tag",
      none ? "cpm-pin__tag--none" : "",
      estimated && !none ? "cpm-pin__tag--est" : "",
      band ? `cpm-pin__tag--${band}` : "",
      soldOut ? "cpm-pin__tag--sold-out" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const tag = `<span class="${cls}" ${style}>${icon}${shown ? `<span class="cpm-pin__label">${esc(shown)}</span>` : ""}${est}</span>`;
    const stamp = cheapest ? `<span class="stamp stamp--cheapest cpm-pin__stamp">CHEAPEST</span>` : "";
    visual = `<span class="cpm-pin__stack" aria-hidden="true">${stamp}${tag}</span>`;
    width = Math.max(44, shown.length * 11 + (band ? 16 : 0) + (est ? 24 : 0) + 30, cheapest ? 92 : 0);
    if (cheapest) height = 70;
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
  /** Popup content shown on tap or Enter. Ignored when `href` is set. */
  children?: ReactNode;
  /** Tap, Enter or Space opens this page (the outlet page) instead of a popup. */
  href?: string;
  /**
   * Space the popup must keep clear of UI floating over the map
   * ([top, bottom] in px), so auto-pan never hides it under an overlay.
   */
  overlayInsets?: [number, number];
};

/** A tag-shaped map pin. Keyboard focusable (Leaflet gives it role="button"). */
export function Pin({ position, children, href, overlayInsets = [16, 16], ...icon }: PinProps) {
  const { id, label, description, estimated, kind, band, cheapest, soldOut } = icon;
  const router = useRouter();
  const divIcon = useMemo(
    () => pinIcon({ id, label, description, estimated, kind, band, cheapest, soldOut }),
    [id, label, description, estimated, kind, band, cheapest, soldOut],
  );
  // Leaflet makes the pin a focusable role="button"; Enter and Space work like a tap, as on a real button.
  const handlers = useMemo(
    () =>
      href
        ? {
            click: () => router.push(href),
            keypress: (e: LeafletKeyboardEvent) => {
              if (e.originalEvent.key !== "Enter" && e.originalEvent.key !== " ") return;
              e.originalEvent.preventDefault();
              router.push(href);
            },
          }
        : undefined,
    [href, router],
  );
  const [top, bottom] = overlayInsets;
  return (
    <Marker
      position={position}
      icon={divIcon}
      keyboard
      riseOnHover
      zIndexOffset={cheapest ? 500 : 0}
      eventHandlers={handlers}
    >
      {children && !href ? (
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

/** A group of overlapping pins: a yellow square with the count (and, on Results, the lowest price). */
export function clusterIcon({ count, label, description }: { count: number; label?: string; description: string }) {
  const price = label ? `<span class="cpm-cluster__label">${esc(label)}</span>` : "";
  const width = Math.max(48, label ? label.length * 10 + 52 : 0);
  return L.divIcon({
    className: "cpm-pin cpm-cluster",
    html:
      `<span class="cpm-cluster__stack" aria-hidden="true">${price}<span class="cpm-cluster__count">${count}</span></span>` +
      `<span class="sr-only">${esc(description)}</span>`,
    iconSize: [width, 48],
    iconAnchor: [width / 2, 24],
    popupAnchor: [0, -24],
  });
}
