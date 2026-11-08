"use client";

// Loaded only through dynamic(() => import("./ResultsMap"), { ssr: false }) (SPEC rule 9).
import L from "leaflet";
import { useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import { formatPrice } from "@/lib/format";
import type { LatLng } from "@/lib/geo";
import { walkLabel } from "@/lib/geo";
import { MAX_ZOOM } from "@/lib/outlet";
import { compareRows, isComparable } from "@/lib/pricing";
import type { Band, PriceRow } from "@/lib/types";
import { ClusterLayer, type MapPoint } from "./ClusterLayer";
import { LocationDot } from "./LocationDot";

const BAND_WORD: Record<Band, string> = { good: "Good price", average: "Average", high: "High" };

// Where walk times start when location is off (the line above the map says so in words). Small and under
// the pins, because most outlets are right around the Nest.
const START = L.divIcon({
  className: "cpm-start",
  html: '<span class="cpm-start__dot" aria-hidden="true"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/** Price pins are wider than tier pins: group them a bit sooner. */
const PRICE_PIN = { x: 112, y: 48 };

type Props = {
  rows: PriceRow[];
  cheapestId: string | null;
  origin: LatLng;
  usingNest: boolean;
  position: LatLng | null;
  accuracy: number | null;
};

function toPoint(row: PriceRow & { price: number }, cheapestId: string | null): MapPoint {
  const price = formatPrice(row.price);
  const walk = row.walk_min === null ? null : walkLabel(row.walk_min);
  const soldOut = row.stock === "sold_out";
  const cheapest = row.outlet.id === cheapestId;
  const parts = [
    row.outlet.name,
    price,
    row.band ? BAND_WORD[row.band] : null,
    cheapest ? "cheapest" : null,
    soldOut ? "sold out" : null,
    walk,
  ].filter(Boolean);
  return {
    id: row.outlet.id,
    lat: row.outlet.lat,
    lng: row.outlet.lng,
    label: price,
    band: row.band,
    cheapest,
    soldOut,
    description: parts.join(", "),
    summary: `${row.outlet.name}: ${price}${soldOut ? " (sold out)" : ""}`,
    popup: (
      <>
        <p className="m-0 font-heading text-lg font-extrabold leading-tight">{row.outlet.name}</p>
        <p className="m-0 mt-1 font-mono font-bold">{price}</p>
        {row.band ? <p className="m-0 mt-1">{BAND_WORD[row.band]}</p> : null}
        {walk ? <p className="m-0 mt-1 text-ink-2">{walk}</p> : null}
        {soldOut ? <p className="m-0 mt-1 font-bold">Sold out</p> : null}
        <p className="m-0 mt-2">
          <a href={`/outlet/${encodeURIComponent(row.outlet.id)}`} className="font-bold text-ink underline">
            Everything at {row.outlet.name}
          </a>
        </p>
      </>
    ),
  };
}

/** Small map on Results: pins show this item's official price; the cheapest pin gets a CHEAPEST stamp. */
export default function ResultsMap({ rows, cheapestId, origin, usingNest, position, accuracy }: Props) {
  const [animate] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // Cheapest first, so a group of pins sits where its best price is.
  const points = useMemo(
    () =>
      rows
        .filter((r): r is PriceRow & { price: number } => r.price !== null)
        .sort(compareRows)
        .map((r) => toPoint(r, cheapestId)),
    [rows, cheapestId],
  );

  // Open on the start point and the closest few outlets that have a price.
  const [bounds] = useState(() => {
    const closest = rows
      .filter(isComparable)
      .sort((a, b) => (a.walk_min ?? 0) - (b.walk_min ?? 0))
      .slice(0, 6);
    return L.latLngBounds([[origin.lat, origin.lng], ...closest.map((r) => [r.outlet.lat, r.outlet.lng] as [number, number])]);
  });

  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={{ padding: [36, 36], maxZoom: 17 }}
      maxZoom={MAX_ZOOM}
      zoomAnimation={animate}
      fadeAnimation={animate}
      markerZoomAnimation={animate}
      scrollWheelZoom={false}
      className="h-full w-full"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={MAX_ZOOM}
      />
      {usingNest ? (
        <Marker
          position={[origin.lat, origin.lng]}
          icon={START}
          interactive={false}
          keyboard={false}
          zIndexOffset={-1000}
        />
      ) : null}
      <ClusterLayer
        points={points}
        spacing={PRICE_PIN}
        clusterLabel={(members) => `from ${members[0]?.label ?? ""}`}
      />
      {position ? <LocationDot position={position} accuracy={accuracy} /> : null}
    </MapContainer>
  );
}
