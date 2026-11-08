"use client";

import { createContext, useId, useMemo, useState } from "react";
import { formatPrice } from "@/lib/format";
import type { Item, PriceRow } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import {
  DEFAULT_CONFIG,
  DEFAULT_PER_WEEK,
  futureValue,
  HORIZONS,
  horizonWeeks,
  liveWalk,
  project,
  type WalkConfig,
} from "@/lib/walkworth";
import { DirectionsButton } from "./DirectionsButton";
import { OutletLink } from "./OutletLink";

/** app_config for pages that show Worth the walk lines (the Outlet page provides it from /api/config). */
export const WalkConfigContext = createContext<WalkConfig>(DEFAULT_CONFIG);

const FIELD =
  "min-h-12 rounded-tag border border-ink/60 bg-card px-3 font-sans text-base text-ink focus-visible:outline-focus";

const HORIZON_WORDS = { term: "a term", year: "a year", degree: "a degree" } as const;

function minutesText(min: number): string {
  const m = Math.round(min);
  return `${m} extra ${m === 1 ? "minute" : "minutes"}`;
}

/**
 * Worth the walk (SPEC section 7; maths in src/lib/walkworth.ts, checked against Databricks). The point is
 * what a few extra minutes add up to: the saving each time, then the total over a term, a year and a degree
 * at the student's own frequency (starts at 5 a week, changeable). Time is shown in minutes, never priced.
 * Hidden when the closest outlet is already the cheapest or nothing cheaper is within reach. Never uses
 * estimated prices (G13). Rendered only in the browser, after prices load.
 */
export function WorthTheWalk({ rows, item }: { rows: PriceRow[]; item: Pick<Item, "id" | "name" | "size"> }) {
  const ids = useId();
  const configApi = useApi<WalkConfig>("/api/config");
  const config = configApi.data ?? DEFAULT_CONFIG;
  const [perWeek, setPerWeek] = useState(DEFAULT_PER_WEEK);
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
      ),
    [rows, config],
  );
  if (!walk) return null;

  const best = walk.best;
  const totals = HORIZONS.map((h) => ({ h, ...project(best, perWeek, horizonWeeks(config, h)) }));
  const term = totals[0];
  const ratePct = rate.trim() === "" ? null : Number(rate.replace(",", "."));
  const fv = ratePct === null ? null : futureValue(best.saving, perWeek, ratePct, config.weeks_degree);
  const there = config.round_trip ? " there and back" : "";

  return (
    <section
      aria-labelledby={`${ids}-h`}
      className="rounded-tag border border-ink/20 border-l-4 border-l-cheap bg-card p-3"
    >
      <h2 id={`${ids}-h`} className="font-heading text-2xl font-extrabold leading-tight">
        Worth the walk: <span className="text-cheap">save {formatPrice(term.saved)} a term</span>
      </h2>
      <p className="mt-1">
        {best.extra_min === 0 ? "No extra walking" : `${minutesText(best.extra_min)}${there}`} to{" "}
        <OutletLink id={best.row.id} className="font-bold">
          {best.row.name}
        </OutletLink>{" "}
        instead of {walk.near.name} saves{" "}
        <span className="font-bold">{formatPrice(best.saving)} every time</span>.
      </p>

      <label className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-bold">I buy it</span>
        <select className={FIELD} value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))}>
          {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "time" : "times"} a week
            </option>
          ))}
        </select>
      </label>

      <ul aria-live="polite" className="mt-3 grid grid-cols-3 gap-2">
        {totals.map((t) => (
          <li key={t.h} className="rounded-tag bg-paper p-2 text-center">
            <p className="font-mono text-lg font-bold leading-tight text-cheap">{formatPrice(t.saved)}</p>
            <p className="text-sm leading-tight">saved {HORIZON_WORDS[t.h]}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-ink-2">
        {term.purchases} purchases a term ({config.weeks_term} weeks).
      </p>

      <div className="mt-3">
        <label className="flex flex-wrap items-center gap-2">
          <span>Put the savings aside at</span>
          <input
            className={`${FIELD} w-20`}
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="0"
            aria-label="Yearly interest rate, in percent"
          />
          <span>% a year</span>
        </label>
        {fv !== null ? (
          <p className="mt-1" aria-live="polite">
            <span aria-hidden="true">→ </span>
            <span className="font-bold">{formatPrice(fv)}</span> after a degree
          </p>
        ) : null}
      </div>

      <DirectionsButton
        outlet={best.row}
        item={{ id: item.id, name: item.name, size: item.size }}
        price={best.row.price}
        className="mt-3"
      />
    </section>
  );
}
