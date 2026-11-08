// Step 7, Pending vs Official (docs/SPEC.md sections 6 and 8), against a real Postgres:
//   - the status rules in db/views.sql (price_status, current_prices, pending_prices);
//   - POST /api/vote, the real route, as app_reader / app_writer with db/roles.sql's grants;
//   - the PRICE_SOURCE switch: live, pipeline, and the fallback when serving.price_comparisons is missing,
//     unreadable, empty, stale or broken; plus the "just confirmed" line in pipeline mode.
//
// Runs on a throwaway local Postgres started by tests/helpers/pg.ts (never Lakebase). Skips if Postgres
// isn't installed. Run with npm test.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { POST } from "../src/app/api/vote/route.ts";
import { loadPrices } from "../src/lib/prices.ts";
import { choosePriceSource } from "../src/lib/serving.ts";
import type { Item, VoteResult } from "../src/lib/types.ts";
import { SKIP_REASON, startTestPg, type TestPg } from "./helpers/pg.ts";
import { closePools, setDatabaseDown } from "./helpers/test-db.ts";

let db: TestPg | null = null;
try {
  db = await startTestPg();
} catch (err) {
  console.warn(`Couldn't start a local Postgres: ${(err as Error).message}`);
}
const skip = db ? false : SKIP_REASON;

before(() => {
  if (!db) return;
  process.env.TEST_DATABASE_URL_READER = db.readerUrl;
  process.env.TEST_DATABASE_URL_WRITER = db.writerUrl;
});

after(async () => {
  await closePools();
  await db?.stop();
});

// ---------------------------------------------------------------------------------------------------------
// Helpers. Each test takes its own outlet for item I01, so reports in one test never match another's.
// ---------------------------------------------------------------------------------------------------------

/** A device id in the shape the schema checks: dev(1) = "00000000-0000-0000-0000-000000000001". */
const dev = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const A = dev(1);
const B = dev(2);
const C = dev(3);
const D = dev(4);

let outlets: string[] = [];
let nextOutlet = 0;
/** An outlet with no I01 price of any kind yet. */
function freshOutlet(): string {
  const id = outlets[nextOutlet++];
  assert.ok(id, "ran out of outlets for tests");
  return id;
}

before(async () => {
  if (!db) return;
  const rows = await db.owner.query<{ id: string }>(
    `select id from locations l
     where not is_benchmark and not exists (select 1 from prices p where p.item_id = 'I01' and p.location_id = l.id)
     order by id`,
  );
  outlets = rows.rows.map((r) => r.id);
});

type Report = {
  price: number;
  device?: string | null;
  user?: string | null;
  source?: string;
  needsReview?: boolean;
  /** Postgres interval from now, e.g. "-49 hours". */
  ago?: string;
};

async function report(location: string, r: Report): Promise<number> {
  const { rows } = await db!.owner.query<{ id: string }>(
    `insert into prices (item_id, location_id, price, source, device_id, user_id, needs_review, reported_at)
     values ('I01', $1, $2, $3, $4, $5, $6, now() + $7::interval) returning id`,
    [location, r.price, r.source ?? "photo", r.device === undefined ? A : r.device, r.user ?? null,
      r.needsReview ?? false, r.ago ?? "0 seconds"],
  );
  return Number(rows[0].id);
}

async function vote(priceId: number, device: string, v: "yes" | "no" | "unsure", user: string | null = null) {
  await db!.owner.query("insert into price_votes (price_id, device_id, user_id, vote) values ($1, $2, $3, $4)", [
    priceId,
    device,
    user,
    v,
  ]);
}

type Status = { status: string; yes: number; no: number; matches: number; confirmations: number };

async function status(priceId: number): Promise<Status> {
  const { rows } = await db!.owner.query(
    "select status, yes, no, matches, confirmations from price_status where price_id = $1",
    [priceId],
  );
  const r = rows[0];
  return { status: r.status, yes: +r.yes, no: +r.no, matches: +r.matches, confirmations: +r.confirmations };
}

async function current(location: string): Promise<{ price_id: number; price: number } | null> {
  const { rows } = await db!.owner.query(
    "select price_id, price from current_prices where item_id = 'I01' and location_id = $1",
    [location],
  );
  return rows[0] ? { price_id: Number(rows[0].price_id), price: Number(rows[0].price) } : null;
}

async function pendingId(location: string): Promise<number | null> {
  const { rows } = await db!.owner.query(
    "select price_id from pending_prices where item_id = 'I01' and location_id = $1",
    [location],
  );
  return rows[0] ? Number(rows[0].price_id) : null;
}

// ---------------------------------------------------------------------------------------------------------
// Status rules (db/views.sql)
// ---------------------------------------------------------------------------------------------------------

describe("status rules in db/views.sql", { skip }, () => {
  it("a new student report is pending, listed in pending_prices and not in current_prices", async () => {
    const loc = freshOutlet();
    const id = await report(loc, { price: 3.25 });
    assert.equal((await status(id)).status, "pending");
    assert.equal(await pendingId(loc), id);
    assert.equal(await current(loc), null);
  });

  it("a yes from a different student makes it official and moves it to current_prices", async () => {
    const loc = freshOutlet();
    const id = await report(loc, { price: 3.25 });
    await vote(id, B, "yes");
    assert.deepEqual(await status(id), { status: "official", yes: 1, no: 0, matches: 0, confirmations: 1 });
    assert.deepEqual(await current(loc), { price_id: id, price: 3.25 });
    assert.equal(await pendingId(loc), null);
  });

  it("the reporter's own vote never counts", async () => {
    const id = await report(freshOutlet(), { price: 3.25 });
    await vote(id, A, "yes");
    assert.deepEqual(await status(id), { status: "pending", yes: 0, no: 0, matches: 0, confirmations: 0 });
  });

  it("a single no rejects; a tie stays pending; more no than yes rejects", async () => {
    const one = await report(freshOutlet(), { price: 3.25 });
    await vote(one, B, "no");
    assert.equal((await status(one)).status, "rejected");

    const loc = freshOutlet();
    const tie = await report(loc, { price: 3.25 });
    await vote(tie, B, "yes");
    await vote(tie, C, "no");
    assert.equal((await status(tie)).status, "pending");
    await vote(tie, D, "no");
    assert.equal((await status(tie)).status, "rejected");
    assert.equal(await pendingId(loc), null, "rejected reports are never shown");
    assert.equal(await current(loc), null);
  });

  it("unsure votes never count either way", async () => {
    const id = await report(freshOutlet(), { price: 3.25 });
    await vote(id, B, "unsure");
    await vote(id, C, "unsure");
    assert.deepEqual(await status(id), { status: "pending", yes: 0, no: 0, matches: 0, confirmations: 0 });
  });

  it("two students reporting within $0.10 and 48 h confirm each other", async () => {
    const loc = freshOutlet();
    const first = await report(loc, { price: 2.0, device: A, ago: "-47 hours" });
    const second = await report(loc, { price: 2.1, device: B });
    assert.deepEqual(await status(first), { status: "official", yes: 0, no: 0, matches: 1, confirmations: 1 });
    assert.equal((await status(second)).status, "official");
    assert.equal((await current(loc))?.price_id, second, "current_prices takes the newest official report");
  });

  it("$0.11 apart, more than 48 h apart, or the same student: no match", async () => {
    const far = freshOutlet();
    const p1 = await report(far, { price: 2.0, device: A });
    await report(far, { price: 2.11, device: B });
    assert.equal((await status(p1)).status, "pending", "$0.11 apart");

    const late = freshOutlet();
    const p2 = await report(late, { price: 2.0, device: A, ago: "-49 hours" });
    await report(late, { price: 2.0, device: B });
    assert.equal((await status(p2)).status, "pending", "49 h apart");

    const same = freshOutlet();
    const p3 = await report(same, { price: 2.0, device: A });
    await report(same, { price: 2.0, device: A });
    assert.equal((await status(p3)).status, "pending", "same device twice");
  });

  it("a voted-down report confirms nothing", async () => {
    const loc = freshOutlet();
    const bad = await report(loc, { price: 2.0, device: A });
    await vote(bad, C, "no");
    const good = await report(loc, { price: 2.05, device: B });
    assert.equal((await status(bad)).status, "rejected");
    assert.deepEqual(await status(good), { status: "pending", yes: 0, no: 0, matches: 0, confirmations: 0 });
  });

  it("needs_review takes 2 confirmations: yes votes plus matching reports", async () => {
    const votes = await report(freshOutlet(), { price: 9.0, needsReview: true });
    await vote(votes, B, "yes");
    assert.equal((await status(votes)).status, "pending");
    await vote(votes, C, "yes");
    assert.equal((await status(votes)).status, "official");

    const mixed = freshOutlet();
    const id = await report(mixed, { price: 9.0, needsReview: true, device: A });
    await vote(id, B, "yes");
    await report(mixed, { price: 9.05, device: C });
    assert.deepEqual(await status(id), { status: "official", yes: 1, no: 0, matches: 1, confirmations: 2 });
  });

  it("team and seed prices are official with no votes, and a no vote doesn't reject them", async () => {
    for (const source of ["walk", "menu", "grocery", "seed"]) {
      const id = await report(freshOutlet(), { price: 2.5, source, device: null });
      await vote(id, B, "no");
      assert.equal((await status(id)).status, "official", source);
    }
  });

  it("a different student means a different user_id when both have one, else a different device", async () => {
    // Same Auth0 user on a second device: still the same student.
    const sameUser = await report(freshOutlet(), { price: 3.0, device: A, user: "auth0|1" });
    await vote(sameUser, B, "yes", "auth0|1");
    assert.equal((await status(sameUser)).status, "pending");

    // Two users sharing one device: different students.
    const sharedDevice = await report(freshOutlet(), { price: 3.0, device: A, user: "auth0|1" });
    await vote(sharedDevice, A, "yes", "auth0|2");
    assert.equal((await status(sharedDevice)).status, "official");

    // Only one side logged in: compare devices.
    const mixed = await report(freshOutlet(), { price: 3.0, device: A });
    await vote(mixed, A, "yes", "auth0|3");
    assert.equal((await status(mixed)).status, "pending");
  });

  it("a pending report older than the official price isn't shown", async () => {
    const loc = freshOutlet();
    const old = await report(loc, { price: 4.0, device: A, ago: "-2 hours" });
    const newer = await report(loc, { price: 3.5, device: B, ago: "-1 hour" });
    await vote(newer, C, "yes");
    assert.equal((await status(old)).status, "pending");
    assert.equal(await pendingId(loc), null);
    assert.equal((await current(loc))?.price_id, newer);
  });

  it("a new official report replaces the seed price", async () => {
    const { rows } = await db!.owner.query(
      "select location_id, price from current_prices where item_id = 'I02' and source = 'seed' limit 1",
    );
    const loc: string = rows[0].location_id;
    const { rows: ins } = await db!.owner.query(
      `insert into prices (item_id, location_id, price, source, device_id) values ('I02', $1, 1.99, 'photo', $2)
       returning id`,
      [loc, A],
    );
    const id = Number(ins[0].id);
    const pending = await db!.owner.query("select price_id from pending_prices where item_id = 'I02' and location_id = $1", [loc]);
    assert.equal(Number(pending.rows[0].price_id), id, "pending above the seed price");
    await vote(id, B, "yes");
    const now = await db!.owner.query("select price, source from current_prices where item_id = 'I02' and location_id = $1", [loc]);
    assert.deepEqual({ price: Number(now.rows[0].price), source: now.rows[0].source }, { price: 1.99, source: "photo" });
  });
});

// ---------------------------------------------------------------------------------------------------------
// POST /api/vote
// ---------------------------------------------------------------------------------------------------------

async function postVote(body: unknown): Promise<{ status: number; body: VoteResult & { error?: string } }> {
  const res = await POST(
    new Request("http://test/api/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  assert.equal(res.headers.get("cache-control"), "no-store");
  return { status: res.status, body: await res.json() };
}

/** A device that hasn't voted yet, so the 10 a minute limit only trips where a test means it to. */
let voters = 0;
const voter = () => dev(1000 + voters++);

async function voteCount(priceId: number): Promise<number> {
  const { rows } = await db!.owner.query("select count(*) as n from price_votes where price_id = $1", [priceId]);
  return Number(rows[0].n);
}

describe("POST /api/vote", { skip }, () => {
  beforeEach(() => setDatabaseDown(false));

  it("Show me: a report goes pending, then official after a second device says yes", async () => {
    const loc = freshOutlet();
    const id = await report(loc, { price: 3.25, device: A });

    const live = await loadPrices({ item: { id: "I01" } as Item, origin: null, deviceId: A });
    const mine = live.rows.find((r) => r.outlet.id === loc);
    assert.equal(mine?.price, null);
    assert.deepEqual(mine?.pending, { price_id: id, price: 3.25, mine: true, my_vote: null });

    const res = await postVote({ price_id: id, vote: "yes", device_id: voter() });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { status: "official", confirmations: 1, recorded: true });

    const afterVote = await loadPrices({ item: { id: "I01" } as Item, origin: null, deviceId: B });
    const row = afterVote.rows.find((r) => r.outlet.id === loc);
    assert.equal(row?.price, 3.25);
    assert.equal(row?.source, "photo");
    assert.equal(row?.confirmations, 1);
    assert.equal(row?.pending, null);
  });

  it("refuses a vote on your own report", async () => {
    const id = await report(freshOutlet(), { price: 3.25, device: A });
    const res = await postVote({ price_id: id, vote: "yes", device_id: A });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "You can't confirm your own price.");
    assert.equal(await voteCount(id), 0);
  });

  it("a duplicate vote returns the current status, not an error", async () => {
    const id = await report(freshOutlet(), { price: 3.25, device: A });
    const voterB = voter();
    const first = await postVote({ price_id: id, vote: "unsure", device_id: voterB });
    assert.equal(first.status, 201);
    assert.deepEqual(first.body, { status: "pending", confirmations: 0, recorded: true });

    const again = await postVote({ price_id: id, vote: "yes", device_id: voterB });
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { status: "pending", confirmations: 0, recorded: false });
    assert.equal(await voteCount(id), 1);
  });

  it("a no rejects the report", async () => {
    const id = await report(freshOutlet(), { price: 3.25, device: A });
    const res = await postVote({ price_id: id, vote: "no", device_id: voter() });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, "rejected");
  });

  it("a vote on a price that isn't pending records nothing and returns where it stands", async () => {
    const seed = await report(freshOutlet(), { price: 2.5, source: "seed", device: null });
    const res = await postVote({ price_id: seed, vote: "no", device_id: voter() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "official", confirmations: 0, recorded: false });
    assert.equal(await voteCount(seed), 0);
  });

  it("404 for a price that doesn't exist", async () => {
    const res = await postVote({ price_id: 999_999_999, vote: "yes", device_id: voter() });
    assert.equal(res.status, 404);
    assert.match(res.body.error ?? "", /isn't there anymore/);
  });

  it("400 for a body that isn't valid", async () => {
    const id = await report(freshOutlet(), { price: 3.25, device: A });
    for (const body of [
      "not json",
      { price_id: "x", vote: "yes", device_id: voter() },
      { price_id: -1, vote: "yes", device_id: voter() },
      { price_id: id, vote: "maybe", device_id: voter() },
      { price_id: id, vote: "yes", device_id: "not-a-device" },
      { price_id: id, vote: "yes" },
    ]) {
      const res = await postVote(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(typeof res.body.error, "string");
    }
    assert.equal(await voteCount(id), 0);
  });

  it("429 after 10 inserts from one device in a minute", async () => {
    const spammer = dev(99);
    const loc = freshOutlet();
    for (let i = 0; i < 10; i++) await report(loc, { price: 5 + i, device: spammer });
    const target = await report(freshOutlet(), { price: 3.25, device: A });
    const res = await postVote({ price_id: target, vote: "yes", device_id: spammer });
    assert.equal(res.status, 429);
    assert.equal(await voteCount(target), 0);
  });

  it("503 with a plain sentence when the database is unreachable", async () => {
    setDatabaseDown(true);
    const res = await postVote({ price_id: 1, vote: "yes", device_id: voter() });
    setDatabaseDown(false);
    assert.equal(res.status, 503);
    assert.match(res.body.error ?? "", /isn't reachable/);
  });
});

// ---------------------------------------------------------------------------------------------------------
// PRICE_SOURCE switch, fallback and "just confirmed" (section 8)
// ---------------------------------------------------------------------------------------------------------

const PC_COLUMNS = `
  item_id text, location_id text, price numeric(6,2), source text, confirmations int, updated_at timestamptz,
  n_outlets int, campus_median numeric(6,2), band text, pct_vs_median numeric, chip text,
  nearest_cheaper_location_id text, nearest_cheaper_price numeric(6,2), nearest_cheaper_walk_min int,
  est_low numeric(6,2), est_high numeric(6,2),
  walk_best_location_id text, walk_saving numeric(6,2), walk_extra_min numeric,
  statcan_kind text, statcan_value numeric, statcan_geo text, statcan_ref_month text, statcan_note text,
  computed_at timestamptz`;

describe("PRICE_SOURCE switch and the just confirmed line", { skip }, () => {
  const saved = process.env.PRICE_SOURCE;
  after(() => {
    if (saved === undefined) delete process.env.PRICE_SOURCE;
    else process.env.PRICE_SOURCE = saved;
  });

  const sql = (text: string, values: unknown[] = []) => db!.owner.query(text, values);
  const use = async () => (await choosePriceSource()).use;

  it("live unless PRICE_SOURCE is 'pipeline'", async () => {
    delete process.env.PRICE_SOURCE;
    assert.equal(await use(), "live");
    process.env.PRICE_SOURCE = "live";
    assert.equal(await use(), "live");
  });

  it("falls back to live while serving.price_comparisons is missing, not granted or empty", async () => {
    process.env.PRICE_SOURCE = "pipeline";
    assert.equal(await use(), "live", "no serving schema");

    await sql(`create schema serving; create table serving.price_comparisons (${PC_COLUMNS})`);
    assert.equal(await use(), "live", "no grant to app_reader yet");

    await sql("grant usage on schema serving to app_reader; grant select on all tables in schema serving to app_reader");
    assert.equal(await use(), "live", "empty");
  });

  it("uses the pipeline when fresh, live when 3 h old or more", async () => {
    process.env.PRICE_SOURCE = " Pipeline ";
    await sql(
      `insert into serving.price_comparisons (item_id, location_id, price, source, confirmations, updated_at, chip, computed_at)
       values ('I05', 'blue-chip-cafe', 2.00, 'seed', 0, now() - interval '1 day', 'stale row', now() - interval '3 hours 1 minute')`,
    );
    assert.equal(await use(), "live", "stale");
    const stale = await loadPrices({ item: { id: "I05" } as Item, origin: null, deviceId: undefined });
    assert.equal(stale.price_source_used, "live");
    assert.ok(stale.rows.every((r) => r.chip === null), "no chips in live mode");

    await sql("delete from serving.price_comparisons");
    await sql(
      `insert into serving.price_comparisons (item_id, location_id, price, source, confirmations, updated_at, chip, band, computed_at)
       values ('I05', 'blue-chip-cafe', 2.00, 'seed', 0, now() - interval '1 day', 'Cheapest on campus', 'good', now() - interval '10 minutes')`,
    );
    const choice = await choosePriceSource();
    assert.equal(choice.use, "pipeline");
    const fresh = await loadPrices({ item: { id: "I05" } as Item, origin: null, deviceId: undefined });
    assert.equal(fresh.price_source_used, "pipeline");
    assert.ok(fresh.computed_at);
    const row = fresh.rows.find((r) => r.outlet.id === "blue-chip-cafe");
    assert.equal(row?.chip, "Cheapest on campus");
    assert.equal(row?.just_confirmed, null);
  });

  it("Show me: in pipeline mode a live confirmation shows as just confirmed, and the big price stays the pipeline's", async () => {
    process.env.PRICE_SOURCE = "pipeline";
    const loc = freshOutlet();
    await sql(
      `insert into serving.price_comparisons (item_id, location_id, price, source, confirmations, updated_at, computed_at)
       values ('I01', $1, 3.50, 'seed', 0, now() - interval '1 hour', now() - interval '5 minutes')`,
      [loc],
    );
    const id = await report(loc, { price: 3.25, device: A });

    const before = await loadPrices({ item: { id: "I01" } as Item, origin: null, deviceId: C });
    const pendingRow = before.rows.find((r) => r.outlet.id === loc);
    assert.equal(before.price_source_used, "pipeline");
    assert.equal(pendingRow?.price, 3.5);
    assert.deepEqual(pendingRow?.pending, { price_id: id, price: 3.25, mine: false, my_vote: null }, "pending is live");
    assert.equal(pendingRow?.just_confirmed, null);

    const res = await postVote({ price_id: id, vote: "yes", device_id: voter() });
    assert.equal(res.body.status, "official");

    const afterVote = await loadPrices({ item: { id: "I01" } as Item, origin: null, deviceId: C });
    const row = afterVote.rows.find((r) => r.outlet.id === loc);
    assert.equal(row?.price, 3.5, "the pipeline's price until the next refresh");
    assert.equal(row?.just_confirmed?.price, 3.25);
    assert.equal(row?.pending, null);
  });

  it("a broken serving table falls back to live instead of failing (rule 10)", async () => {
    process.env.PRICE_SOURCE = "pipeline";
    await sql("alter table serving.price_comparisons drop column chip");
    const res = await loadPrices({ item: { id: "I05" } as Item, origin: null, deviceId: undefined });
    assert.equal(res.price_source_used, "live");
    assert.ok(res.rows.length > 0);
  });
});
