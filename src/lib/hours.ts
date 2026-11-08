// Today's hours from an outlet's listed hours (`locations.hours`), for the Outlet page (docs/SPEC.md section 7).
//
// Hours are stored as listed, e.g. "M-F: 7 am - 7 pm; Sat-Sun: 9 am - 5 pm", "Daily: 11 am - 9 pm", "24hrs" or
// "W-M: 9 am - 6 pm; Tu: 9 am -7 pm" (ranges can wrap past Sunday). Anything this can't read returns null, and
// the page shows the hours exactly as listed instead. Campus time is Vancouver time.
//
// No imports on purpose, like search.ts: tests/hours.test.ts runs it directly with `node --test`.

export type TodayHours =
  | { kind: "open"; text: string }
  | { kind: "closed" }
  | { kind: "always" };

const DAYS: Record<string, number> = {
  su: 0, sun: 0, sunday: 0,
  m: 1, mo: 1, mon: 1, monday: 1,
  tu: 2, tue: 2, tues: 2, tuesday: 2,
  w: 3, we: 3, wed: 3, wednesday: 3,
  th: 4, thu: 4, thur: 4, thurs: 4, thursday: 4,
  f: 5, fr: 5, fri: 5, friday: 5,
  sa: 6, sat: 6, saturday: 6,
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function day(token: string): number | null {
  const d = DAYS[token.trim().toLowerCase().replace(/\.$/, "")];
  return d === undefined ? null : d;
}

/** "M-F" -> [1..5], "Sat-Tu" -> [6, 0, 1, 2], "Daily" -> all, "M, W" -> [1, 3]. Null if unreadable. */
function daysIn(part: string): number[] | null {
  const p = part.trim().toLowerCase();
  if (p === "daily" || p === "every day" || p === "everyday") return [0, 1, 2, 3, 4, 5, 6];
  const out: number[] = [];
  for (const piece of p.split(/\s*[,&]\s*/)) {
    const [from, to, ...rest] = piece.split(/\s*-\s*/);
    if (rest.length > 0) return null;
    const a = day(from);
    if (a === null) return null;
    if (to === undefined) {
      out.push(a);
      continue;
    }
    const b = day(to);
    if (b === null) return null;
    for (let d = a; ; d = (d + 1) % 7) {
      out.push(d);
      if (d === b) break;
    }
  }
  return out.length > 0 ? out : null;
}

/** "7 am -7pm" -> "7 am to 7 pm"; "11 am - 12 am" -> "11 am to midnight"; "12 pm - 7pm" -> "noon to 7 pm". */
function tidyTimes(times: string): string {
  return times
    .replace(/(\d)\s*([ap])\.?m\.?\b/gi, (_, d: string, ap: string) => `${d} ${ap.toLowerCase()}m`)
    .replace(/\s*-\s*/g, " to ")
    .replace(/\s+/g, " ")
    .replace(/\b12(?::00)? am\b/g, "midnight")
    .replace(/\b12(?::00)? pm\b/g, "noon")
    .trim();
}

/**
 * The hours for one day of the week (0 = Sunday), or null if the listing doesn't say or can't be read.
 * Later segments win when two mention the same day.
 */
export function hoursOn(hours: string | null, weekday: number): TodayHours | null {
  if (!hours) return null;
  if (/^\s*(open\s*)?24\s*(hrs|hours|h)\b/i.test(hours)) return { kind: "always" };
  let found: TodayHours | null = null;
  for (const segment of hours.split(";")) {
    // The day part has no digits, so the first colon after it is the separator ("Daily: 11:30 am - ...").
    const m = /^\s*([A-Za-z][A-Za-z\s,&.-]*?)\s*:\s*(.+?)\s*$/.exec(segment);
    if (!m) continue;
    const days = daysIn(m[1]);
    if (!days || !days.includes(weekday)) continue;
    const times = m[2];
    if (/^closed\b/i.test(times)) found = { kind: "closed" };
    else if (/^24\s*(hrs|hours|h)\b/i.test(times)) found = { kind: "always" };
    else if (/\d/.test(times)) found = { kind: "open", text: tidyTimes(times) };
  }
  return found;
}

/** Day of the week (0 = Sunday) on campus at `now`. */
export function campusWeekday(now: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Vancouver" }).format(now);
  const d = DAY_NAMES.indexOf(name as (typeof DAY_NAMES)[number]);
  return d === -1 ? now.getDay() : d;
}

/** "Today (Sunday): 9 am to 5 pm", "Closed today (Sunday)", "Open 24 hours today", or null. */
export function todayHoursText(hours: string | null, now: Date): string | null {
  const weekday = campusWeekday(now);
  const today = hoursOn(hours, weekday);
  if (!today) return null;
  const name = DAY_NAMES[weekday];
  switch (today.kind) {
    case "open":
      return `Today (${name}): ${today.text}`;
    case "closed":
      return `Closed today (${name})`;
    case "always":
      return "Open 24 hours today";
  }
}
