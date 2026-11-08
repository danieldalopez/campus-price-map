"use client";

// Browser side of the read API: GET a JSON route, with the WakingUp signal after 3 s (docs/SPEC.md section 5:
// Lakebase scales to zero, so the first request after a quiet spell can be slow).

import { useEffect, useState } from "react";
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

type Settled<T> = { key: string; data: T | null; error: string | null; status: number | null };

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
    fetch(url, { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (res.ok) setSettled({ key, data: body as T, error: null, status: null });
        else
          setSettled({
            key,
            data: null,
            error: errorText(body) ?? "Something went wrong loading prices. Try again.",
            status: res.status,
          });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSettled({
          key,
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
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    status: current?.status ?? null,
    loading,
    slow: loading && slowKey === key,
    retry: () => setAttempt((a) => a + 1),
  };
}
