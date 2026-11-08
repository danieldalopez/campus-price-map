"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatPrice } from "@/lib/format";
import {
  getLocationSnapshot,
  NEST_MESSAGE,
  requestLocation,
  resumeLocationIfGranted,
  roundLatLng,
  type LocationState,
} from "@/lib/geo";
import { itemEmoji } from "@/lib/item-art";
import {
  cheapestRow,
  decide,
  decisionText,
  fartherStandsOut,
  groceryText,
  referencePrice,
  splitSections,
  withWalkFrom,
} from "@/lib/pricing";
import type { PriceRow, PricesResponse } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useLocation } from "@/lib/use-location";
import { useNow } from "@/lib/use-now";
import { Button, buttonClasses } from "./Button";
import { OutletRow } from "./OutletRow";
import { PricesRefresh } from "./PendingLine";
import { WakingUp } from "./WakingUp";
import { WhileVisible } from "./WhileVisible";

// Leaflet is client only: never server render the map (SPEC rule 9).
const ResultsMap = dynamic(() => import("./ResultsMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-paper-2" aria-hidden="true" />,
});

const CARD = "rounded-tag border-2 border-ink bg-card p-3 shadow-ink";

/** Where walk times are measured from, in one line (SPEC section 7, "Location"). */
function LocationLine({ location }: { location: LocationState }) {
  if (location.status === "on") {
    return <p className="text-ink-2">Walk times are from where you are.</p>;
  }
  if (location.status === "asking") {
    return <p className="text-ink-2">Finding where you are… walk times are from the AMS Nest until then.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="min-w-0 flex-1 basis-56">{NEST_MESSAGE}</p>
      {location.status === "off" ? <Button onClick={requestLocation}>Use my location</Button> : null}
    </div>
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
};

function Section({ id, title, hint, rows, empty, now, cheapestId, reference }: SectionProps) {
  const farther = reference !== undefined;
  return (
    <section aria-labelledby={id} className="mt-6 px-4">
      <h2 id={id} className="font-heading text-2xl font-extrabold leading-tight">
        {title}
      </h2>
      <p className="text-ink-2">{hint}</p>
      {rows.length === 0 ? (
        <p className="mt-2">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
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
              />
            );
          })}
        </ul>
      )}
    </section>
  );
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
  const data = api.data;

  const rows = useMemo(() => (data ? withWalkFrom(data.rows, location.origin) : []), [data, location.origin]);
  const sections = useMemo(() => splitSections(rows), [rows]);
  const decision = useMemo(() => decide(rows), [rows]);
  const cheapest = useMemo(() => cheapestRow(rows), [rows]);
  const reference = referencePrice(decision);
  const bestPrice = decision.kind === "save" ? decision.at.price : decision.kind === "none" ? null : decision.closest.price;
  const item = data?.item ?? null;

  return (
    <main className="mx-auto min-h-dvh max-w-xl bg-paper pb-[max(env(safe-area-inset-bottom),24px)]">
      <header className="sticky top-0 z-[1200] flex items-center gap-3 border-b-2 border-ink bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3">
        <Link href="/" className={buttonClasses("secondary", "md", "shrink-0 px-3")} aria-label="Back to the map">
          <span aria-hidden="true">←</span> Map
        </Link>
        {item ? (
          <>
            <span aria-hidden="true" className="text-4xl leading-none">
              {itemEmoji(item)}
            </span>
            <div className="min-w-0">
              <h1 className="font-heading text-2xl font-extrabold leading-tight">{item.name}</h1>
              <p className="leading-tight text-ink-2">{item.size}</p>
            </div>
          </>
        ) : (
          <h1 className="font-heading text-2xl font-extrabold leading-tight">
            {api.error ? "Prices" : "Loading prices…"}
          </h1>
        )}
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
        <section aria-live="polite" aria-busy={api.loading} className={data ? CARD : "sr-only"}>
          {data ? (
            <>
              <p className="font-heading text-xl font-extrabold leading-snug">{decisionText(decision)}</p>
              <p className="sr-only">
                {rows.length === 1 ? "1 outlet" : `${rows.length} outlets`} on campus sell it.
              </p>
            </>
          ) : null}
        </section>
      </div>

      {data && rows.some((r) => r.price !== null) ? (
        <div
          role="region"
          aria-label={`Map of ${item?.name ?? "item"} prices. The list below has everything the map shows.`}
          className="mt-4 h-60 border-y-2 border-ink"
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
            title="Near you"
            hint="About 3 min walk or less, cheapest first."
            rows={sections.near}
            empty="Nothing within about 3 min walk."
            now={now}
            cheapestId={cheapest?.outlet.id ?? null}
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
          />

          {data.grocery && bestPrice !== null ? (
            <p className="mt-6 px-4">
              <span className="font-bold">vs grocery: </span>
              {decision.kind === "save"
                ? decision.scope === "near"
                  ? "the cheapest near you is "
                  : "the cheapest on campus is "
                : "the closest is "}
              {groceryText(bestPrice, data.grocery)} ({formatPrice(data.grocery.price)}).
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

/** Shown while the page reads its params (before the client takes over). */
export function ResultsSkeleton() {
  return (
    <main className="mx-auto min-h-dvh max-w-xl bg-paper">
      <header className="flex items-center gap-3 border-b-2 border-ink px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3">
        <Link href="/" className={buttonClasses("secondary", "md", "shrink-0 px-3")} aria-label="Back to the map">
          <span aria-hidden="true">←</span> Map
        </Link>
        <h1 className="font-heading text-2xl font-extrabold leading-tight">Loading prices…</h1>
      </header>
    </main>
  );
}
