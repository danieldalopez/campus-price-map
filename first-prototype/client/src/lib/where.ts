// "Which outlet am I in?" — remembered choice, refined by an optional location fix.

import { useSyncExternalStore } from 'react';
import type { Outlet } from '../../../shared/types';
import { readJson, writeJson } from './storage';

const KEY = 'cpm.currentOutlet';
/** Treat a location fix within this distance of an outlet as "in" it. */
const IN_OUTLET_METERS = 120;
/** Ignore location fixes further than this from campus (e.g. testing from home). */
const ON_CAMPUS_METERS = 2500;

interface Stored {
  outletId: string;
  at: number;
}

let current = readJson<Stored>(KEY);
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setCurrentOutlet(outletId: string | null): void {
  current = outletId ? { outletId, at: Date.now() } : null;
  writeJson(KEY, current);
  emit();
}

/** The outlet the student said they're in, if chosen in the last 3 hours. */
export function getCurrentOutletId(): string | null {
  if (!current) return null;
  return Date.now() - current.at < 3 * 60 * 60 * 1000 ? current.outletId : null;
}

export function useCurrentOutletId(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getCurrentOutletId,
    getCurrentOutletId,
  );
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface LocationFix {
  lat: number;
  lng: number;
}

/** One-shot location fix; resolves null if unavailable or denied. */
export function locate(timeoutMs = 6000): Promise<LocationFix | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** Suggest which outlet the student is standing in, or null if not confident. */
export function suggestOutlet(fix: LocationFix, outlets: Outlet[]): Outlet | null {
  let best: { outlet: Outlet; d: number } | null = null;
  for (const outlet of outlets) {
    const d = distanceMeters(fix, outlet);
    if (!best || d < best.d) best = { outlet, d };
  }
  if (!best || best.d > ON_CAMPUS_METERS) return null;
  return best.d <= IN_OUTLET_METERS ? best.outlet : null;
}
