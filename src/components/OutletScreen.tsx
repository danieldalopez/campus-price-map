"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatPrice } from "@/lib/format";
import { walkLabel } from "@/lib/geo";
import { itemEmoji } from "@/lib/item-art";
import { isApproximate, tierLabel, tierWords } from "@/lib/outlet";
import { freshness } from "@/lib/pricing";
import type { OutletItemRow, OutletResponse } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Button, buttonClasses } from "./Button";
import { DirectionsButton } from "./DirectionsButton";
import { PriceBand } from "./PriceBand";
import { PriceTag } from "./PriceTag";
import { Stamp } from "./Stamp";
import { WakingUp } from "./WakingUp";

/** Re-render freshness ("20 min ago") once a minute. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const CARD = "rounded-tag border-2 border-ink bg-card p-3 shadow-ink";

/** Items grouped by category, in the order categories first appear (items come in id order). */
function byCategory(items: OutletItemRow[]): [string, OutletItemRow[]][] {
  const groups = new Map<string, OutletItemRow[]>();
  for (const row of items) {
    const list = groups.get(row.item.category);
    if (list) list.push(row);
    else groups.set(row.item.category, [row]);
  }
  return [...groups];
}

/** "$0.35 less at Mercante, about 3 min from here". */
function NearestCheaper({ row }: { row: OutletItemRow }) {
  const nc = row.nearest_cheaper;
  if (!nc || row.price === null) return null;
  const saving = Math.round((row.price - nc.price) * 100) / 100;
  if (saving <= 0) return null;
  return (
    <p className="mt-1">
      <Link href={`/outlet/${encodeURIComponent(nc.location_id)}`} className="font-bold text-ink underline">
        {formatPrice(saving)} less at {nc.name ?? "another outlet"}
      </Link>
      {nc.walk_min !== null ? <span className="text-ink-2">, {walkLabel(nc.walk_min)} from here</span> : null}
    </p>
  );
}

/** One item at this outlet. The official price is the only price shown big (SPEC section 7). */
function ItemCard({ row, now }: { row: OutletItemRow; now: number }) {
  const fresh = freshness(row, now);
  const soldOut = row.stock === "sold_out";
  const card = fresh?.stale ? "border-dashed bg-paper-2" : "bg-card shadow-ink";
  return (
    <li className={`rounded-tag border-2 border-ink p-3 ${card}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-3xl leading-none">
            {itemEmoji(row.item)}
          </span>
          <div className="min-w-0">
            <h3 className="font-heading text-lg font-extrabold leading-tight">
              <Link href={`/item/${row.item.id}`} className="underline decoration-2 underline-offset-2">
                {row.item.name}
              </Link>
            </h3>
            <p className="leading-tight text-ink-2">{row.item.size}</p>
          </div>
        </div>
        {soldOut ? <Stamp kind="sold-out" className="shrink-0" /> : null}
      </div>

      {row.price !== null ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <PriceTag price={row.price} tiltId={row.item.id} size="lg" />
          <PriceBand band={row.band} pctVsMedian={row.pct_vs_median} />
          {row.chip ? <span className="chip">{row.chip}</span> : null}
        </div>
      ) : (
        <p className="mt-2">
          <span className="font-bold">No confirmed price yet</span>
          {row.estimate ? (
            <span className="text-ink-2">
              {" "}
              · estimated {formatPrice(row.estimate.low)} to {formatPrice(row.estimate.high)} · Snap it to confirm
            </span>
          ) : null}
        </p>
      )}

      {fresh ? <p className="mt-1 text-ink-2">{fresh.text}</p> : null}
      <NearestCheaper row={row} />
      {row.just_confirmed ? (
        <p className="mt-1">
          <span className="font-bold">Just confirmed: </span>
          <span className="font-mono font-bold">{formatPrice(row.just_confirmed.price)}</span> · comparisons update
          on the next refresh
        </p>
      ) : null}
      {row.pending ? (
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <Stamp kind="pending" />
          <span>
            {row.pending.mine ? "Your report" : "New report"}:{" "}
            <span className="font-mono font-bold">{formatPrice(row.pending.price)}</span> · waiting for a second
            student
          </span>
        </p>
      ) : null}
      {row.stock === "maybe_sold_out" ? <p className="mt-1">A student said it may be sold out.</p> : null}
    </li>
  );
}

function BackLink() {
  return (
    <Link href="/" className={buttonClasses("secondary", "md", "shrink-0 px-3")} aria-label="Back to the map">
      <span aria-hidden="true">←</span> Map
    </Link>
  );
}

/** One outlet: hours, Directions, and every tracked item it sells, grouped by category. SPEC section 7. */
export default function OutletScreen({ outletId }: { outletId: string }) {
  const now = useNow(60_000);
  const api = useApi<OutletResponse>(`/api/outlet/${encodeURIComponent(outletId)}`);
  const data = api.data;
  const outlet = data?.outlet ?? null;
  const groups = useMemo(() => (data ? byCategory(data.items) : []), [data]);
  const priced = data ? data.items.filter((r) => r.price !== null).length : 0;

  return (
    <main className="mx-auto min-h-dvh max-w-xl bg-paper pb-[max(env(safe-area-inset-bottom),24px)]">
      <header className="sticky top-0 z-[1200] flex items-center gap-3 border-b-2 border-ink bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3">
        <BackLink />
        <h1 className="min-w-0 font-heading text-2xl font-extrabold leading-tight">
          {outlet ? outlet.name : api.error ? "Outlet" : "Loading outlet…"}
        </h1>
      </header>

      <div className="mt-3 flex flex-col gap-3 px-4">
        <WakingUp show={api.slow} />
        {api.error ? (
          <div role="alert" className={`${CARD} flex flex-col gap-3`}>
            <p className="font-bold">{api.error}</p>
            {api.status === 404 || api.status === 400 ? (
              <Link href="/" className={buttonClasses("primary", "md", "self-start")}>
                Back to the map
              </Link>
            ) : (
              <Button variant="primary" className="self-start" onClick={api.retry}>
                Try again
              </Button>
            )}
          </div>
        ) : null}

        {outlet ? (
          <section aria-label="About this outlet" className={`${CARD} flex flex-col gap-1`}>
            {outlet.area ? <p className="font-bold">{outlet.area}</p> : null}
            {outlet.address || isApproximate(outlet.location_precision) ? (
              <p className="text-ink-2">
                {[outlet.address, isApproximate(outlet.location_precision) ? "approximate location" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            <p>
              <span className="font-bold">Hours: </span>
              {outlet.hours ?? "not listed"}
            </p>
            {outlet.is_benchmark ? (
              <p>Grocery baseline, for comparison only.</p>
            ) : outlet.tier ? (
              <p>
                <span className="font-mono font-bold">{tierLabel(outlet)} · </span>
                {tierWords(outlet)}
              </p>
            ) : null}
            <DirectionsButton outlet={outlet} className="mt-2 self-start" />
          </section>
        ) : null}
      </div>

      {/* Announced when the items arrive (section 11). */}
      <div aria-live="polite" aria-busy={api.loading}>
        {data ? (
          <>
            <p className="mt-6 px-4">
              {data.items.length === 0
                ? "We don't have any tracked items for this outlet yet."
                : `${data.items.length} tracked ${data.items.length === 1 ? "item" : "items"}, ${priced} with a confirmed price. Each comparison is for that item only.`}
            </p>
            {groups.map(([category, rows], i) => (
              <section key={category} aria-labelledby={`cat-${i}`} className="mt-6 px-4">
                <h2 id={`cat-${i}`} className="font-heading text-2xl font-extrabold leading-tight">
                  {category}
                </h2>
                <ul className="mt-3 flex flex-col gap-3">
                  {rows.map((row) => (
                    <ItemCard key={row.item.id} row={row} now={now} />
                  ))}
                </ul>
              </section>
            ))}
            <p className="mt-6 px-4 text-ink-2">
              {data.price_source_used === "pipeline"
                ? "Prices and comparisons from the last Databricks refresh."
                : "Live prices from the campus database."}
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}

/** Shown while the page reads its params (before the client takes over). */
export function OutletSkeleton() {
  return (
    <main className="mx-auto min-h-dvh max-w-xl bg-paper">
      <header className="flex items-center gap-3 border-b-2 border-ink px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3">
        <BackLink />
        <h1 className="font-heading text-2xl font-extrabold leading-tight">Loading outlet…</h1>
      </header>
    </main>
  );
}
