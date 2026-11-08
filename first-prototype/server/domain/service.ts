// Data access and community-verification workflows for Campus Price Map.

import type {
  BcAverage,
  Catalog,
  Category,
  Evidence,
  Item,
  ItemResults,
  MapPin,
  MyStats,
  OpenProposal,
  Outlet,
  OutletDetail,
  OutletItemComparison,
  OutletPrice,
  ProposalStatus,
  StockInfo,
  StockReportBody,
  StockResult,
  StockState,
  SubmitProposalBody,
  SubmitProposalResult,
  Vote,
  VoteResult,
} from '../../shared/types';
import { withTransaction, type Lakebase, type Tx } from '../db/db';
import { assessProposal, isStale, median, priceLevel, resolveVotes, RULES, trustLevel, walkMinutes } from './rules';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
  /** AppKit's error middleware reads statusCode. */
  get statusCode(): number {
    return this.status;
  }
}

type Row = Record<string, unknown>;

const toItem = (r: Row): Item => ({
  id: String(r.id),
  name: String(r.name),
  size: String(r.size),
  category: String(r.category) as Category,
  barcode: typeof r.barcode === 'string' ? r.barcode : null,
  icon: String(r.icon),
});

const toOutlet = (r: Row): Outlet => ({
  id: String(r.id),
  name: String(r.name),
  area: String(r.area),
  lat: Number(r.lat),
  lng: Number(r.lng),
  hours: String(r.hours),
});

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export async function getCatalog(db: Lakebase): Promise<Catalog> {
  const [items, outlets] = await Promise.all([
    db.query('SELECT id, name, size, category, barcode, icon FROM cpm.items ORDER BY sort'),
    db.query('SELECT id, name, area, lat, lng, hours FROM cpm.outlets ORDER BY sort'),
  ]);
  return { items: items.rows.map(toItem), outlets: outlets.rows.map(toOutlet) };
}

export async function findItemByBarcode(db: Lakebase, barcode: string): Promise<Item | null> {
  const { rows } = await db.query('SELECT id, name, size, category, barcode, icon FROM cpm.items WHERE barcode = $1', [barcode]);
  return rows[0] ? toItem(rows[0]) : null;
}

async function requireItem(db: Tx, itemId: string): Promise<Item> {
  const { rows } = await db.query('SELECT id, name, size, category, barcode, icon FROM cpm.items WHERE id = $1', [itemId]);
  if (!rows[0]) throw new HttpError(404, 'Item not found');
  return toItem(rows[0]);
}

async function requireOutlet(db: Tx, outletId: string): Promise<Outlet> {
  const { rows } = await db.query('SELECT id, name, area, lat, lng, hours FROM cpm.outlets WHERE id = $1', [outletId]);
  if (!rows[0]) throw new HttpError(404, 'Outlet not found');
  return toOutlet(rows[0]);
}

// ---------------------------------------------------------------------------
// Stock state
// ---------------------------------------------------------------------------

interface StockRow {
  id: string;
  item_id: string;
  outlet_id: string;
  kind: 'out' | 'back';
  student_id: string;
  status: 'possible' | 'confirmed';
  created_at: Date;
  confirmed_at: Date | null;
  voted: boolean;
}

async function activeStockReports(db: Lakebase, itemIds: string[] | null, outletIds: string[] | null, studentId: string) {
  const { rows } = await db.query<StockRow>(
    `SELECT r.id, r.item_id, r.outlet_id, r.kind, r.student_id, r.status, r.created_at, r.confirmed_at,
            EXISTS (SELECT 1 FROM cpm.stock_votes v WHERE v.report_id = r.id AND v.student_id = $3) AS voted
       FROM cpm.stock_reports r
      WHERE r.status IN ('possible', 'confirmed') AND r.expires_at > NOW()
        AND ($1::text[] IS NULL OR r.item_id = ANY($1))
        AND ($2::text[] IS NULL OR r.outlet_id = ANY($2))
      ORDER BY r.created_at`,
    [itemIds, outletIds, studentId],
  );
  return rows;
}

function stockInfo(reports: StockRow[], studentId: string): StockInfo {
  const confirmedOut = reports.find((r) => r.kind === 'out' && r.status === 'confirmed');
  if (confirmedOut) {
    const back = reports.find((r) => r.kind === 'back' && r.status === 'possible');
    return {
      state: 'sold_out',
      since: iso(confirmedOut.confirmed_at ?? confirmedOut.created_at),
      reportId: Number(confirmedOut.id),
      reportKind: 'out',
      mineOrVoted: back ? back.student_id === studentId || back.voted : false,
      backReportId: back ? Number(back.id) : null,
    };
  }
  const possibleOut = reports.find((r) => r.kind === 'out' && r.status === 'possible');
  if (possibleOut) {
    return {
      state: 'possibly_out',
      since: iso(possibleOut.created_at),
      reportId: Number(possibleOut.id),
      reportKind: 'out',
      mineOrVoted: possibleOut.student_id === studentId || possibleOut.voted,
      backReportId: null,
    };
  }
  return { state: 'in_stock', since: null, reportId: null, reportKind: null, mineOrVoted: false, backReportId: null };
}

const confirmedSoldOutExpiry = `LEAST(
  NOW() + INTERVAL '${RULES.soldOutConfirmedHours} hours',
  (date_trunc('day', NOW() AT TIME ZONE 'America/Vancouver') + INTERVAL '1 day') AT TIME ZONE 'America/Vancouver'
)`;

// ---------------------------------------------------------------------------
// Results for one item ("where is it cheapest?")
// ---------------------------------------------------------------------------

interface PriceRow {
  item_id: string;
  outlet_id: string;
  price_cents: number;
  confirmed_by: number;
  confirmed_at: Date;
}

interface ProposalRow {
  id: string;
  item_id: string;
  outlet_id: string;
  student_id: string;
  price_cents: number;
  required: number;
  status: 'pending' | 'held';
  created_at: Date;
  yes: string;
  no: string;
  my_vote: Vote | null;
}

export interface ResultsOptions {
  fromOutletId: string | null;
  origin: { lat: number; lng: number } | null;
  logSearch: boolean;
}

export async function getItemResults(db: Lakebase, itemId: string, studentId: string, opts: ResultsOptions): Promise<ItemResults> {
  const item = await requireItem(db, itemId);

  if (opts.logSearch) {
    // At most one counted search per student per item every 10 minutes.
    await db.query(
      `INSERT INTO cpm.searches (item_id, student_id)
       SELECT $1, $2 WHERE NOT EXISTS (
         SELECT 1 FROM cpm.searches WHERE item_id = $1 AND student_id = $2 AND created_at > NOW() - INTERVAL '10 minutes')`,
      [itemId, studentId],
    );
  }

  const [outletsRes, pricesRes, proposalsRes, bcRes, searchesRes, stock] = await Promise.all([
    db.query('SELECT id, name, area, lat, lng, hours FROM cpm.outlets ORDER BY sort'),
    db.query<PriceRow>('SELECT item_id, outlet_id, price_cents, confirmed_by, confirmed_at FROM cpm.prices WHERE item_id = $1', [itemId]),
    db.query<ProposalRow>(
      `SELECT p.id, p.item_id, p.outlet_id, p.student_id, p.price_cents, p.required, p.status, p.created_at,
              COUNT(v.*) FILTER (WHERE v.vote = 'yes')::text AS yes,
              COUNT(v.*) FILTER (WHERE v.vote = 'no')::text AS no,
              MAX(v.vote) FILTER (WHERE v.student_id = $2) AS my_vote
         FROM cpm.proposals p
         LEFT JOIN cpm.votes v ON v.proposal_id = p.id
        WHERE p.item_id = $1 AND p.status IN ('pending', 'held')
        GROUP BY p.id
        ORDER BY p.created_at DESC`,
      [itemId, studentId],
    ),
    db.query('SELECT label, price_cents, ref_period, is_sample FROM cpm.bc_averages WHERE item_id = $1', [itemId]),
    db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM cpm.searches WHERE item_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
      [itemId],
    ),
    activeStockReports(db, [itemId], null, studentId),
  ]);

  const outlets = outletsRes.rows.map(toOutlet);
  const now = new Date();
  const from = opts.fromOutletId ? outlets.find((o) => o.id === opts.fromOutletId) ?? null : null;
  const origin = from ?? opts.origin;

  const priced = pricesRes.rows.map((p) => Number(p.price_cents));

  const rows: OutletPrice[] = [];
  for (const outlet of outlets) {
    const price = pricesRes.rows.find((p) => p.outlet_id === outlet.id);
    const proposals: OpenProposal[] = proposalsRes.rows
      .filter((p) => p.outlet_id === outlet.id)
      .map((p) => ({
        id: Number(p.id),
        priceCents: Number(p.price_cents),
        required: Number(p.required),
        yes: Number(p.yes),
        no: Number(p.no),
        createdAt: iso(p.created_at) ?? '',
        held: p.status === 'held',
        mine: p.student_id === studentId,
        myVote: p.my_vote,
      }));
    if (!price && proposals.length === 0) continue; // outlet doesn't sell it

    rows.push({
      outlet,
      priceCents: price ? Number(price.price_cents) : null,
      confirmedBy: price ? Number(price.confirmed_by) : 0,
      confirmedAt: price ? iso(price.confirmed_at) : null,
      stale: price ? isStale(new Date(price.confirmed_at), now) : false,
      level: price ? priceLevel(Number(price.price_cents), priced) : null,
      rank: null,
      walkMinutes: origin ? (from && from.id === outlet.id ? 0 : walkMinutes(origin, outlet)) : null,
      stock: stockInfo(stock.filter((s) => s.outlet_id === outlet.id), studentId),
      proposals,
    });
  }

  const stockOrder = (s: StockState) => (s === 'sold_out' ? 1 : 0);
  rows.sort(
    (a, b) =>
      stockOrder(a.stock.state) - stockOrder(b.stock.state) ||
      (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity) ||
      (a.walkMinutes ?? 0) - (b.walkMinutes ?? 0),
  );
  let rank = 0;
  for (const r of rows) if (r.priceCents !== null && r.stock.state !== 'sold_out') r.rank = ++rank;

  const bc = bcRes.rows[0];
  const bcAverage: BcAverage | null = bc
    ? { label: String(bc.label), priceCents: Number(bc.price_cents), refPeriod: String(bc.ref_period), isSample: Boolean(bc.is_sample) }
    : null;

  return {
    item,
    currentOutletId: from?.id ?? null,
    outlets: rows,
    campusAverageCents: priced.length ? Math.round(priced.reduce((s, v) => s + v, 0) / priced.length) : null,
    bcAverage,
    weeklySearches: Number(searchesRes.rows[0]?.n ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Outlet page: every item, compared product by product
// ---------------------------------------------------------------------------

export async function getOutletDetail(db: Lakebase, outletId: string, studentId: string): Promise<OutletDetail> {
  const outlet = await requireOutlet(db, outletId);
  const [itemsRes, pricesRes, outletsRes, stock] = await Promise.all([
    db.query('SELECT id, name, size, category, barcode, icon FROM cpm.items ORDER BY sort'),
    db.query<PriceRow>('SELECT item_id, outlet_id, price_cents, confirmed_by, confirmed_at FROM cpm.prices'),
    db.query('SELECT id, name FROM cpm.outlets'),
    activeStockReports(db, null, [outletId], studentId),
  ]);
  const outletName = new Map(outletsRes.rows.map((r) => [String(r.id), String(r.name)]));
  const now = new Date();

  const items: OutletItemComparison[] = [];
  for (const it of itemsRes.rows.map(toItem)) {
    const here = pricesRes.rows.find((p) => p.item_id === it.id && p.outlet_id === outletId);
    if (!here) continue;
    const all = pricesRes.rows.filter((p) => p.item_id === it.id).sort((a, b) => a.price_cents - b.price_cents);
    const hereCents = Number(here.price_cents);
    const avg = all.reduce((s, p) => s + Number(p.price_cents), 0) / all.length;
    const cheapestRow = all[0];
    items.push({
      item: it,
      priceCents: hereCents,
      confirmedBy: Number(here.confirmed_by),
      confirmedAt: iso(here.confirmed_at) ?? '',
      stale: isStale(new Date(here.confirmed_at), now),
      rank: all.filter((p) => Number(p.price_cents) < hereCents).length + 1,
      of: all.length,
      diffFromAverageCents: Math.round(hereCents - avg),
      cheapest:
        cheapestRow && cheapestRow.outlet_id !== outletId && Number(cheapestRow.price_cents) < hereCents
          ? { outletId: cheapestRow.outlet_id, outletName: outletName.get(cheapestRow.outlet_id) ?? '', priceCents: Number(cheapestRow.price_cents) }
          : null,
      stock: stockInfo(stock.filter((s) => s.item_id === it.id), studentId).state,
    });
  }
  return { outlet, items };
}

// ---------------------------------------------------------------------------
// Map pins for one item (or plain pins when nothing is searched)
// ---------------------------------------------------------------------------

export async function getMapPins(db: Lakebase, itemId: string | null, studentId: string): Promise<MapPin[]> {
  const outlets = (await db.query('SELECT id, name, area, lat, lng, hours FROM cpm.outlets ORDER BY sort')).rows.map(toOutlet);
  if (!itemId) return outlets.map((outlet) => ({ outlet, priceCents: null, level: null, stock: null }));

  await requireItem(db, itemId);
  const [prices, stock] = await Promise.all([
    db.query<PriceRow>('SELECT item_id, outlet_id, price_cents, confirmed_by, confirmed_at FROM cpm.prices WHERE item_id = $1', [itemId]),
    activeStockReports(db, [itemId], null, studentId),
  ]);
  const all = prices.rows.map((p) => Number(p.price_cents));
  return outlets.map((outlet) => {
    const p = prices.rows.find((r) => r.outlet_id === outlet.id);
    return {
      outlet,
      priceCents: p ? Number(p.price_cents) : null,
      level: p ? priceLevel(Number(p.price_cents), all) : null,
      stock: p ? stockInfo(stock.filter((s) => s.outlet_id === outlet.id), studentId).state : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Price proposals and votes
// ---------------------------------------------------------------------------

/** Serialize writes for one item at one outlet so concurrent reports can't race. */
async function lockPair(tx: Tx, itemId: string, outletId: string) {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${itemId}|${outletId}`]);
}

/** Trust only counts reports that other students actually confirmed (not ones that went live by matching). */
async function studentTrust(tx: Tx, studentId: string) {
  const { rows } = await tx.query<{ live: string; rejected: string }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'live' AND NOT via_match)::text AS live,
            COUNT(*) FILTER (WHERE status = 'rejected')::text AS rejected
       FROM cpm.proposals WHERE student_id = $1`,
    [studentId],
  );
  return trustLevel(Number(rows[0]?.live ?? 0), Number(rows[0]?.rejected ?? 0));
}

const MATCH_REASON = 'Shelf price and checkout price match';
const EVIDENCE_STRENGTH: Record<Evidence, number> = { typed: 0, scan: 1, receipt: 2 };
const stronger = (a: Evidence, b: Evidence): Evidence => (EVIDENCE_STRENGTH[a] >= EVIDENCE_STRENGTH[b] ? a : b);

interface ProposalRow2 {
  id: string;
  student_id: string;
  price_cents: number;
  kind: 'shelf' | 'checkout';
  evidence: Evidence;
  status: ProposalStatus;
  required: number;
  reasons: string[];
}

/**
 * Make a proposal official and tidy up everything that depended on the old price:
 * - confirmed_by counts distinct students (submitter, yes-voters, independent matchers);
 * - other open proposals at the same price are closed as live, different prices as superseded,
 *   so a stale proposal can never overwrite a newer price later;
 * - confirmers are recorded as reconfirmations of the new price, so re-submitting it can't double count.
 */
async function goLive(tx: Tx, proposalId: number, extraConfirmers: string[] = []): Promise<number> {
  const p = (
    await tx.query<{ item_id: string; outlet_id: string; student_id: string; price_cents: number }>(
      'SELECT item_id, outlet_id, student_id, price_cents FROM cpm.proposals WHERE id = $1',
      [proposalId],
    )
  ).rows[0];
  const priceCents = Number(p.price_cents);
  const yesVoters = (
    await tx.query<{ student_id: string }>(`SELECT student_id FROM cpm.votes WHERE proposal_id = $1 AND vote = 'yes'`, [proposalId])
  ).rows.map((r) => r.student_id);
  const samePrice = (
    await tx.query<{ id: string; student_id: string }>(
      `SELECT id, student_id FROM cpm.proposals
        WHERE item_id = $1 AND outlet_id = $2 AND price_cents = $3 AND status IN ('pending', 'held') AND id <> $4`,
      [p.item_id, p.outlet_id, priceCents, proposalId],
    )
  ).rows;
  const confirmers = [...new Set([p.student_id, ...yesVoters, ...extraConfirmers, ...samePrice.map((r) => r.student_id)])];

  await tx.query(
    `INSERT INTO cpm.prices (item_id, outlet_id, price_cents, confirmed_by, confirmed_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (item_id, outlet_id) DO UPDATE
       SET price_cents = EXCLUDED.price_cents, confirmed_by = EXCLUDED.confirmed_by, confirmed_at = NOW()`,
    [p.item_id, p.outlet_id, priceCents, confirmers.length],
  );
  await tx.query(`UPDATE cpm.proposals SET status = 'live', resolved_at = NOW() WHERE id = $1`, [proposalId]);
  // Duplicates of the winning price are correct but didn't need anyone's vote: no trust credit.
  await tx.query(
    `UPDATE cpm.proposals SET status = 'live', via_match = TRUE, resolved_at = NOW() WHERE id = ANY($1::bigint[])`,
    [samePrice.map((r) => r.id)],
  );
  await tx.query(
    `UPDATE cpm.proposals SET status = 'superseded', resolved_at = NOW()
      WHERE item_id = $1 AND outlet_id = $2 AND status IN ('pending', 'held') AND price_cents <> $3`,
    [p.item_id, p.outlet_id, priceCents],
  );
  await tx.query('DELETE FROM cpm.reconfirmations WHERE item_id = $1 AND outlet_id = $2 AND price_cents <> $3', [
    p.item_id,
    p.outlet_id,
    priceCents,
  ]);
  await tx.query(
    `INSERT INTO cpm.reconfirmations (item_id, outlet_id, student_id, price_cents)
     SELECT $1, $2, s, $3 FROM unnest($4::text[]) AS s
     ON CONFLICT DO NOTHING`,
    [p.item_id, p.outlet_id, priceCents, confirmers],
  );
  return confirmers.length;
}

async function voteCounts(tx: Tx, proposalId: number) {
  const { rows } = await tx.query<{ yes: string; no: string }>(
    `SELECT COUNT(*) FILTER (WHERE vote = 'yes')::text AS yes, COUNT(*) FILTER (WHERE vote = 'no')::text AS no
       FROM cpm.votes WHERE proposal_id = $1`,
    [proposalId],
  );
  return { yes: Number(rows[0]?.yes ?? 0), no: Number(rows[0]?.no ?? 0) };
}

/** Record a vote and apply the outcome. Caller holds the pair lock and has checked the voter isn't the submitter. */
async function applyVote(tx: Tx, proposalId: number, required: number, studentId: string, vote: Vote) {
  await tx.query(
    `INSERT INTO cpm.votes (proposal_id, student_id, vote) VALUES ($1,$2,$3)
     ON CONFLICT (proposal_id, student_id) DO UPDATE SET vote = EXCLUDED.vote, created_at = NOW()`,
    [proposalId, studentId, vote],
  );
  const { yes, no } = await voteCounts(tx, proposalId);
  const outcome = resolveVotes(required, yes, no);
  if (outcome === 'live') await goLive(tx, proposalId);
  if (outcome === 'rejected') await tx.query(`UPDATE cpm.proposals SET status = 'rejected', resolved_at = NOW() WHERE id = $1`, [proposalId]);
  return { outcome, yes, no };
}

async function weeklySearches(tx: Tx, itemId: string) {
  const { rows } = await tx.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM cpm.searches WHERE item_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
    [itemId],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function submitProposal(db: Lakebase, studentId: string, body: SubmitProposalBody): Promise<SubmitProposalResult> {
  return withTransaction(db, async (tx) => {
    await requireItem(tx, body.itemId);
    await requireOutlet(tx, body.outletId);
    await lockPair(tx, body.itemId, body.outletId);
    const searches = await weeklySearches(tx, body.itemId);
    const result = (r: Omit<SubmitProposalResult, 'weeklySearches'>): SubmitProposalResult => ({ ...r, weeklySearches: searches });

    const official = (
      await tx.query<{ price_cents: number }>('SELECT price_cents FROM cpm.prices WHERE item_id = $1 AND outlet_id = $2', [
        body.itemId,
        body.outletId,
      ])
    ).rows[0];
    const currentCents = official ? Number(official.price_cents) : null;

    // 1. Same as the official price: a freshness confirmation, counted once per student per price.
    if (currentCents === body.priceCents) {
      const inserted = await tx.query(
        `INSERT INTO cpm.reconfirmations (item_id, outlet_id, student_id, price_cents) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING RETURNING 1`,
        [body.itemId, body.outletId, studentId, body.priceCents],
      );
      if (inserted.rows.length > 0) {
        await tx.query(
          `UPDATE cpm.prices SET confirmed_at = NOW(), confirmed_by = confirmed_by + 1 WHERE item_id = $1 AND outlet_id = $2`,
          [body.itemId, body.outletId],
        );
        return result({ outcome: 'reconfirmed', proposalId: null, required: 0, reasons: ['Matches the current price'] });
      }
      return result({ outcome: 'reconfirmed', proposalId: null, required: 0, reasons: ['You already confirmed this price'] });
    }

    const open = (
      await tx.query<ProposalRow2>(
        `SELECT id, student_id, price_cents, kind, evidence, status, required, reasons FROM cpm.proposals
          WHERE item_id = $1 AND outlet_id = $2 AND status IN ('pending', 'held') ORDER BY created_at`,
        [body.itemId, body.outletId],
      )
    ).rows;
    const medianCents = median(
      (await tx.query<{ price_cents: number }>('SELECT price_cents FROM cpm.prices WHERE item_id = $1', [body.itemId])).rows.map((r) =>
        Number(r.price_cents),
      ),
    );
    const trust = await studentTrust(tx, studentId);

    // 2. The student's own open report at the same price.
    const own = open.find((p) => p.student_id === studentId && Number(p.price_cents) === body.priceCents);
    if (own) {
      const ownId = Number(own.id);
      const alreadyMatched = own.reasons.includes(MATCH_REASON);
      if (own.kind !== body.kind && own.status === 'pending' && !alreadyMatched) {
        // Shelf and checkout prices from the same student match (either order): stronger evidence,
        // but the big-jump, outlier and trust rules still apply, and it always needs another student.
        const assessed = assessProposal({
          priceCents: body.priceCents,
          evidence: stronger(own.evidence, body.evidence),
          currentCents,
          campusMedianCents: medianCents,
          shelfMatchesCheckout: true,
          trust,
        });
        const required = Math.min(Number(own.required), assessed.required);
        await tx.query(`UPDATE cpm.proposals SET required = $2, reasons = array_append(reasons, $3) WHERE id = $1`, [ownId, required, MATCH_REASON]);
        const { yes, no } = await voteCounts(tx, ownId);
        if (resolveVotes(required, yes, no) === 'live') {
          await goLive(tx, ownId);
          return result({ outcome: 'live', proposalId: ownId, required, reasons: [MATCH_REASON] });
        }
        return result({ outcome: 'strengthened', proposalId: ownId, required, reasons: [MATCH_REASON] });
      }
      return result({
        outcome: own.status === 'held' ? 'held' : 'pending',
        proposalId: ownId,
        required: Number(own.required),
        reasons: ['You already reported this price'],
      });
    }

    // 3. Another student's open report at the same price.
    const match = open.find((p) => p.student_id !== studentId && Number(p.price_cents) === body.priceCents);
    if (match) {
      const matchId = Number(match.id);
      const required = Number(match.required);
      const myVote = (await tx.query('SELECT 1 FROM cpm.votes WHERE proposal_id = $1 AND student_id = $2', [matchId, studentId])).rows.length > 0;
      const { yes, no } = await voteCounts(tx, matchId);
      const independent = match.status === 'pending' && !myVote && no <= yes;
      if (independent) {
        // Two students reported the same new price without either voting on the other: it goes live.
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO cpm.proposals (item_id, outlet_id, student_id, price_cents, kind, evidence, required, status, reasons, resolved_at, via_match)
           VALUES ($1,$2,$3,$4,$5,$6,1,'live',ARRAY['Matched another student''s report'], NOW(), TRUE) RETURNING id`,
          [body.itemId, body.outletId, studentId, body.priceCents, body.kind, body.evidence],
        );
        await goLive(tx, matchId, [studentId]);
        return result({ outcome: 'live', proposalId: Number(inserted.rows[0].id), required: 1, reasons: ["Matched another student's report"] });
      }
      // Already voted, contested, or held: the report counts as one more "yes", nothing more.
      const applied = await applyVote(tx, matchId, required, studentId, 'yes');
      return result({
        outcome: applied.outcome === 'live' ? 'live' : match.status === 'held' ? 'held' : 'pending',
        proposalId: matchId,
        required,
        reasons: ['Counted as a confirmation of the same reported price'],
      });
    }

    // 4. A new proposal: work out how much confirmation it needs.
    const assessment = assessProposal({
      priceCents: body.priceCents,
      evidence: body.evidence,
      currentCents,
      campusMedianCents: medianCents,
      shelfMatchesCheckout: false,
      trust,
    });
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO cpm.proposals (item_id, outlet_id, student_id, price_cents, kind, evidence, required, status, reasons)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [body.itemId, body.outletId, studentId, body.priceCents, body.kind, body.evidence, assessment.required, assessment.status, assessment.reasons],
    );
    return result({
      outcome: assessment.status,
      proposalId: Number(inserted.rows[0].id),
      required: assessment.required,
      reasons: assessment.reasons,
    });
  });
}

export async function castVote(db: Lakebase, studentId: string, proposalId: number, vote: Vote): Promise<VoteResult> {
  return withTransaction(db, async (tx) => {
    const pair = (await tx.query<{ item_id: string; outlet_id: string }>('SELECT item_id, outlet_id FROM cpm.proposals WHERE id = $1', [proposalId]))
      .rows[0];
    if (!pair) throw new HttpError(404, 'Report not found');
    await lockPair(tx, pair.item_id, pair.outlet_id);

    // Read everything that matters under the lock.
    const p = (
      await tx.query<{ student_id: string; required: number; status: ProposalStatus }>(
        'SELECT student_id, required, status FROM cpm.proposals WHERE id = $1',
        [proposalId],
      )
    ).rows[0];
    if (p.student_id === studentId) throw new HttpError(403, 'Only another student can confirm your report');
    const required = Number(p.required);
    if (p.status !== 'pending' && p.status !== 'held') {
      return { status: p.status, ...(await voteCounts(tx, proposalId)), required };
    }

    const { outcome, yes, no } = await applyVote(tx, proposalId, required, studentId, vote);
    return { status: outcome === 'live' ? 'live' : outcome === 'rejected' ? 'rejected' : p.status, yes, no, required };
  });
}

// ---------------------------------------------------------------------------
// Sold out / back in stock
// ---------------------------------------------------------------------------

interface ActiveReport {
  id: string;
  kind: 'out' | 'back';
  student_id: string;
  status: 'possible' | 'confirmed';
  expires_at: Date;
}

async function activeReportsForPair(tx: Tx, itemId: string, outletId: string) {
  return (
    await tx.query<ActiveReport>(
      `SELECT id, kind, student_id, status, expires_at FROM cpm.stock_reports
        WHERE item_id = $1 AND outlet_id = $2 AND status IN ('possible', 'confirmed') AND expires_at > NOW()
        ORDER BY created_at`,
      [itemId, outletId],
    )
  ).rows;
}

async function recordStockVote(tx: Tx, reportId: number, studentId: string, vote: 'yes' | 'no') {
  await tx.query(
    `INSERT INTO cpm.stock_votes (report_id, student_id, vote) VALUES ($1,$2,$3)
     ON CONFLICT (report_id, student_id) DO UPDATE SET vote = EXCLUDED.vote, created_at = NOW()`,
    [reportId, studentId, vote],
  );
}

async function stockStateFor(tx: Tx, itemId: string, outletId: string): Promise<StockState> {
  const reports = await activeReportsForPair(tx, itemId, outletId);
  if (reports.some((r) => r.kind === 'out' && r.status === 'confirmed')) return 'sold_out';
  if (reports.some((r) => r.kind === 'out' && r.status === 'possible')) return 'possibly_out';
  return 'in_stock';
}

/** A student says an item is sold out, or back in stock, at an outlet. */
export async function reportStock(db: Lakebase, studentId: string, body: StockReportBody): Promise<StockResult> {
  return withTransaction(db, async (tx) => {
    await requireItem(tx, body.itemId);
    await requireOutlet(tx, body.outletId);
    await lockPair(tx, body.itemId, body.outletId);
    await applyStockReport(tx, studentId, body);
    return { state: await stockStateFor(tx, body.itemId, body.outletId) };
  });
}

async function applyStockReport(tx: Tx, studentId: string, body: StockReportBody) {
  const reports = await activeReportsForPair(tx, body.itemId, body.outletId);
  const confirmedOut = reports.find((r) => r.kind === 'out' && r.status === 'confirmed');
  const possibleOut = reports.find((r) => r.kind === 'out' && r.status === 'possible');
  const possibleBack = reports.find((r) => r.kind === 'back' && r.status === 'possible');

  if (body.kind === 'out') {
    if (confirmedOut) {
      if (confirmedOut.student_id !== studentId) await recordStockVote(tx, Number(confirmedOut.id), studentId, 'yes');
      // Someone saying it's still out cancels a pending "it's back".
      if (possibleBack && possibleBack.student_id !== studentId) {
        await recordStockVote(tx, Number(possibleBack.id), studentId, 'no');
        await tx.query(`UPDATE cpm.stock_reports SET status = 'cleared' WHERE id = $1`, [possibleBack.id]);
      }
      return;
    }
    if (possibleOut) {
      if (possibleOut.student_id === studentId) return; // can't confirm your own report
      await recordStockVote(tx, Number(possibleOut.id), studentId, 'yes');
      await tx.query(
        `UPDATE cpm.stock_reports SET status = 'confirmed', confirmed_at = NOW(), expires_at = ${confirmedSoldOutExpiry} WHERE id = $1`,
        [possibleOut.id],
      );
      return;
    }
    await tx.query(
      `INSERT INTO cpm.stock_reports (item_id, outlet_id, kind, student_id, status, expires_at)
       VALUES ($1,$2,'out',$3,'possible', NOW() + INTERVAL '${RULES.soldOutPossibleHours} hours')`,
      [body.itemId, body.outletId, studentId],
    );
    return;
  }

  // kind === 'back'
  if (confirmedOut) {
    if (possibleBack) {
      if (possibleBack.student_id === studentId) return;
      await recordStockVote(tx, Number(possibleBack.id), studentId, 'yes');
      await tx.query(`UPDATE cpm.stock_reports SET status = 'confirmed', confirmed_at = NOW() WHERE id = $1`, [possibleBack.id]);
      await tx.query(`UPDATE cpm.stock_reports SET status = 'cleared' WHERE id = $1`, [confirmedOut.id]);
      return;
    }
    await tx.query(
      `INSERT INTO cpm.stock_reports (item_id, outlet_id, kind, student_id, status, expires_at)
       VALUES ($1,$2,'back',$3,'possible',$4)`,
      [body.itemId, body.outletId, studentId, confirmedOut.expires_at],
    );
    return;
  }
  if (possibleOut) {
    // "No, it's here": an unconfirmed sold-out report is dropped (or retracted by its author).
    if (possibleOut.student_id !== studentId) await recordStockVote(tx, Number(possibleOut.id), studentId, 'no');
    await tx.query(`UPDATE cpm.stock_reports SET status = 'cleared' WHERE id = $1`, [possibleOut.id]);
  }
}

/** Answer the "can you check?" prompt on a stock report. */
export async function voteOnStockReport(db: Lakebase, studentId: string, reportId: number, vote: 'yes' | 'no'): Promise<StockResult> {
  return withTransaction(db, async (tx) => {
    const r = (
      await tx.query<{ item_id: string; outlet_id: string; kind: 'out' | 'back'; student_id: string }>(
        'SELECT item_id, outlet_id, kind, student_id FROM cpm.stock_reports WHERE id = $1',
        [reportId],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, 'Report not found');
    if (r.student_id === studentId) throw new HttpError(403, 'Only another student can confirm your report');
    await lockPair(tx, r.item_id, r.outlet_id);
    // "Yes" agrees with the report; "no" asserts the opposite.
    const kind: 'out' | 'back' = vote === 'yes' ? r.kind : r.kind === 'out' ? 'back' : 'out';
    await applyStockReport(tx, studentId, { itemId: r.item_id, outletId: r.outlet_id, kind });
    return { state: await stockStateFor(tx, r.item_id, r.outlet_id) };
  });
}

// ---------------------------------------------------------------------------
// Thank yous
// ---------------------------------------------------------------------------

export async function getMyStats(db: Lakebase, studentId: string): Promise<MyStats> {
  const { rows } = await db.query<{ reports: string; confirmations: string; live: string; rejected: string; helped: string }>(
    `WITH mine AS (
       SELECT item_id FROM cpm.proposals WHERE student_id = $1 AND created_at > NOW() - INTERVAL '7 days'
       UNION SELECT p.item_id FROM cpm.votes v JOIN cpm.proposals p ON p.id = v.proposal_id
              WHERE v.student_id = $1 AND v.created_at > NOW() - INTERVAL '7 days'
       UNION SELECT r.item_id FROM cpm.stock_votes sv JOIN cpm.stock_reports r ON r.id = sv.report_id
              WHERE sv.student_id = $1 AND sv.created_at > NOW() - INTERVAL '7 days'
       UNION SELECT item_id FROM cpm.reconfirmations WHERE student_id = $1 AND created_at > NOW() - INTERVAL '7 days'
     )
     SELECT
       (SELECT COUNT(*) FROM cpm.proposals WHERE student_id = $1 AND created_at > NOW() - INTERVAL '7 days')::text AS reports,
       ((SELECT COUNT(*) FROM cpm.votes WHERE student_id = $1 AND vote <> 'unsure' AND created_at > NOW() - INTERVAL '7 days')
        + (SELECT COUNT(*) FROM cpm.stock_votes WHERE student_id = $1 AND created_at > NOW() - INTERVAL '7 days')
        + (SELECT COUNT(*) FROM cpm.reconfirmations WHERE student_id = $1 AND created_at > NOW() - INTERVAL '7 days'))::text AS confirmations,
       (SELECT COUNT(*) FROM cpm.proposals WHERE student_id = $1 AND status = 'live' AND NOT via_match)::text AS live,
       (SELECT COUNT(*) FROM cpm.proposals WHERE student_id = $1 AND status = 'rejected')::text AS rejected,
       (SELECT COUNT(DISTINCT s.student_id) FROM cpm.searches s
         WHERE s.item_id IN (SELECT item_id FROM mine) AND s.student_id <> $1
           AND s.created_at > NOW() - INTERVAL '7 days')::text AS helped`,
    [studentId],
  );
  const r = rows[0];
  return {
    reportsThisWeek: Number(r?.reports ?? 0),
    confirmationsThisWeek: Number(r?.confirmations ?? 0),
    pricesWentLive: Number(r?.live ?? 0),
    studentsHelped: Number(r?.helped ?? 0),
    trust: trustLevel(Number(r?.live ?? 0), Number(r?.rejected ?? 0)),
  };
}
