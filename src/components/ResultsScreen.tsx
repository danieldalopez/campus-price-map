"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatPrice, spokenPrice } from "@/lib/format";
import {
  getLocationSnapshot,
  NEST_MESSAGE,
  requestLocation,
  resumeLocationIfGranted,
  roundLatLng,
  type LocationState,
} from "@/lib/geo";
import { ItemArt } from "@/components/ItemArt";
import {
  bestDeal,
  cheapestRow,
  decide,
  decisionText,
  fartherStandsOut,
  groceryText,
  isComparable,
  isNear,
  referencePrice,
  splitSections,
  withWalkFrom,
  type Decision,
} from "@/lib/pricing";
import { statcanLine } from "@/lib/statcan";
import type { PriceRow, PricesResponse } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useLocation } from "@/lib/use-location";
import { play } from "@/lib/sounds";
import { useNow } from "@/lib/use-now";
import { DEFAULT_CONFIG, DEFAULT_PER_WEEK, liveWalk, project } from "@/lib/walkworth";
import { Button, buttonClasses } from "./Button";
import { usePricesChanged } from "./BoughtProvider";
import { OutletLink } from "./OutletLink";
import { OutletRow } from "./OutletRow";
import { PricesRefresh } from "./PendingLine";
import { ReadAloud } from "./ReadAloud";
import { SoundToggle } from "./SoundToggle";
import { Stamp } from "./Stamp";
import { WakingUp } from "./WakingUp";
import { WhileVisible } from "./WhileVisible";
import { WorthTheWalk } from "./WorthTheWalk";

// Leaflet is client only: never server render the map (SPEC rule 9).
const ResultsMap = dynamic(() => import("./ResultsMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-paper-2" aria-hidden="true" />,
});

const CARD = "rounded-tag border border-ink/20 bg-card p-3";

/** "Near you" only when walk times really are from the student; otherwise from the AMS Nest. */
function nearLabel(usingNest: boolean): string {
  return usingNest ? "Near AMS Nest" : "Near you";
}

/** The same, mid-sentence. */
function nearWords(usingNest: boolean): string {
  return usingNest ? "near AMS Nest" : "near you";
}

/** Where walk times are measured from, in one quiet line (SPEC section 7, "Location"). */
function LocationLine({ location }: { location: LocationState }) {
  if (!location.usingNest) {
    return <p className="text-sm text-ink-2">Walk times are from where you are.</p>;
  }
  if (location.status === "asking") {
    return <p className="text-sm text-ink-2">Finding where you are… distances from AMS Nest until then.</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-ink-2">
      <span className="sr-only">{NEST_MESSAGE}</span>
      <span aria-hidden="true">Distances from AMS Nest</span>
      {location.status === "off" ? (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={requestLocation}
            className="-my-3 inline-flex min-h-12 items-center rounded-tag px-1 font-bold text-ink underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-focus"
          >
            Use my location
          </button>
        </>
      ) : null}
    </p>
  );
}

/** "~3 min" or "<1 min", for the compact summary. */
function shortWalk(min: number | null): string | null {
  if (min === null) return null;
  return min < 1 ? "<1 min" : `~${min} min`;
}

/**
 * The one-line answer under the header: where to go, the price and the walk. Says "cheapest" only when at
 * least two prices were compared; with one price it says so instead.
 */
function Summary({ decision, rows, usingNest }: { decision: Decision; rows: PriceRow[]; usingNest: boolean }) {
  if (decision.kind === "none") {
    return <p className="font-heading text-lg font-extrabold leading-snug">No confirmed price for this item yet.</p>;
  }
  const target = decision.kind === "save" ? decision.at : decision.closest;
  const pool = rows.filter(isComparable).filter((r) => decision.scope === "campus" || isNear(r));
  const walk = shortWalk(target.walk_min);
  const from = walk ? `${walk} walk${usingNest ? " from AMS Nest" : ""}` : null;
  const lead =
    decision.kind === "save"
      ? `Save ${formatPrice(decision.saving)} at`
      : pool.length < 2
        ? decision.scope === "near"
          ? "1 nearby price found:"
          : "1 price found:"
        : decision.scope === "near"
          ? "Cheapest nearby:"
          : "Cheapest on campus:";
  return (
    <p className="leading-snug">
      <span className="block text-sm font-bold text-ink-2">{lead}</span>
      <span className="block font-heading text-base font-extrabold">{target.outlet.name}</span>
      <span className="sr-only">, </span>
      <span className="block font-mono text-lg font-bold">{formatPrice(target.price)}</span>
      {from ? (
        <span className="block text-sm text-ink-2">
          <span className="sr-only">, </span>
          {from}
        </span>
      ) : null}
    </p>
  );
}

type SectionProps = {
  id: string;
  title: string;
  hint: string;
  rows: PriceRow[];
  empty: string;
  now: number;
  cheapestId: string | null;
  /** Farther only: the price a row has to beat by $1.00 to stand out. */
  reference?: number | null;
  item: { id: string; name: string; size: string };
  /** "near you" or "near AMS Nest", for a Farther row's saving. */
  nearWords: string;
};

function Section({ id, title, hint, rows, empty, now, cheapestId, reference, item, nearWords }: SectionProps) {
  const farther = reference !== undefined;
  return (
    <section aria-labelledby={id} className="mt-5 px-4">
      <h2 id={id} className="font-heading text-xl font-extrabold leading-tight">
        {title}
      </h2>
      <p className="text-sm text-ink-2">{hint}</p>
      {rows.length === 0 ? (
        <p className="mt-2">{empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {rows.map((row) => {
            const standsOut = farther && fartherStandsOut(row, reference ?? null);
            const saves =
              standsOut && row.price !== null && reference !== null && reference !== undefined
                ? Math.round((reference - row.price) * 100) / 100
                : null;
            return (
              <OutletRow
                key={row.outlet.id}
                row={row}
                now={now}
                cheapest={row.outlet.id === cheapestId}
                dimmed={farther && !standsOut}
                saves={saves}
                nearWords={nearWords}
                item={item}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * What Read aloud says (SPEC section 7): the decision line, the top 3 outlets with an official price
 * ("Grocery Checkout, 3 dollars 59, about 1 minute"), and the Worth the walk saving if there is one.
 */
/**
 * "Best deal" at the top of Results: a multi-buy deal that beats every other outlet's single price, so it
 * shows first even when that outlet is in Farther (data/deals.csv). Hidden when there's none.
 */
function BestDeal({ rows }: { rows: PriceRow[] }) {
  const best = bestDeal(rows);
  if (!best) return null;
  const { deal } = best;
  return (
    <section
      aria-label="Best deal"
      className="flex items-start gap-2 rounded-tag border-2 border-cheap bg-card px-3 py-2"
    >
      <Stamp kind="deal" className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-bold">
          {deal.qty} for {formatPrice(deal.price)}
        </span>{" "}
        at{" "}
        <OutletLink id={best.outlet.id} className="font-bold">
          {best.outlet.name}
        </OutletLink>{" "}
        · {formatPrice(deal.each)} each,{" "}
        <span className="font-bold text-cheap">cheapest on campus if you buy {deal.qty}</span>
      </p>
    </section>
  );
}

function readAloudText(itemName: string, decisionLine: string, ordered: PriceRow[], nearWords: string): string {
  const top = ordered.filter((r) => r.price !== null && r.stock !== "sold_out").slice(0, 3);
  const parts = [`${itemName}. ${decisionLine}.`];
  const deal = bestDeal(ordered);
  if (deal) {
    parts.push(
      `Best deal: ${deal.deal.qty} for ${spokenPrice(deal.deal.price)} at ${deal.outlet.name}, ${spokenPrice(deal.deal.each)} each, cheapest on campus if you buy ${deal.deal.qty}.`,
    );
  }
  if (top.length > 0) {
    parts.push(
      `Cheapest ${nearWords}: ${top
        .map((r) => {
          const walk = r.walk_min === null ? "" : `, about ${r.walk_min} ${r.walk_min === 1 ? "minute" : "minutes"}`;
          return `${r.outlet.name}, ${spokenPrice(r.price as number)}${walk}`;
        })
        .join(". ")}.`,
    );
  }
  const walk = liveWalk(
    ordered.map((r) => ({ id: r.outlet.id, name: r.outlet.name, price: r.price, walk_min: r.walk_min, sold_out: r.stock === "sold_out" })),
    DEFAULT_CONFIG,
  );
  if (walk) {
    const term = project(walk.best, DEFAULT_PER_WEEK, DEFAULT_CONFIG.weeks_term);
    parts.push(
      `Worth the walk: ${Math.round(walk.best.extra_min)} extra minutes to ${walk.best.row.name} saves ${spokenPrice(walk.best.saving)} every time, about ${spokenPrice(term.saved)} a term if you buy it ${DEFAULT_PER_WEEK} times a week.`,
    );
  }
  return parts.join(" ");
}

/** Results for one item: decision line, small map, Near you, Farther. SPEC section 7. */
export default function ResultsScreen({ itemId }: { itemId: string }) {
  const location = useLocation();
  const now = useNow(60_000);
  useEffect(() => resumeLocationIfGranted(), []);

  // Prices are fetched once, from where the student was when the page opened (rounded to about 11 m).
  // After that, walk times and the sort are recomputed here whenever they move more than 30 m.
  const [fetchFrom] = useState(() => roundLatLng(getLocationSnapshot().origin));
  const api = useApi<PricesResponse>(
    `/api/prices?item=${encodeURIComponent(itemId)}&lat=${fetchFrom.lat}&lng=${fetchFrom.lng}`,
  );
  usePricesChanged(api.retry);
  const data = api.data;

  const rows = useMemo(() => (data ? withWalkFrom(data.rows, location.origin) : []), [data, location.origin]);
  const sections = useMemo(() => splitSections(rows), [rows]);
  const decision = useMemo(() => decide(rows), [rows]);
  // "Cha-ching" once, when the results that a tap opened show a cheaper spot (SPEC section 9c).
  const chimed = useRef(false);
  useEffect(() => {
    if (!chimed.current && data && decision.kind === "save") {
      chimed.current = true;
      play("chaching");
    }
  }, [data, decision]);
  const spoken = useMemo(
    () =>
      data
        ? readAloudText(
            data.item.name,
            decisionText(decision).replace(/near you/g, nearWords(location.usingNest)),
            [...sections.near, ...sections.farther],
            nearWords(location.usingNest),
          )
        : null,
    [data, decision, sections, location.usingNest],
  );
  const cheapest = useMemo(() => cheapestRow(rows), [rows]);
  const reference = referencePrice(decision);
  const bestPrice = decision.kind === "save" ? decision.at.price : decision.kind === "none" ? null : decision.closest.price;
  const item = data?.item ?? null;
  const statcan = data?.bc ? statcanLine(data.bc, bestPrice) : null;

  return (
    <main className="mx-auto min-h-dvh max-w-xl bg-paper pb-[max(env(safe-area-inset-bottom),24px)]">
      <header className="sticky top-0 z-[1200] flex items-center gap-2 border-b border-ink/15 bg-paper px-2 pt-[max(env(safe-area-inset-top),8px)] pb-2">
        <BackToMap />
        {item ? (
          <>
            <ItemArt item={item} size={52} />
            <div className="min-w-0 flex-1">
              <h1 className="font-heading text-2xl font-extrabold leading-tight break-words">{item.name}</h1>
              <p className="text-sm leading-tight text-ink-2">{item.size}</p>
            </div>
          </>
        ) : (
          <h1 className="min-w-0 flex-1 font-heading text-2xl font-extrabold leading-tight">
            {api.error ? "Prices" : "Loading prices…"}
          </h1>
        )}
        <SoundToggle className="border! border-ink/20! shadow-none!" />
      </header>

      <div className="mt-3 flex flex-col gap-3 px-4">
        <LocationLine location={location} />
        <WakingUp show={api.slow} />
        {api.error ? (
          <div role="alert" className={`${CARD} flex flex-col gap-3`}>
            <p className="font-bold">{api.error}</p>
            {api.status === 404 || api.status === 400 ? (
              <Link href="/" className={buttonClasses("primary", "md", "self-start")}>
                Pick an item
              </Link>
            ) : (
              <Button variant="primary" className="self-start" onClick={api.retry}>
                Try again
              </Button>
            )}
          </div>
        ) : null}

        {/* Announced when results arrive (section 11). */}
        <section
          aria-live="polite"
          aria-busy={api.loading}
          className={data ? "flex items-center gap-2 rounded-tag border border-ink/15 bg-card py-2 pr-2 pl-3" : "sr-only"}
        >
          {data ? (
            <>
              <div className="min-w-0 flex-1">
                <Summary decision={decision} rows={rows} usingNest={location.usingNest} />
              </div>
              <ReadAloud text={spoken} />
              <p className="sr-only">
                {rows.length === 1 ? "1 outlet" : `${rows.length} outlets`} on campus sell it.
              </p>
            </>
          ) : null}
        </section>
        {data ? <BestDeal rows={rows} /> : null}
        {data ? <WorthTheWalk rows={rows} item={data.item} /> : null}
      </div>

      {data && rows.some((r) => r.price !== null) ? (
        <div
          role="region"
          aria-label={`Map of ${item?.name ?? "item"} prices. The list below has everything the map shows.`}
          className="mt-4 h-[220px] border-y border-ink/15"
        >
          <WhileVisible fallback={<div className="h-full w-full bg-paper-2" aria-hidden="true" />}>
            <ResultsMap
              rows={rows}
              cheapestId={cheapest?.outlet.id ?? null}
              origin={location.origin}
              usingNest={location.usingNest}
              position={location.position}
              accuracy={location.accuracy}
            />
          </WhileVisible>
        </div>
      ) : null}

      {data ? (
        <PricesRefresh.Provider value={api.retry}>
          <Section
            id="near-heading"
            title={nearLabel(location.usingNest)}
            hint={
              rows.some((r) => r.deal)
                ? "About 3 min walk or less, cheapest first. A 2-for deal counts as its price each."
                : "About 3 min walk or less, cheapest first."
            }
            rows={sections.near}
            empty="Nothing within about 3 min walk."
            now={now}
            cheapestId={cheapest?.outlet.id ?? null}
            item={data.item}
            nearWords={nearWords(location.usingNest)}
          />
          <Section
            id="farther-heading"
            title="Farther"
            hint="Dimmed unless it saves $1.00 or more."
            rows={sections.farther}
            empty="Nothing farther away."
            now={now}
            cheapestId={cheapest?.outlet.id ?? null}
            reference={reference}
            item={data.item}
            nearWords={nearWords(location.usingNest)}
          />

          {data.grocery && bestPrice !== null ? (
            <p className="mt-6 px-4">
              <span className="font-bold">vs grocery: </span>
              {decision.kind === "save"
                ? decision.scope === "near"
                  ? `the cheapest ${nearWords(location.usingNest)} is `
                  : "the cheapest on campus is "
                : "the closest is "}
              {groceryText(bestPrice, data.grocery)} ({formatPrice(data.grocery.price)}).
            </p>
          ) : null}
          {statcan ? (
            <p className="mt-3 px-4">
              {statcan.stamp ? <Stamp kind="statcan" className="mr-2 align-middle" /> : null}
              {statcan.text}
            </p>
          ) : null}
          {rows.length === 0 ? (
            <p className="mt-6 px-4">No outlet has a price for this yet.</p>
          ) : null}
          <p className="mt-6 px-4 text-ink-2">
            {data.price_source_used === "pipeline"
              ? "Prices and comparisons from the last Databricks refresh."
              : "Live prices from the campus database."}
          </p>
        </PricesRefresh.Provider>
      ) : null}
    </main>
  );
}

/** 48 px back control: just the arrow, named for screen readers. */
function BackToMap() {
  return (
    <Link
      href="/"
      aria-label="Back to the map"
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-tag text-2xl hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span aria-hidden="true">←</span>
    </Link>
  );
}

/** Shown while the page reads its params (before the client takes over). */
export function ResultsSkeleton() {
  return (
    <main className="mx-auto min-h-dvh max-w-xl bg-paper">
      <header className="flex items-center gap-2 border-b border-ink/15 px-2 pt-[max(env(safe-area-inset-top),8px)] pb-2">
        <BackToMap />
        <h1 className="font-heading text-2xl font-extrabold leading-tight">Loading prices…</h1>
      </header>
    </main>
  );
}
