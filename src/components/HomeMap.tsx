"use client";

// Loaded only through dynamic(() => import("./HomeMap"), { ssr: false }) (SPEC rule 9).
import { useMemo, useState, type CSSProperties } from "react";
import { MapContainer, TileLayer, ZoomControl } from "react-leaflet";
import { isApproximate, HOME_ZOOM, MAX_ZOOM, tierLabel, tierWords, UBC_CENTRE } from "@/lib/outlet";
import type { Outlet } from "@/lib/types";
import { useLocation } from "@/lib/use-location";
import { ClusterLayer, type MapPoint } from "./ClusterLayer";
import { LocateControl } from "./LocateControl";
import { LocationDot } from "./LocationDot";
import { outletHref } from "./OutletLink";

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

/** Tapping a pin opens the outlet's page (name, today's hours, prices, full menu). */
function toPoint(o: Outlet): MapPoint {
  const words = tierWords(o);
  const approx = isApproximate(o.location_precision) ? ", approximate location" : "";
  return {
    id: o.id,
    lat: o.lat,
    lng: o.lng,
    label: o.is_benchmark ? "" : tierLabel(o),
    kind: o.is_benchmark ? "grocery" : "outlet",
    estimated: o.tier_basis === "estimated",
    description: `${o.name}, ${words}${approx}. Opens its prices and menu.`,
    summary: `${o.name}: ${o.is_benchmark ? "grocery baseline" : tierLabel(o)}`,
    href: outletHref(o.id),
  };
}

/** Full-screen paper-tinted map: a tag pin per outlet (grouped when zoomed out) and the live location dot. */
export default function HomeMap({ outlets }: Props) {
  // No zoom or fade animation for people who asked for reduced motion.
  const [animate] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [overlayInsets] = useState(measureOverlays);
  const location = useLocation();
  const points = useMemo(() => outlets.map(toPoint), [outlets]);
  // Keeps the zoom buttons and the OSM attribution visible above the bottom bar.
  const style = { "--home-bottom-ui": `${overlayInsets[1]}px` } as CSSProperties;

  return (
    <MapContainer
      center={UBC_CENTRE}
      zoom={HOME_ZOOM}
      maxZoom={MAX_ZOOM}
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
        maxZoom={MAX_ZOOM}
      />
      <ZoomControl position="bottomright" />
      <LocateControl />
      <ClusterLayer points={points} overlayInsets={overlayInsets} />
      {location.position ? <LocationDot position={location.position} accuracy={location.accuracy} /> : null}
    </MapContainer>
  );
}
