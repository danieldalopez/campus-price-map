import { useCallback, useEffect, useRef, useState } from 'react';
import { studentId, usePersona } from './student';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: {
      'x-student-id': studentId(),
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export interface Query<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Fetch `path` (re-fetching when it or the demo student changes). Pass null to skip. */
export function useQuery<T>(path: string | null): Query<T> {
  const persona = usePersona();
  // Data is tagged with the path it came from, so a new path never shows the old page's data.
  const [state, setState] = useState<{ path: string; data: T } | null>(null);
  const [error, setError] = useState<{ path: string; message: string } | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (mine === seq.current) {
        setState({ path, data: result });
        setError(null);
      }
    } catch (err) {
      if (mine === seq.current) setError({ path, message: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // persona is a dependency so switching demo student re-fetches personalised data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, persona]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data: state && state.path === path ? state.data : null,
    error: error && error.path === path ? error.message : null,
    loading,
    reload: load,
  };
}
