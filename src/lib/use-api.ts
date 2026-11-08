"use client";

// Browser side of the read API: GET a JSON route, with the WakingUp signal after 3 s (docs/SPEC.md section 5:
// Lakebase scales to zero, so the first request after a quiet spell can be slow).

import { useEffect, useState } from "react";
import { getDeviceId } from "./device";
import type { ApiError } from "./types";

export const WAKING_UP_AFTER_MS = 3_000;

export type ApiState<T> = {
  data: T | null;
  /** A plain sentence for the user. */
  error: string | null;
  /** HTTP status of a failed request (404 = we don't track it), or null. */
  status: number | null;
  loading: boolean;
  /** Still loading after 3 s: show WakingUp. */
  slow: boolean;
  retry: () => void;
};

type Settled<T> = { key: string; url: string; data: T | null; error: string | null; status: number | null };

function errorText(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body && typeof (body as ApiError).error === "string") {
    return (body as ApiError).error;
  }
  return null;
}

/** Fetch `url` (null = don't fetch yet). Refetches when the url changes or on retry(). */
export function useApi<T>(url: string | null): ApiState<T> {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [slowKey, setSlowKey] = useState<string | null>(null);
  const key = url === null ? null : `${attempt}:${url}`;

  useEffect(() => {
    if (url === null || key === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => setSlowKey(key), WAKING_UP_AFTER_MS);
    // The device id goes in a header, never the URL: it lets the server say "Your report" and remember votes.
    fetch(url, { signal: controller.signal, headers: { accept: "application/json", "x-device-id": getDeviceId() } })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (res.ok) setSettled({ key, url, data: body as T, error: null, status: null });
        else
          setSettled({
            key,
            url,
            data: null,
            error: errorText(body) ?? "Something went wrong loading prices. Try again.",
            status: res.status,
          });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSettled({
          key,
          url,
          data: null,
          error: "Couldn't reach the prices. Check your connection and try again.",
          status: null,
        });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [url, key]);

  const current = settled !== null && settled.key === key ? settled : null;
  const loading = key !== null && current === null;
  // While refreshing the same url (retry after a vote), keep showing the last good data so the page doesn't
  // blank out and lose its scroll position.
  const stale = loading && settled !== null && settled.url === url ? settled.data : null;
  return {
    data: current?.data ?? stale,
    error: current?.error ?? null,
    status: current?.status ?? null,
    loading,
    slow: loading && stale === null && slowKey === key,
    retry: () => setAttempt((a) => a + 1),
  };
}
