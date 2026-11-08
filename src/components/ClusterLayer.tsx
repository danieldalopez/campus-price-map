"use client";

// Pins that group when they would overlap (zoomed out). Only import from a map component loaded with
// dynamic(..., { ssr: false }) (SPEC rule 9).
import L from "leaflet";
import { useMemo, useState, type ReactNode } from "react";
import { Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import { clusterByDistance, type Spacing } from "@/lib/cluster";
import type { Band } from "@/lib/types";
import { Pin, clusterIcon, type PinKind } from "./Pin";

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  /** Tier on Home, this item's price on Results. */
  label: string;
  /** The pin's accessible name. */
  description: string;
  /** One line for this pin in a group's list (when the map can't zoom in any further). */
  summary: string;
  popup: ReactNode;
  kind?: PinKind;
  estimated?: boolean;
  band?: Band | null;
  cheapest?: boolean;
  soldOut?: boolean;
};

type Props = {
  /** Most important first (e.g. cheapest): the first point of a group decides where the group sits. */
  points: MapPoint[];
  overlayInsets?: [number, number];
  /** Text on a group, e.g. "from $3.59" on Results. */
  clusterLabel?: (members: MapPoint[]) => string | undefined;
  /** Pins closer than this on both axes (screen pixels) are grouped: about one pin's width and height. */
  spacing?: Spacing;
};

const TAG_PIN: Spacing = { x: 52, y: 44 };

export function ClusterLayer({ points, overlayInsets, clusterLabel, spacing = TAG_PIN }: Props) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const groups = useMemo(
    () => clusterByDistance(points, (p) => map.project([p.lat, p.lng], zoom), spacing),
    [points, map, zoom, spacing],
  );
  const atMaxZoom = zoom >= map.getMaxZoom();

  return groups.map((members) => {
    if (members.length === 1) {
      const p = members[0];
      return (
        <Pin
          key={p.id}
          id={p.id}
          position={[p.lat, p.lng]}
          label={p.label}
          description={p.description}
          kind={p.kind}
          estimated={p.estimated}
          band={p.band}
          cheapest={p.cheapest}
          soldOut={p.soldOut}
          overlayInsets={overlayInsets}
        >
          {p.popup}
        </Pin>
      );
    }
    return (
      <ClusterPin
        key={members.map((m) => m.id).join("|")}
        members={members}
        label={clusterLabel?.(members)}
        atMaxZoom={atMaxZoom}
        overlayInsets={overlayInsets}
      />
    );
  });
}

type ClusterPinProps = {
  members: MapPoint[];
  label: string | undefined;
  atMaxZoom: boolean;
  overlayInsets?: [number, number];
};

/** Tap to zoom in on the group; at the closest zoom, tap to list what's there instead. */
function ClusterPin({ members, label, atMaxZoom, overlayInsets = [16, 16] }: ClusterPinProps) {
  const map = useMap();
  // Drawn at its first (most important) point, which is what keeps groups from overlapping each other.
  const center: [number, number] = [members[0].lat, members[0].lng];
  const description = atMaxZoom
    ? `${members.length} outlets here. Open the list.`
    : `${members.length} outlets here${label ? `, ${label}` : ""}. Zoom in to see them.`;
  const icon = useMemo(
    () => clusterIcon({ count: members.length, label, description }),
    [members.length, label, description],
  );

  function zoomIn() {
    const bounds = L.latLngBounds(members.map((m) => [m.lat, m.lng] as [number, number]));
    const max = map.getMaxZoom();
    const current = map.getZoom();
    let target = Math.min(map.getBoundsZoom(bounds.pad(0.6)), max);
    if (target <= current) target = Math.min(current + 2, max);
    map.setView(bounds.getCenter(), target);
  }

  const [top, bottom] = overlayInsets;
  return (
    <Marker
      position={center}
      icon={icon}
      keyboard
      riseOnHover
      zIndexOffset={members.some((m) => m.cheapest) ? 500 : 0}
      eventHandlers={atMaxZoom ? undefined : { click: zoomIn }}
    >
      {atMaxZoom ? (
        <Popup minWidth={200} autoPanPaddingTopLeft={[16, top]} autoPanPaddingBottomRight={[72, bottom]}>
          <p className="m-0 font-heading text-lg font-extrabold leading-tight">{members.length} outlets here</p>
          <ul className="m-0 mt-1 list-none p-0">
            {members.map((m) => (
              <li key={m.id} className="mt-1">
                {m.summary}
              </li>
            ))}
          </ul>
        </Popup>
      ) : null}
    </Marker>
  );
}
