// Anonymous student identity. No names or emails: just a random per-device id.
// For the demo, one device can act as up to three different students so the
// "only someone else can confirm" rule can be tried end to end.

import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from './storage';

export const PERSONAS = [
  { key: 'a', label: 'Student A' },
  { key: 'b', label: 'Student B' },
  { key: 'c', label: 'Student C' },
] as const;
export type PersonaKey = (typeof PERSONAS)[number]['key'];

const BASE_KEY = 'cpm.student';
const PERSONA_KEY = 'cpm.persona';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('-');
}

let base = readJson<string>(BASE_KEY);
if (!base || !/^[a-z0-9-]{8,56}$/.test(base)) {
  base = randomId().toLowerCase();
  writeJson(BASE_KEY, base);
}
let persona: PersonaKey = readJson<PersonaKey>(PERSONA_KEY) ?? 'a';
const listeners = new Set<() => void>();

export function studentId(): string {
  return `${base}-${persona}`;
}

export function getPersona(): PersonaKey {
  return persona;
}

export function setPersona(next: PersonaKey): void {
  persona = next;
  writeJson(PERSONA_KEY, next);
  listeners.forEach((l) => l());
}

export function subscribePersona(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function usePersona(): PersonaKey {
  return useSyncExternalStore(subscribePersona, getPersona, getPersona);
}
