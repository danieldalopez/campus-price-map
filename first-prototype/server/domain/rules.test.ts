import { describe, expect, it } from 'vitest';
import { assessProposal, isOutlier, median, priceLevel, resolveVotes, RULES, trustLevel, walkMinutes, type AssessInput } from './rules';
import { ITEMS, OUTLETS, seedPrices } from '../db/seed-data';

const base: AssessInput = {
  priceCents: 349,
  evidence: 'scan',
  currentCents: 349,
  campusMedianCents: 349,
  shelfMatchesCheckout: false,
  trust: 'new',
};

describe('assessProposal', () => {
  it('needs one confirmation for a receipt photo', () => {
    expect(assessProposal({ ...base, priceCents: 329, evidence: 'receipt' }).required).toBe(1);
  });

  it('needs one confirmation for a scan close to the usual price', () => {
    expect(assessProposal({ ...base, priceCents: 329 }).required).toBe(1);
  });

  it('needs one confirmation when shelf and checkout prices match', () => {
    expect(assessProposal({ ...base, priceCents: 399, evidence: 'typed', shelfMatchesCheckout: true }).required).toBe(1);
  });

  it('needs the base two confirmations for a scan with a moderate change', () => {
    expect(assessProposal({ ...base, priceCents: 399 }).required).toBe(RULES.baseConfirmations);
  });

  it('needs the base two for a scan at an outlet with no current price', () => {
    expect(assessProposal({ ...base, currentCents: null }).required).toBe(2);
  });

  it('needs more confirmations for a typed price with no proof', () => {
    expect(assessProposal({ ...base, priceCents: 329, evidence: 'typed' }).required).toBe(3);
  });

  it('needs more confirmations for a big jump, even when scanned', () => {
    expect(assessProposal({ ...base, priceCents: 499 }).required).toBe(3);
  });

  it('gives a receipt on a big jump the base two, since the photo is not read yet', () => {
    expect(assessProposal({ ...base, priceCents: 499, evidence: 'receipt' }).required).toBe(2);
  });

  it('keeps the big-jump rule even when shelf and checkout prices match', () => {
    expect(assessProposal({ ...base, priceCents: 499, evidence: 'scan', shelfMatchesCheckout: true }).required).toBe(3);
  });

  it('holds prices far outside the campus range for extra review', () => {
    const a = assessProposal({ ...base, priceCents: 999, evidence: 'receipt' });
    expect(a.status).toBe('held');
    expect(a.required).toBe(RULES.heldConfirmations);
    expect(assessProposal({ ...base, priceCents: 99 }).status).toBe('held');
  });

  it('lets trusted contributors need one fewer, never below one', () => {
    expect(assessProposal({ ...base, priceCents: 329, evidence: 'typed', trust: 'trusted' }).required).toBe(2);
    expect(assessProposal({ ...base, priceCents: 329, trust: 'trusted' }).required).toBe(1);
  });

  it('asks more of contributors whose reports are often rejected', () => {
    expect(assessProposal({ ...base, priceCents: 399, trust: 'needs_more_checks' }).required).toBe(3);
  });
});

describe('resolveVotes', () => {
  it('goes live once yes reaches the requirement', () => {
    expect(resolveVotes(2, 2, 0)).toBe('live');
    expect(resolveVotes(1, 1, 0)).toBe('live');
  });
  it('stays open until there is enough agreement', () => {
    expect(resolveVotes(2, 1, 0)).toBe('open');
    expect(resolveVotes(3, 1, 1)).toBe('open');
  });
  it('is discarded when more students say no than yes', () => {
    expect(resolveVotes(2, 0, 2)).toBe('rejected');
    expect(resolveVotes(3, 1, 2)).toBe('rejected');
    expect(resolveVotes(1, 0, 1)).toBe('rejected');
  });
  it('does not discard on a single no when two or more confirmations are needed', () => {
    expect(resolveVotes(2, 0, 1)).toBe('open');
  });
});

describe('trustLevel', () => {
  it('treats students with few resolved reports as new', () => expect(trustLevel(2, 0)).toBe('new'));
  it('trusts mostly confirmed contributors', () => expect(trustLevel(8, 1)).toBe('trusted'));
  it('flags mostly rejected contributors', () => expect(trustLevel(1, 3)).toBe('needs_more_checks'));
  it('is standard in between', () => expect(trustLevel(3, 2)).toBe('standard'));
});

describe('helpers', () => {
  it('computes the median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
  });
  it('detects outliers relative to the campus median', () => {
    expect(isOutlier(698, 349)).toBe(false);
    expect(isOutlier(699, 349)).toBe(true);
    expect(isOutlier(100, null)).toBe(false);
  });
  it('assigns $, $$ and $$$ levels across the spread', () => {
    const all = [300, 350, 400];
    expect(priceLevel(300, all)).toBe(1);
    expect(priceLevel(350, all)).toBe(2);
    expect(priceLevel(400, all)).toBe(3);
    expect(priceLevel(300, [300, 305])).toBe(1);
  });
  it('estimates walking minutes between campus outlets', () => {
    const nest = OUTLETS.find((o) => o.id === 'the-nest')!;
    const mercante = OUTLETS.find((o) => o.id === 'mercante')!;
    const m = walkMinutes(nest, mercante);
    expect(m).toBeGreaterThanOrEqual(5);
    expect(m).toBeLessThanOrEqual(12);
  });
});

describe('seed data', () => {
  it('tracks exactly 21 items with unique ids and barcodes', () => {
    expect(ITEMS).toHaveLength(21);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(21);
    const codes = ITEMS.map((i) => i.barcode).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
  });
  it('gives every item at least two outlets so comparisons are meaningful', () => {
    const prices = seedPrices();
    for (const it of ITEMS) expect(prices.filter((p) => p.itemId === it.id).length).toBeGreaterThanOrEqual(2);
    for (const p of prices) expect(p.priceCents).toBeGreaterThan(0);
  });
});
