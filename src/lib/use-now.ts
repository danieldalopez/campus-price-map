"use client";

import { useEffect, useState } from "react";

/** The current time, re-read every `intervalMs` so freshness ("20 min ago") and today's hours stay current. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
