// Today's hours on the Outlet page (src/lib/hours.ts). Run with `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hoursOn, todayHoursText } from "../src/lib/hours.ts";

const SUN = 0, MON = 1, TUE = 2, FRI = 5, SAT = 6;

describe("hoursOn", () => {
  it("reads day ranges, Daily and 24hrs", () => {
    const h = "M-F: 7 am - 7 pm; Sat-Sun: 9 am - 5 pm";
    assert.deepEqual(hoursOn(h, MON), { kind: "open", text: "7 am to 7 pm" });
    assert.deepEqual(hoursOn(h, SUN), { kind: "open", text: "9 am to 5 pm" });
    assert.deepEqual(hoursOn("Daily: 11:30 am - 8:30 pm; Closed Holidays", TUE), { kind: "open", text: "11:30 am to 8:30 pm" });
    assert.deepEqual(hoursOn("24hrs", SAT), { kind: "always" });
  });

  it("reads closed days, ranges that wrap past Sunday and messy spacing", () => {
    assert.deepEqual(hoursOn("M-F: 7 am - 6 pm; Sat-Sun: Closed", SAT), { kind: "closed" });
    assert.deepEqual(hoursOn("W-M: 9 am - 6 pm; Tu: 9 am -7 pm", TUE), { kind: "open", text: "9 am to 7 pm" });
    assert.deepEqual(hoursOn("W-M: 9 am - 6 pm; Tu: 9 am -7 pm", SUN), { kind: "open", text: "9 am to 6 pm" });
    assert.deepEqual(hoursOn("M-Th: 11 am - 11 pm; Fri -Sat: 11 am - 12 am ; Sun: 11 am - 11 pm", FRI), {
      kind: "open",
      text: "11 am to midnight",
    });
    assert.deepEqual(hoursOn("M: 4 - 9:00 PM; Tu-Sun: 11:30 AM - 9:30 PM", MON), { kind: "open", text: "4 to 9:00 pm" });
  });

  it("returns null when the listing doesn't say", () => {
    assert.equal(hoursOn("Tu: 4 pm - 6 pm; Sat: 10 am - 2 pm", SUN), null);
    assert.equal(hoursOn(null, SUN), null);
    assert.equal(hoursOn("ask inside", SUN), null);
  });
});

describe("todayHoursText", () => {
  it("uses Vancouver's day, not the server's", () => {
    // 2026-11-09 03:00 UTC is still Sunday evening in Vancouver.
    const sundayNight = new Date("2026-11-09T03:00:00Z");
    assert.equal(todayHoursText("M-F: 7 am - 7 pm; Sat-Sun: 9 am - 5 pm", sundayNight), "Today (Sunday): 9 am to 5 pm");
    assert.equal(todayHoursText("M-F: 7 am - 6 pm; Sat-Sun: Closed", sundayNight), "Closed today (Sunday)");
  });
});
