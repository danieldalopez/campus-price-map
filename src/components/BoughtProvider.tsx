"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { dueIntent } from "@/lib/bought";
import { getLocationSnapshot } from "@/lib/geo";
import { BoughtSheet, type BoughtTarget } from "./BoughtSheet";

/** Pages listen for this to reload their prices after "I bought it" saved a report. */
export const PRICES_CHANGED = "cpm:prices-changed";

const OpenBought = createContext<(target: BoughtTarget) => void>(() => {});

/** Open the "I bought it" sheet (the "I bought it here" buttons). */
export function useOpenBought() {
  return useContext(OpenBought);
}

/** How often to look for a finished trip while the app is open. */
const CHECK_MS = 30_000;

/**
 * "I bought it" for the whole app (SPEC Step 8). Two ways in:
 * - the student taps "I bought it here" on a price, or
 * - they tapped Directions to an outlet earlier (src/lib/bought.ts), and now it's a few minutes later or
 *   they're standing at the outlet: the app asks once. "Not now" and closing are always fine.
 */
export function BoughtProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<BoughtTarget | null>(null);

  const open = useCallback((t: BoughtTarget) => setTarget(t), []);

  useEffect(() => {
    function look() {
      if (document.visibilityState !== "visible") return;
      setTarget((current) => {
        if (current) return current;
        const loc = getLocationSnapshot();
        const intent = dueIntent(Date.now(), loc.status === "on" ? loc.position : null);
        return intent ? { outlet: intent.outlet, item: intent.item, price: intent.price } : null;
      });
    }
    const first = setTimeout(look, 1_500);
    const timer = setInterval(look, CHECK_MS);
    document.addEventListener("visibilitychange", look);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", look);
    };
  }, []);

  return (
    <OpenBought.Provider value={open}>
      {children}
      <BoughtSheet
        target={target}
        onClose={() => setTarget(null)}
        onSaved={() => window.dispatchEvent(new Event(PRICES_CHANGED))}
      />
    </OpenBought.Provider>
  );
}

/** Call `reload` whenever "I bought it" saved a report. */
export function usePricesChanged(reload: () => void) {
  useEffect(() => {
    window.addEventListener(PRICES_CHANGED, reload);
    return () => window.removeEventListener(PRICES_CHANGED, reload);
  }, [reload]);
}
