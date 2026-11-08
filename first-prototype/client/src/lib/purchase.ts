// The "Did you buy it?" follow-up: remembered between visits so it can be asked
// on the next app open if the student left before confirming. Stored per student,
// so demo personas never see (or confirm) each other's purchases.

import { useSyncExternalStore } from 'react';
import type { Evidence } from '../../../shared/types';
import { readJson, writeJson } from './storage';
import { getPersona, subscribePersona } from './student';

export interface PendingPurchase {
  itemId: string;
  outletId: string;
  /** What the student reported seeing on the shelf, if they shared it. */
  shelfCents: number | null;
  /** How that shelf report was made, so the checkout carries the same evidence. */
  shelfEvidence: Evidence | null;
  at: number;
}

const MAX_AGE_MS = 8 * 60 * 60 * 1000;
const keyFor = (persona: string) => `cpm.pendingPurchase.${persona}`;

const cache = new Map<string, PendingPurchase | null>();
const listeners = new Set<() => void>();

function load(persona: string): PendingPurchase | null {
  if (!cache.has(persona)) cache.set(persona, readJson<PendingPurchase>(keyFor(persona)));
  return cache.get(persona) ?? null;
}

export function getPendingPurchase(): PendingPurchase | null {
  const p = load(getPersona());
  if (!p) return null;
  return Date.now() - p.at < MAX_AGE_MS ? p : null;
}

export function setPendingPurchase(next: Omit<PendingPurchase, 'at'> | null): void {
  const persona = getPersona();
  const value = next ? { ...next, at: Date.now() } : null;
  cache.set(persona, value);
  writeJson(keyFor(persona), value);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const off = subscribePersona(l);
  return () => {
    listeners.delete(l);
    off();
  };
}

export function usePendingPurchase(): PendingPurchase | null {
  return useSyncExternalStore(subscribe, getPendingPurchase, getPendingPurchase);
}
