"use client";

// Loaded only through dynamic(() => import("./HomeMap"), { ssr: false }) (SPEC rule 9).
import { useState, type CSSProperties } from "react";
import { MapContainer, TileLayer, ZoomControl } from "react-leaflet";
import { HOME_ZOOM, UBC_CENTRE, type Outlet } from "@/lib/outlet";
import { Pin } from "./Pin";

type Props = { outlets: Outlet[] };

/**
 * Height in px of the UI floating over the top and bottom of the map
 * (elements marked data-map-overlay), including safe areas. This component only
 * renders in the browser, after HomeScreen has mounted, so the DOM is there.
 */
function measureOverlays(): [number, number] {
  const top = document.querySelector('[data-map-overlay="top"]');
  const bottom = document.querySelector('[data-map-overlay="bottom"]');
  const topPx = top ? top.getBoundingClientRect().bottom : 0;
  const bottomPx = bottom ? window.innerHeight - bottom.getBoundingClientRect().top : 0;
  return [Math.ceil(topPx) + 8, Math.ceil(bottomPx) + 8];
}

function describe(o: Outlet): string {
  return o.isBenchmark
    ? `${o.name}, grocery baseline`
    : `${o.name}, no price tier yet`;
}

/** Full-screen paper-tinted map with a tag pin per outlet. */
export default function HomeMap({ outlets }: Props) {
  // No zoom or fade animation for people who asked for reduced motion.
  const [animate] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [overlayInsets] = useState(measureOverlays);
  // Keeps the zoom buttons and the OSM attribution visible above the bottom bar.
  const style = { "--home-bottom-ui": `${overlayInsets[1]}px` } as CSSProperties;

  return (
    <MapContainer
      center={UBC_CENTRE}
      zoom={HOME_ZOOM}
      zoomControl={false}
      zoomAnimation={animate}
      fadeAnimation={animate}
      markerZoomAnimation={animate}
      className="home-map h-full w-full"
      style={style}
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <ZoomControl position="bottomright" />
      {outlets.map((o) => (
        <Pin
          key={o.id}
          id={o.id}
          position={[o.lat, o.lng]}
          // No outlet_scores yet (D5), so every outlet shows "?".
          label={o.isBenchmark ? "" : "?"}
          kind={o.isBenchmark ? "grocery" : "outlet"}
          description={describe(o)}
          overlayInsets={overlayInsets}
        >
          <p className="m-0 font-heading text-lg font-extrabold leading-tight">{o.name}</p>
          {o.area ? <p className="m-0 mt-1 text-ink-2">{o.area}</p> : null}
          <p className="m-0 mt-1">
            {o.isBenchmark ? "Grocery baseline, for comparison only" : "No price tier yet"}
          </p>
        </Pin>
      ))}
    </MapContainer>
  );
}
