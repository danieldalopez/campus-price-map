"use client";

// Browser side of GET /api/menu-search: the "On menus" group under the tracked items in Home's search.

import { useEffect, useState } from "react";
import { roundLatLng } from "./geo";
import { MENU_MIN_QUERY, normalise } from "./search";
import type { MenuSearchResponse } from "./types";
import { useApi, type ApiState } from "./use-api";
import { useLocation } from "./use-location";

/** Wait this long after the last keystroke before asking the server. */
const DEBOUNCE_MS = 250;

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

export type MenuSearchState = ApiState<MenuSearchResponse> & {
  /** False while the query is too short to search menus. */
  active: boolean;
  /** The student is still typing, or the answer for what they typed hasn't arrived. */
  waiting: boolean;
};

/**
 * Search every menu line for `query`. Walk times are included only once location is on (never from the
 * Nest fallback here: the search box has no line saying where they're measured from).
 */
export function useMenuSearch(query: string): MenuSearchState {
  const typed = query.trim();
  const settled = useDebounced(typed, DEBOUNCE_MS);
  const location = useLocation();
  const origin = location.status === "on" ? roundLatLng(location.origin) : null;
  const active = normalise(settled).length >= MENU_MIN_QUERY;
  const url = active
    ? `/api/menu-search?q=${encodeURIComponent(settled)}${origin ? `&lat=${origin.lat}&lng=${origin.lng}` : ""}`
    : null;
  const api = useApi<MenuSearchResponse>(url);
  return { ...api, active: normalise(typed).length >= MENU_MIN_QUERY, waiting: settled !== typed || api.loading };
}
