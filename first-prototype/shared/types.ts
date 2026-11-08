// Types shared by the server API and the React client.

export type Category = 'energy' | 'drinks' | 'coffee' | 'food' | 'snacks';

export const CATEGORY_LABELS: Record<Category, string> = {
  energy: 'Energy drinks',
  drinks: 'Soft drinks & water',
  coffee: 'Coffee & tea',
  food: 'Grab & go',
  snacks: 'Snacks & fruit',
};

export const CATEGORY_ORDER: Category[] = ['energy', 'drinks', 'coffee', 'food', 'snacks'];

export interface Item {
  id: string;
  name: string;
  size: string;
  category: Category;
  barcode: string | null;
  icon: string;
}

export interface Outlet {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  hours: string;
}

export interface Catalog {
  items: Item[];
  outlets: Outlet[];
}

export type Evidence = 'typed' | 'scan' | 'receipt';
export type ReportKind = 'shelf' | 'checkout';
export type ProposalStatus = 'pending' | 'held' | 'live' | 'rejected' | 'superseded';
export type Vote = 'yes' | 'no' | 'unsure';
export type StockState = 'in_stock' | 'possibly_out' | 'sold_out';
export type PriceLevel = 1 | 2 | 3;

/** A pending price proposal as other students see it. */
export interface OpenProposal {
  id: number;
  priceCents: number;
  required: number;
  yes: number;
  no: number;
  createdAt: string;
  held: boolean;
  mine: boolean;
  myVote: Vote | null;
}

export interface StockInfo {
  state: StockState;
  since: string | null;
  /** The report another student can confirm or dispute. */
  reportId: number | null;
  reportKind: 'out' | 'back' | null;
  /** True when the viewer filed or already voted on the open report. */
  mineOrVoted: boolean;
  /** A pending "it's back" report on top of a confirmed sold out. */
  backReportId: number | null;
}

export interface OutletPrice {
  outlet: Outlet;
  priceCents: number | null;
  confirmedBy: number;
  confirmedAt: string | null;
  stale: boolean;
  level: PriceLevel | null;
  rank: number | null;
  walkMinutes: number | null;
  stock: StockInfo;
  proposals: OpenProposal[];
}

export interface BcAverage {
  priceCents: number;
  label: string;
  refPeriod: string;
  isSample: boolean;
}

export interface ItemResults {
  item: Item;
  currentOutletId: string | null;
  /** Outlets that sell the item: in-stock first, then cheapest first. */
  outlets: OutletPrice[];
  campusAverageCents: number | null;
  bcAverage: BcAverage | null;
  weeklySearches: number;
}

export interface OutletItemComparison {
  item: Item;
  priceCents: number;
  confirmedBy: number;
  confirmedAt: string;
  stale: boolean;
  rank: number;
  of: number;
  diffFromAverageCents: number;
  cheapest: { outletId: string; outletName: string; priceCents: number } | null;
  stock: StockState;
}

export interface OutletDetail {
  outlet: Outlet;
  items: OutletItemComparison[];
}

export interface MapPin {
  outlet: Outlet;
  priceCents: number | null;
  level: PriceLevel | null;
  stock: StockState | null;
}

export interface SubmitProposalBody {
  itemId: string;
  outletId: string;
  priceCents: number;
  kind: ReportKind;
  evidence: Evidence;
}

export type SubmitOutcome =
  | 'pending' // waiting for other students
  | 'held' // far outside the usual range, extra review
  | 'live' // matched another student's report, live now
  | 'reconfirmed' // same as the official price, freshness bumped
  | 'strengthened'; // checkout matched the student's own shelf report

export interface SubmitProposalResult {
  outcome: SubmitOutcome;
  proposalId: number | null;
  required: number;
  reasons: string[];
  weeklySearches: number;
}

export interface VoteResult {
  status: ProposalStatus;
  yes: number;
  no: number;
  required: number;
}

export interface StockReportBody {
  itemId: string;
  outletId: string;
  kind: 'out' | 'back';
}

export interface StockResult {
  state: StockState;
}

export interface MyStats {
  reportsThisWeek: number;
  confirmationsThisWeek: number;
  pricesWentLive: number;
  studentsHelped: number;
  trust: 'new' | 'trusted' | 'standard' | 'needs_more_checks';
}
