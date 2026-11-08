import type { PriceLevel } from '../../../shared/types';

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "80 cents" under a dollar, "$1.20" otherwise. */
export function savings(cents: number): string {
  const c = Math.abs(cents);
  return c < 100 ? `${c} cents` : money(c);
}

export function timeAgo(isoDate: string | null, now = Date.now()): string {
  if (!isoDate) return '';
  const mins = Math.max(0, Math.round((now - new Date(isoDate).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function walk(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes === 0) return "You're here";
  return `${minutes} min walk`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function students(n: number): string {
  return `${n} student${n === 1 ? '' : 's'}`;
}

export const LEVEL_LABEL: Record<PriceLevel, string> = { 1: '$', 2: '$$', 3: '$$$' };
export const LEVEL_NAME: Record<PriceLevel, string> = { 1: 'Cheaper', 2: 'Mid-range', 3: 'Pricier' };
