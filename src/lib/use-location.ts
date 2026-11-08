"use client";

import { useSyncExternalStore } from "react";
import { getLocationSnapshot, getServerLocationSnapshot, subscribeLocation, type LocationState } from "./geo";

/** The student's location state (src/lib/geo.ts); re-renders on every fix (the dot) and origin change (the sort). */
export function useLocation(): LocationState {
  return useSyncExternalStore(subscribeLocation, getLocationSnapshot, getServerLocationSnapshot);
}
