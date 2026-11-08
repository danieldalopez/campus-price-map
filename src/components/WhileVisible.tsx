"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";

/**
 * Render `children` only while this page is visible, and fresh each time it is shown again.
 *
 * With cacheComponents on, Next keeps the last few pages alive but hidden in React's <Activity>, and runs
 * their effect cleanups when it hides them. react-leaflet removes its Leaflet map in that cleanup and never
 * creates a new one, so a map that comes back from hiding crashes the page ("Map container is being reused
 * by another instance"). Unmounting the map on hide and mounting a new one on show avoids that.
 */
export function WhileVisible({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    // Runs on first mount and again every time <Activity> shows the page; the cleanup runs when it hides it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the visibility flag can only come from here
    setVisible(true);
    return () => setVisible(false);
  }, []);
  return visible ? children : fallback;
}
