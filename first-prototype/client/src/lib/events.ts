import { useEffect, useRef } from 'react';

const EVENT = 'cpm:data-changed';

/** Tell open pages that prices or reports changed, so they re-fetch. */
export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function useOnDataChanged(cb: () => void): void {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useEffect(() => {
    const handler = () => ref.current();
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);
}
