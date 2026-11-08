// Rate limits (docs/SPEC.md section 8, guardrail G5). Counted in the database, because in-memory counters
// don't survive across Vercel function instances. Counts use app_reader; app_writer can only insert.
// Server only.

import { query } from "./db";

/** Inserts per device per minute, across prices, price_votes and stock_reports. */
export const INSERTS_PER_MINUTE = 10;

/** Photo reads per device per minute. */
export const PHOTO_READS_PER_MINUTE = 10;

/**
 * Photo reads per day across everyone. The Gemini key is on the free tier, so this keeps us under its daily
 * quota. Set GEMINI_DAILY_CAP to change it; anything that isn't a positive whole number means 200.
 */
export function dailyPhotoCap(): number {
  const n = Number(process.env.GEMINI_DAILY_CAP);
  return Number.isInteger(n) && n > 0 ? n : 200;
}

/** How many rows this device inserted in the last minute. */
export async function recentInserts(deviceId: string): Promise<number> {
  const [row] = await query<{ n: string }>(
    "reader",
    `select (select count(*) from prices        where device_id = $1 and reported_at > now() - interval '1 minute')
          + (select count(*) from price_votes   where device_id = $1 and created_at  > now() - interval '1 minute')
          + (select count(*) from stock_reports where device_id = $1 and reported_at > now() - interval '1 minute') as n`,
    [deviceId],
  );
  return Number(row?.n ?? 0);
}

// "Today" is the calendar day in Vancouver, which is also when the Gemini free tier quota resets (midnight
// Pacific time).
const TODAY_START = "(date_trunc('day', now() at time zone 'America/Vancouver') at time zone 'America/Vancouver')";

/** Photo reads by this device in the last minute, and by everyone today. */
export async function photoReadCounts(deviceId: string): Promise<{ deviceMinute: number; today: number }> {
  const [row] = await query<{ device_minute: string; today: string }>(
    "reader",
    `select count(*) filter (where device_id = $1 and created_at > now() - interval '1 minute') as device_minute,
            count(*) filter (where created_at >= ${TODAY_START})                             as today
     from photo_reads
     where created_at >= least(${TODAY_START}, now() - interval '1 minute')`,
    [deviceId],
  );
  return { deviceMinute: Number(row?.device_minute ?? 0), today: Number(row?.today ?? 0) };
}

/** One row per photo read: the device and the time, nothing else (no image, no result). */
export async function recordPhotoRead(deviceId: string): Promise<void> {
  await query("writer", "insert into photo_reads (device_id) values ($1)", [deviceId]);
}
