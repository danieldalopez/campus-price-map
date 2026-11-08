import { withTransaction, type Lakebase } from './db';
import { BC_AVERAGES, ITEMS, OUTLETS, SEED_PROPOSALS, SEED_STOCK, seedPrices, seedWeeklySearches } from './seed-data';

const SCHEMA_SQL = [
  `CREATE SCHEMA IF NOT EXISTS cpm`,
  `CREATE TABLE IF NOT EXISTS cpm.outlets (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     area TEXT NOT NULL,
     lat DOUBLE PRECISION NOT NULL,
     lng DOUBLE PRECISION NOT NULL,
     hours TEXT NOT NULL,
     sort INT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS cpm.items (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     size TEXT NOT NULL,
     category TEXT NOT NULL,
     barcode TEXT UNIQUE,
     icon TEXT NOT NULL,
     sort INT NOT NULL
   )`,
  // The official (live) price per item per outlet. No row means the outlet doesn't sell it.
  `CREATE TABLE IF NOT EXISTS cpm.prices (
     item_id TEXT NOT NULL REFERENCES cpm.items(id),
     outlet_id TEXT NOT NULL REFERENCES cpm.outlets(id),
     price_cents INT NOT NULL CHECK (price_cents > 0),
     confirmed_by INT NOT NULL DEFAULT 1,
     confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (item_id, outlet_id)
   )`,
  // Every student submission is a proposal; it only changes the official price once confirmed.
  `CREATE TABLE IF NOT EXISTS cpm.proposals (
     id BIGSERIAL PRIMARY KEY,
     item_id TEXT NOT NULL REFERENCES cpm.items(id),
     outlet_id TEXT NOT NULL REFERENCES cpm.outlets(id),
     student_id TEXT NOT NULL,
     price_cents INT NOT NULL CHECK (price_cents > 0),
     kind TEXT NOT NULL CHECK (kind IN ('shelf', 'checkout')),
     evidence TEXT NOT NULL CHECK (evidence IN ('typed', 'scan', 'receipt')),
     required INT NOT NULL CHECK (required >= 1),
     status TEXT NOT NULL CHECK (status IN ('pending', 'held', 'live', 'rejected', 'superseded')),
     reasons TEXT[] NOT NULL DEFAULT '{}',
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     resolved_at TIMESTAMPTZ,
     via_match BOOLEAN NOT NULL DEFAULT FALSE
   )`,
  `CREATE INDEX IF NOT EXISTS proposals_open_idx ON cpm.proposals (item_id, outlet_id) WHERE status IN ('pending', 'held')`,
  `CREATE INDEX IF NOT EXISTS proposals_student_idx ON cpm.proposals (student_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS cpm.votes (
     proposal_id BIGINT NOT NULL REFERENCES cpm.proposals(id) ON DELETE CASCADE,
     student_id TEXT NOT NULL,
     vote TEXT NOT NULL CHECK (vote IN ('yes', 'no', 'unsure')),
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (proposal_id, student_id)
   )`,
  `CREATE INDEX IF NOT EXISTS votes_student_idx ON cpm.votes (student_id, created_at)`,
  // Sold out / back in stock reports, with automatic expiry.
  `CREATE TABLE IF NOT EXISTS cpm.stock_reports (
     id BIGSERIAL PRIMARY KEY,
     item_id TEXT NOT NULL REFERENCES cpm.items(id),
     outlet_id TEXT NOT NULL REFERENCES cpm.outlets(id),
     kind TEXT NOT NULL CHECK (kind IN ('out', 'back')),
     student_id TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('possible', 'confirmed', 'cleared')),
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     confirmed_at TIMESTAMPTZ,
     expires_at TIMESTAMPTZ NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS stock_open_idx ON cpm.stock_reports (item_id, outlet_id, expires_at)`,
  `CREATE TABLE IF NOT EXISTS cpm.stock_votes (
     report_id BIGINT NOT NULL REFERENCES cpm.stock_reports(id) ON DELETE CASCADE,
     student_id TEXT NOT NULL,
     vote TEXT NOT NULL CHECK (vote IN ('yes', 'no')),
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (report_id, student_id)
   )`,
  // A student confirming the price already shown. One per student per price, so counts can't be inflated.
  `CREATE TABLE IF NOT EXISTS cpm.reconfirmations (
     item_id TEXT NOT NULL REFERENCES cpm.items(id),
     outlet_id TEXT NOT NULL REFERENCES cpm.outlets(id),
     student_id TEXT NOT NULL,
     price_cents INT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (item_id, outlet_id, student_id, price_cents)
   )`,
  `CREATE TABLE IF NOT EXISTS cpm.searches (
     id BIGSERIAL PRIMARY KEY,
     item_id TEXT NOT NULL REFERENCES cpm.items(id),
     student_id TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS searches_item_idx ON cpm.searches (item_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS cpm.bc_averages (
     item_id TEXT PRIMARY KEY REFERENCES cpm.items(id),
     label TEXT NOT NULL,
     price_cents INT NOT NULL CHECK (price_cents > 0),
     ref_period TEXT NOT NULL,
     is_sample BOOLEAN NOT NULL DEFAULT TRUE
   )`,
];

/**
 * v2 migration: 'superseded' status, and via_match (reports that went live by matching
 * don't count toward trust). Only runs when needed, because ALTER TABLE requires the
 * table owner (the deployed app's service principal), not a developer running locally.
 */
async function migrateV2(db: Lakebase): Promise<void> {
  const { rows } = await db.query<{ has_col: boolean; has_status: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'cpm' AND table_name = 'proposals' AND column_name = 'via_match') AS has_col,
       EXISTS (SELECT 1 FROM pg_constraint
                WHERE conname = 'proposals_status_check' AND pg_get_constraintdef(oid) LIKE '%superseded%') AS has_status`,
  );
  if (rows[0]?.has_col && rows[0]?.has_status) return;
  if (!rows[0]?.has_status) {
    await db.query('ALTER TABLE cpm.proposals DROP CONSTRAINT IF EXISTS proposals_status_check');
    await db.query(
      `ALTER TABLE cpm.proposals ADD CONSTRAINT proposals_status_check
         CHECK (status IN ('pending', 'held', 'live', 'rejected', 'superseded'))`,
    );
  }
  if (!rows[0]?.has_col) await db.query('ALTER TABLE cpm.proposals ADD COLUMN via_match BOOLEAN NOT NULL DEFAULT FALSE');
  console.log('[cpm] Migrated proposals table to v2');
}

/** Create the schema (idempotent) and load seed data the first time. */
export async function setupDatabase(db: Lakebase): Promise<void> {
  // DDL (even CREATE INDEX IF NOT EXISTS) needs the table owner. When the deployed app's
  // service principal already owns the schema, a developer running locally skips setup.
  const owner = await db.query<{ is_owner: boolean }>(
    `SELECT tableowner = current_user AS is_owner FROM pg_tables WHERE schemaname = 'cpm' AND tablename = 'proposals'`,
  );
  if (owner.rows[0] && !owner.rows[0].is_owner) {
    console.log('[cpm] Schema is owned by the app service principal; skipping setup (local development)');
    return;
  }

  for (const sql of SCHEMA_SQL) await db.query(sql);
  await migrateV2(db);

  const { rows } = await db.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM cpm.items');
  if (Number(rows[0]?.n ?? 0) > 0) {
    console.log('[cpm] Schema ready, seed data already present');
    return;
  }

  await withTransaction(db, async (tx) => {
    for (const [i, o] of OUTLETS.entries()) {
      await tx.query(
        'INSERT INTO cpm.outlets (id, name, area, lat, lng, hours, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [o.id, o.name, o.area, o.lat, o.lng, o.hours, i],
      );
    }
    for (const [i, it] of ITEMS.entries()) {
      await tx.query(
        'INSERT INTO cpm.items (id, name, size, category, barcode, icon, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [it.id, it.name, it.size, it.category, it.barcode, it.icon, i],
      );
    }
    const prices = seedPrices();
    for (const p of prices) {
      await tx.query(
        `INSERT INTO cpm.prices (item_id, outlet_id, price_cents, confirmed_by, confirmed_at)
         VALUES ($1,$2,$3,$4, NOW() - make_interval(mins => $5))`,
        [p.itemId, p.outletId, p.priceCents, p.confirmedBy, p.ageMinutes],
      );
    }
    for (const sp of SEED_PROPOSALS) {
      const base = prices.find((p) => p.itemId === sp.itemId && p.outletId === sp.outletId);
      if (!base) continue;
      await tx.query(
        `INSERT INTO cpm.proposals (item_id, outlet_id, student_id, price_cents, kind, evidence, required, status, reasons, created_at)
         VALUES ($1,$2,$3,$4,'shelf',$5,$6,'pending',$7, NOW() - make_interval(mins => $8))`,
        [
          sp.itemId,
          sp.outletId,
          sp.studentId,
          base.priceCents + sp.deltaCents,
          sp.reasons[0].startsWith('Receipt') ? 'receipt' : sp.reasons[0].startsWith('Typed') ? 'typed' : 'scan',
          sp.required,
          sp.reasons,
          sp.ageMinutes,
        ],
      );
    }
    for (const s of SEED_STOCK) {
      await tx.query(
        `INSERT INTO cpm.stock_reports (item_id, outlet_id, kind, student_id, status, created_at, expires_at)
         VALUES ($1,$2,'out',$3,'possible', NOW() - make_interval(mins => $4), NOW() + INTERVAL '45 minutes')`,
        [s.itemId, s.outletId, s.studentId, s.ageMinutes],
      );
    }
    for (const b of BC_AVERAGES) {
      await tx.query(
        'INSERT INTO cpm.bc_averages (item_id, label, price_cents, ref_period, is_sample) VALUES ($1,$2,$3,$4,TRUE)',
        [b.itemId, b.label, b.priceCents, b.refPeriod],
      );
    }
    // Spread a week of anonymous searches so the thank-you numbers are meaningful.
    for (const it of ITEMS) {
      await tx.query(
        `INSERT INTO cpm.searches (item_id, student_id, created_at)
         SELECT $1, 'seed-searcher-' || g, NOW() - (random() * INTERVAL '6 days')
         FROM generate_series(1, $2::int) AS g`,
        [it.id, seedWeeklySearches(it.id)],
      );
    }
  });
  console.log('[cpm] Created schema and loaded seed data');
}
