"use client";

import { useId, useMemo, useState } from "react";
import { formatPrice } from "@/lib/format";
import type { PriceRow } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import {
  DEFAULT_CONFIG,
  futureValue,
  horizonWeeks,
  liveWalk,
  project,
  VERDICT_WORDS,
  type Horizon,
  type WalkConfig,
} from "@/lib/walkworth";
import { DirectionsButton } from "./DirectionsButton";
import { OutletLink } from "./OutletLink";

const WAGE_KEY = "cpm.wage";
const FIELD =
  "min-h-12 rounded-tag border-2 border-ink bg-card px-3 font-sans text-base text-ink focus-visible:outline-focus";

/** "+$0.20" or "−$0.31" (a real minus sign). */
function signed(x: number): string {
  return `${x < 0 ? "−" : "+"}${formatPrice(Math.abs(x))}`;
}

/** "2 minutes", "1.7 h". */
function minutesText(min: number): string {
  const m = Math.round(min);
  if (min < 90) return `${m} ${m === 1 ? "minute" : "minutes"}`;
  return `${Math.round((min / 60) * 10) / 10} h`;
}

/** "$18.25/h", "$24/h". */
function perHour(wage: number): string {
  return `$${Number.isInteger(wage) ? wage : wage.toFixed(2)}/h`;
}

/** The wage this phone saved (localStorage, never sent), or null for the BC minimum wage from app_config. */
function readSavedWage(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const n = Number(window.localStorage.getItem(WAGE_KEY));
    return n > 0 && n < 1000 ? n : null;
  } catch {
    return null;
  }
}

function writeSavedWage(w: number | null) {
  try {
    if (w === null) window.localStorage.removeItem(WAGE_KEY);
    else window.localStorage.setItem(WAGE_KEY, String(w));
  } catch {
    // Storage blocked: still used for this visit.
  }
}

/**
 * Worth the walk? (SPEC section 7; maths in src/lib/walkworth.ts, the same formula as Databricks). Always shows
 * the three numbers that decide it (saving, extra minutes, what those minutes are worth), then the verdict in
 * words (G14). Hidden when the closest outlet is already the cheapest or nothing cheaper is within reach.
 * Never uses estimated prices (G13). Rendered only in the browser, after prices load.
 */
export function WorthTheWalk({ rows }: { rows: PriceRow[] }) {
  const ids = useId();
  const configApi = useApi<WalkConfig>("/api/config");
  const config = configApi.data ?? DEFAULT_CONFIG;
  const [savedWage, setSavedWage] = useState<number | null>(readSavedWage);
  const wage = savedWage ?? config.bc_min_wage;
  const [wageText, setWageText] = useState<string | null>(null);
  const [perWeek, setPerWeek] = useState<number | null>(null);
  const [horizon, setHorizon] = useState<Horizon>("term");
  const [rate, setRate] = useState("");

  const walk = useMemo(
    () =>
      liveWalk(
        rows.map((r) => ({
          id: r.outlet.id,
          name: r.outlet.name,
          price: r.price,
          walk_min: r.walk_min,
          sold_out: r.stock === "sold_out",
          lat: r.outlet.lat,
          lng: r.outlet.lng,
        })),
        config,
        wage,
      ),
    [rows, config, wage],
  );
  if (!walk) return null;

  const best = walk.best;
  const v = VERDICT_WORDS[best.verdict];
  const weeks = horizonWeeks(config, horizon);
  const proj = perWeek ? project(best, perWeek, weeks) : null;
  const ratePct = rate.trim() === "" ? null : Number(rate.replace(",", "."));
  const fv =
    perWeek && ratePct !== null && horizon !== "term" ? futureValue(best.net, perWeek, ratePct, weeks) : null;
  const there = config.round_trip ? " there and back" : "";
  const verdictColour =
    best.verdict === "worth_it" ? "text-cheap" : best.verdict === "not_worth_it" ? "text-pricey" : "";

  function commitWage(text: string) {
    const n = Number(text.replace(/[$,\s]/g, ""));
    if (text.trim() === "") {
      setSavedWage(null);
      writeSavedWage(null);
    } else if (Number.isFinite(n) && n > 0 && n < 1000) {
      const w = Math.round(n * 100) / 100;
      setSavedWage(w);
      writeSavedWage(w);
    }
    setWageText(null);
  }

  return (
    <section aria-labelledby={`${ids}-h`} className="rounded-tag border-2 border-ink bg-card p-3 shadow-ink">
      <h2 id={`${ids}-h`} className="font-heading text-xl font-extrabold leading-snug">
        Worth the walk?{" "}
        <span className={verdictColour}>
          <span aria-hidden="true">{v.symbol}</span> {v.words}
        </span>
      </h2>
      <p className="mt-1">
        <span className="font-bold">{formatPrice(best.saving)} cheaper</span> at{" "}
        <OutletLink id={best.row.id} className="font-bold">
          {best.row.name}
        </OutletLink>{" "}
        than {walk.near.name} ·{" "}
        {best.extra_min === 0 ? "no extra walking" : `${minutesText(best.extra_min)} extra${there}`} (about{" "}
        {formatPrice(best.time_cost)} of your time at {perHour(wage)})
      </p>
      <p className="mt-1">
        <span className="font-bold">Net {signed(best.net)} each time</span>
        {best.break_even_wage !== null
          ? ` · worth it if your time is worth less than ${perHour(best.break_even_wage)}`
          : ""}
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-sm font-bold">
          I buy it
          <select
            className={FIELD}
            value={perWeek ?? ""}
            onChange={(e) => setPerWeek(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">how often?</option>
            {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "time" : "times"} a week
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm font-bold">
          for a
          <select className={FIELD} value={horizon} onChange={(e) => setHorizon(e.target.value as Horizon)}>
            <option value="term">term ({config.weeks_term} weeks)</option>
            <option value="year">year ({config.weeks_year} weeks)</option>
            <option value="degree">degree ({config.weeks_degree} weeks)</option>
          </select>
        </label>
      </div>

      <p aria-live="polite" className="mt-2">
        {proj ? (
          <>
            {formatPrice(proj.saved)} saved · {minutesText(proj.minutes)} walking ·{" "}
            <span className="font-bold">net {signed(proj.net)}</span>, if prices hold
          </>
        ) : (
          <span className="text-ink-2">Pick how often you buy it to see what it adds up to.</span>
        )}
      </p>

      {/* Only for a year or a degree: over a term, interest on a few dollars is close to zero (section 7). */}
      {proj && horizon !== "term" && best.net > 0 ? (
        <div className="mt-2">
          <label className="flex flex-wrap items-center gap-2">
            <span>Put the weekly saving aside at</span>
            <input
              className={`${FIELD} w-20`}
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              aria-label="Yearly interest rate, in percent"
            />
            <span>% a year</span>
          </label>
          {fv !== null ? (
            <p className="mt-1" aria-live="polite">
              <span aria-hidden="true">→ </span>
              <span className="font-bold">{formatPrice(fv)}</span> after a {horizon}, if prices hold
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3">
        <label className="flex flex-wrap items-center gap-2">
          <span>My time is worth $</span>
          <input
            className={`${FIELD} w-24`}
            inputMode="decimal"
            value={wageText ?? String(wage)}
            onChange={(e) => setWageText(e.target.value)}
            onBlur={(e) => commitWage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitWage(e.currentTarget.value);
            }}
            aria-describedby={`${ids}-wage`}
          />
          <span>/h</span>
        </label>
        <p id={`${ids}-wage`} className="mt-1 text-sm text-ink-2">
          {savedWage === null ? "Starts at the BC minimum wage. " : ""}Change it to your own; it stays on this
          phone.
        </p>
      </div>

      <DirectionsButton outlet={best.row} className="mt-3" />
    </section>
  );
}
