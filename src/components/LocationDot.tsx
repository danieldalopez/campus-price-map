"use client";

// Only import from a map component loaded with dynamic(..., { ssr: false }) (SPEC rule 9).
import L from "leaflet";
import { Circle, Marker } from "react-leaflet";
import type { LatLng } from "@/lib/geo";

const DOT = L.divIcon({
  className: "cpm-dot",
  html: '<span class="cpm-dot__ring" aria-hidden="true"></span><span class="cpm-dot__core" aria-hidden="true"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/**
 * The student's live location dot. Decorative on the map (the location line in text says where walk times
 * are measured from), so it's not focusable and screen readers skip it.
 */
export function LocationDot({ position, accuracy }: { position: LatLng; accuracy: number | null }) {
  const at: [number, number] = [position.lat, position.lng];
  return (
    <>
      {accuracy !== null && accuracy > 15 && accuracy < 300 ? (
        <Circle
          center={at}
          radius={accuracy}
          interactive={false}
          pathOptions={{ color: "#2563EB", weight: 1, fillColor: "#2563EB", fillOpacity: 0.12, opacity: 0.5 }}
        />
      ) : null}
      <Marker position={at} icon={DOT} interactive={false} keyboard={false} zIndexOffset={1000} />
    </>
  );
}
