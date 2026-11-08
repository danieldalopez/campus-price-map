// Community verification rules for Campus Price Map.
// Pure functions only, so every rule is unit-testable without a database.

import type { Evidence, PriceLevel, ProposalStatus } from '../../shared/types';

export const RULES = {
  /** Confirmations from other students a typical proposal needs. */
  baseConfirmations: 2,
  /** Strong evidence (receipt, scan near the usual price, shelf + checkout match). */
  strongConfirmations: 1,
  /** Typed with no proof, or a big jump from the current price. */
  weakConfirmations: 3,
  /** Far outside the campus range: held for extra review. */
  heldConfirmations: 4,
  /** A scanned price within this fraction of the current price counts as "close to normal". */
  nearNormalTolerance: 0.1,
  /** A change larger than this fraction of the current price is a "big jump". */
  bigJumpThreshold: 0.25,
  /** Outside [median * low, median * high] is "far outside the normal range". */
  outlierLow: 0.5,
  outlierHigh: 2,
  /** Sold-out reports. */
  soldOutConfirmedHours: 4,
  soldOutPossibleHours: 1,
  /** Official prices older than this are shown as faded. */
  staleDays: 14,
  /** Trust over time. */
  trustMinResolved: 3,
  trustHigh: 0.8,
  trustLow: 0.4,
} as const;

export type TrustLevel = 'new' | 'trusted' | 'standard' | 'needs_more_checks';

export function trustLevel(confirmed: number, rejected: number): TrustLevel {
  const resolved = confirmed + rejected;
  if (resolved < RULES.trustMinResolved) return 'new';
  const ratio = confirmed / resolved;
  if (ratio >= RULES.trustHigh) return 'trusted';
  if (ratio < RULES.trustLow) return 'needs_more_checks';
  return 'standard';
}

export interface AssessInput {
  priceCents: number;
  evidence: Evidence;
  /** Official price at this outlet, if the outlet already lists the item. */
  currentCents: number | null;
  /** Median official price for the item across campus. */
  campusMedianCents: number | null;
  /** The same student reported this exact price as both shelf and checkout. */
  shelfMatchesCheckout: boolean;
  trust: TrustLevel;
}

export interface Assessment {
  status: Extract<ProposalStatus, 'pending' | 'held'>;
  required: number;
  reasons: string[];
}

export function isOutlier(priceCents: number, campusMedianCents: number | null): boolean {
  if (campusMedianCents === null || campusMedianCents <= 0) return false;
  return (
    priceCents < campusMedianCents * RULES.outlierLow ||
    priceCents > campusMedianCents * RULES.outlierHigh
  );
}

/** Fractional change from the current price, or null when there is no current price. */
export function priceChange(priceCents: number, currentCents: number | null): number | null {
  if (currentCents === null || currentCents <= 0) return null;
  return Math.abs(priceCents - currentCents) / currentCents;
}

/** How many confirmations from other students a new proposal needs before it goes live. */
export function assessProposal(input: AssessInput): Assessment {
  if (isOutlier(input.priceCents, input.campusMedianCents)) {
    return {
      status: 'held',
      required: RULES.heldConfirmations,
      reasons: ['Far outside the usual campus price, so it gets extra review'],
    };
  }

  const change = priceChange(input.priceCents, input.currentCents);
  const bigJump = change !== null && change > RULES.bigJumpThreshold;
  const reasons: string[] = [];
  let required: number;

  if (input.evidence === 'receipt' && bigJump) {
    // The prototype doesn't read the photo yet, so a receipt can't fully vouch for a big change.
    required = RULES.baseConfirmations;
    reasons.push('Receipt photo attached, but a big change from the current price');
  } else if (input.evidence === 'receipt') {
    required = RULES.strongConfirmations;
    reasons.push('Receipt photo attached');
  } else if (bigJump) {
    required = RULES.weakConfirmations;
    reasons.push('Big change from the current price');
  } else if (input.shelfMatchesCheckout) {
    required = RULES.strongConfirmations;
    reasons.push('Shelf price and checkout price match');
  } else if (input.evidence === 'scan' && change !== null && change <= RULES.nearNormalTolerance) {
    required = RULES.strongConfirmations;
    reasons.push('Scanned item, close to its usual price here');
  } else if (input.evidence === 'typed') {
    required = RULES.weakConfirmations;
    reasons.push('Typed price with no scan or receipt');
  } else {
    required = RULES.baseConfirmations;
    reasons.push('Scanned item, new or changed price');
  }

  if (input.trust === 'trusted' && required > RULES.strongConfirmations) {
    required -= 1;
    reasons.push('Trusted contributor');
  } else if (input.trust === 'needs_more_checks') {
    required += 1;
    reasons.push('Recent reports were often not confirmed');
  }

  return { status: 'pending', required, reasons };
}

/**
 * Outcome of the votes on a proposal. Only other students vote; "not sure" is ignored.
 * Live once yes reaches the requirement; discarded when no outnumbers yes and
 * at least min(required, 2) students said no.
 */
export function resolveVotes(required: number, yes: number, no: number): 'live' | 'rejected' | 'open' {
  if (yes >= required) return 'live';
  if (no > yes && no >= Math.min(required, 2)) return 'rejected';
  return 'open';
}

/** Two independent reports of the same price from different students confirm each other. */
export function reportsMatch(a: { priceCents: number; studentId: string }, b: { priceCents: number; studentId: string }): boolean {
  return a.studentId !== b.studentId && a.priceCents === b.priceCents;
}

export function isStale(confirmedAt: Date, now: Date): boolean {
  return now.getTime() - confirmedAt.getTime() > RULES.staleDays * 24 * 60 * 60 * 1000;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** $, $$ or $$$ for one item at one outlet, relative to the campus spread for that item. */
export function priceLevel(priceCents: number, allCents: number[]): PriceLevel {
  const min = Math.min(...allCents);
  const max = Math.max(...allCents);
  if (max - min < 10) return 1; // everything within 10 cents: all count as cheap
  const position = (priceCents - min) / (max - min);
  if (position <= 1 / 3) return 1;
  if (position <= 2 / 3) return 2;
  return 3;
}

/** Walking time across campus: straight-line distance times 1.25, at 80 m per minute. */
export function walkMinutes(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * R * Math.asin(Math.sqrt(a));
  return Math.max(1, Math.round((meters * 1.25) / 80));
}
