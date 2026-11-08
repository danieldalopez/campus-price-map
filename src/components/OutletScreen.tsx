"use client";

import Link from "next/link";
import { useContext, useMemo } from "react";
import { formatPrice } from "@/lib/format";
import { todayHoursText } from "@/lib/hours";
import { ItemArt } from "@/components/ItemArt";
import { isApproximate } from "@/lib/outlet";
import { freshness } from "@/lib/pricing";
import type { MenuCategory, MenuLine, Outlet, OutletItemRow, OutletResponse } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { DEFAULT_CONFIG, DEFAULT_PER_WEEK, project, type WalkConfig } from "@/lib/walkworth";
import { useNow } from "@/lib/use-now";
import { Button, buttonClasses } from "./Button";
import { DirectionsButton } from "./DirectionsButton";
import { OutletLink } from "./OutletLink";
import { PendingLine, PricesRefresh } from "./PendingLine";
import { PriceBand } from "./PriceBand";
import { PriceTag } from "./PriceTag";
import { Stamp } from "./Stamp";
import { StockLine } from "./StockLine";
import { WakingUp } from "./WakingUp";
import { WalkConfigContext } from "./WorthTheWalk";

const CARD = "rounded-tag border-2 border-ink bg-card p-3 shadow-ink";

/** "Hot drinks" -> "hot-drinks-0": ids that tie each list to its heading. */
function slug(text: string, i: number): string {
  return `${text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section"}-${i}`;
}

/** Tracked items in their categories, in the order the items come (by id). */
function byCategory(rows: OutletItemRow[]): { category: string; rows: OutletItemRow[] }[] {
  const groups = new Map<string, OutletItemRow[]>();
  for (const row of rows) {
    const list = groups.get(row.item.category);
    if (list) list.push(row);
    else groups.set(row.item.category, [row]);
  }
  return [...groups].map(([category, list]) => ({ category, rows: list }));
}

function menuFreshness(line: MenuLine, now: number) {
  return freshness({ source: line.source, confirmations: 0, updated_at: line.reported_on }, now);
}

// ---------------------------------------------------------------------------------------------------------
// Header card: area, today's hours, address
// ---------------------------------------------------------------------------------------------------------

function OutletFacts({ outlet, now }: { outlet: Outlet; now: number }) {
  const today = todayHoursText(outlet.hours, new Date(now));
  const where = [outlet.area, isApproximate(outlet.location_precision) ? "approximate location" : null].filter(Boolean);
  return (
    <>
      {where.length > 0 ? <p className="font-bold">{where.join(" · ")}</p> : null}
      {outlet.address ? <p className="text-ink-2">{outlet.address}</p> : null}
      <p className="mt-1">
        {today ?? (outlet.hours ? `Hours: ${outlet.hours}` : "Hours not listed")}
      </p>
      {today && outlet.hours ? (
        <details className="mt-1">
          <summary className="inline-flex min-h-12 cursor-pointer items-center font-bold underline decoration-2 underline-offset-4">
            All hours
          </summary>
          <p className="text-ink-2">{outlet.hours}</p>
        </details>
      ) : null}
      {outlet.is_benchmark ? (
        <p className="mt-1">Grocery baseline: used for the &ldquo;vs grocery&rdquo; line, never ranked.</p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Tracked items: compared across campus
// ---------------------------------------------------------------------------------------------------------

/**
 * Databricks' Worth the walk suggestion for standing here (section 7), money first: "Walk 8 extra minutes to
 * Tim Hortons and save $1.00 each time: $65.00 a term if you buy it 5 times a week". No maths beyond the total.
 */
function WalkLine({ walk }: { walk: NonNullable<OutletItemRow["walk"]> }) {
  const config = useContext(WalkConfigContext);
  const minutes = Math.round(walk.extra_min);
  const term = project(walk, DEFAULT_PER_WEEK, config.weeks_term);
  if (Math.round(walk.saving * 100) < Math.round(config.even_band * 100)) return null;
  return (
    <p className="mt-1">
      <span className="font-bold">Worth the walk:</span> {minutes === 0 ? "no extra walking" : `${minutes} extra ${minutes === 1 ? "minute" : "minutes"}`}{" "}
      to{" "}
      <OutletLink id={walk.location_id} className="font-bold">
        {walk.name ?? "a cheaper outlet"}
      </OutletLink>{" "}
      saves {formatPrice(walk.saving)} each time ·{" "}
      <span className="font-bold text-cheap">{formatPrice(term.saved)} a term</span> if you buy it{" "}
      {DEFAULT_PER_WEEK} times a week
    </p>
  );
}

function TrackedItem({ row, outletId, now }: { row: OutletItemRow; outletId: string; now: number }) {
  const fresh = freshness(row, now);
  const soldOut = row.stock === "sold_out";
  const nearest = row.nearest_cheaper;
  const saving = nearest && row.price !== null ? Math.round((row.price - nearest.price) * 100) / 100 : null;

  return (
    <li className={`rounded-tag border-2 border-ink p-3 ${fresh?.stale ? "border-dashed bg-paper-2" : "bg-card shadow-ink"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <ItemArt item={row.item} size={40} />
          <div className="min-w-0">
            <h4 className="font-heading text-lg font-extrabold leading-tight">
              <Link
                href={`/item/${row.item.id}`}
                prefetch={false}
                className="relative underline decoration-2 underline-offset-4 before:absolute before:-inset-x-1 before:-inset-y-3.5 before:content-['']"
              >
                {row.item.name}
                <span className="sr-only">, compare across campus</span>
              </Link>
            </h4>
            <p className="leading-tight text-ink-2">{row.item.size}</p>
          </div>
        </div>
        {soldOut ? <Stamp kind="sold-out" className="shrink-0" /> : null}
      </div>

      {row.price !== null ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <PriceTag price={row.price} tiltId={`${outletId}:${row.item.id}`} size="lg" />
          <PriceBand band={row.band} pctVsMedian={row.pct_vs_median} />
          {row.chip ? <span className="chip">{row.chip}</span> : null}
        </div>
      ) : row.just_confirmed ? null : (
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

      {/* Pipeline only: the closest outlet that sells it for less, from serving.price_comparisons. */}
      {nearest && saving !== null && saving > 0 ? (
        <p className="mt-2">
          <span className="font-mono font-bold">{formatPrice(saving)}</span> less at{" "}
          <OutletLink id={nearest.location_id} className="font-bold">
            {nearest.name ?? "another outlet"}
          </OutletLink>
          {nearest.walk_min !== null ? `, about ${nearest.walk_min} min from here` : ""}
        </p>
      ) : null}

      {/* Pipeline only: Databricks' Worth the walk suggestion for standing here (section 7). */}
      {row.walk ? <WalkLine walk={row.walk} /> : null}

      {row.just_confirmed ? (
        <p className="mt-1">
          <span className="font-bold">Just confirmed: </span>
          <span className="font-mono font-bold">{formatPrice(row.just_confirmed.price)}</span> · comparisons update
          on the next refresh
        </p>
      ) : null}

      <PendingLine pending={row.pending} what={row.item.name} />

      <StockLine itemId={row.item.id} locationId={outletId} stock={row.stock} what={row.item.name} />
    </li>
  );
}

function TrackedSection({ rows, outletId, now }: { rows: OutletItemRow[]; outletId: string; now: number }) {
  const groups = useMemo(() => byCategory(rows), [rows]);
  return (
    <section aria-labelledby="tracked-heading" className="mt-6 px-4">
      <h2 id="tracked-heading" className="font-heading text-2xl font-extrabold leading-tight">
        Prices we compare
      </h2>
      <p className="text-ink-2">The same item at every outlet. Tap one to see where it&apos;s cheapest.</p>
      {rows.length === 0 ? (
        <p className="mt-2">None of the items we compare has a price here yet.</p>
      ) : (
        groups.map((g, i) => {
          const id = slug(`tracked-${g.category}`, i);
          return (
            <div key={g.category} className="mt-4">
              <h3 id={id} className="font-heading text-lg font-extrabold leading-tight">
                {g.category}
              </h3>
              <ul aria-labelledby={id} className="mt-2 flex flex-col gap-3">
                {g.rows.map((row) => (
                  <TrackedItem key={row.item.id} row={row} outletId={outletId} now={now} />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Full menu: every line as listed, not compared
// ---------------------------------------------------------------------------------------------------------

function MenuSection({ category, index, now }: { category: MenuCategory; index: number; now: number }) {
  const id = slug(`menu-${category.category}`, index);
  const texts = category.lines.map((l) => menuFreshness(l, now)?.text ?? null);
  // One freshness line under the heading when every line shares it ("Menu price · Nov 7").
  const shared = texts.every((t) => t === texts[0]) ? texts[0] : null;
  return (
    <div className="mt-4">
      <h3 id={id} className="font-heading text-lg font-extrabold leading-tight">
        {category.category}
      </h3>
      {shared ? <p className="text-ink-2">{shared}</p> : null}
      <ul aria-labelledby={id} className="mt-2 divide-y-2 divide-paper-2 rounded-tag border-2 border-ink bg-card">
        {category.lines.map((line, i) => (
          <li key={line.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
            <span className="min-w-0 leading-snug">
              {line.item}
              {line.variant ? <span className="text-ink-2"> · {line.variant}</span> : null}
              {!shared && texts[i] ? <span className="block text-ink-2">{texts[i]}</span> : null}
            </span>
            <span className="shrink-0 font-mono font-bold tabular-nums">{formatPrice(line.price)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FullMenu({ menu, now }: { menu: MenuCategory[]; now: number }) {
  const count = menu.reduce((n, c) => n + c.lines.length, 0);
  return (
    <section aria-labelledby="menu-heading" className="mt-8 px-4">
      <h2 id="menu-heading" className="scroll-mt-24 font-heading text-2xl font-extrabold leading-tight">
        Full menu
      </h2>
      {count === 0 ? (
        <p className="mt-1">We don&apos;t have this outlet&apos;s menu yet.</p>
      ) : (
        <p className="text-ink-2">
          {count === 1 ? "1 item" : `${count} items`} as listed. These aren&apos;t compared: sizes and recipes
          differ from place to place.
        </p>
      )}
      {menu.map((c, i) => (
        <MenuSection key={c.category} category={c} index={i} now={now} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------------------

function BackToMap() {
  return (
    <Link href="/" className={buttonClasses("secondary", "md", "shrink-0 px-3")} aria-label="Back to the map">
      <span aria-hidden="true">←</span> Map
    </Link>
  );
}

/** One outlet: today's hours, the tracked items compared across campus, then its full menu. SPEC section 7. */
export default function OutletScreen({ outletId }: { outletId: string }) {
  const now = useNow(60_000);
  const api = useApi<OutletResponse>(`/api/outlet/${encodeURIComponent(outletId)}`);
  const configApi = useApi<WalkConfig>("/api/config");
  const data = api.data;
  const menuCount = data ? data.menu.reduce((n, c) => n + c.lines.length, 0) : 0;

  return (
    <main className="mx-auto min-h-dvh max-w-xl bg-paper pb-[max(env(safe-area-inset-bottom),24px)]">
      <header className="sticky top-0 z-[1200] flex items-center gap-3 border-b-2 border-ink bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3">
        <BackToMap />
        <h1 className="min-w-0 font-heading text-2xl font-extrabold leading-tight">
          {data ? data.outlet.name : api.error ? "Outlet" : "Loading outlet…"}
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

        {/* Announced when the outlet arrives (section 11). */}
        <section aria-live="polite" aria-busy={api.loading} className={data ? CARD : "sr-only"}>
          {data ? (
            <>
              <OutletFacts outlet={data.outlet} now={now} />
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
                <DirectionsButton outlet={data.outlet} />
                {menuCount > 0 ? (
                  <a
                    href="#menu-heading"
                    className="inline-flex min-h-12 items-center font-bold underline decoration-2 underline-offset-4"
                  >
                    Full menu · {menuCount === 1 ? "1 item" : `${menuCount} items`}
                    <span aria-hidden="true">&nbsp;↓</span>
                  </a>
                ) : null}
              </div>
              <p className="sr-only">
                {data.items.length === 1 ? "1 price we compare" : `${data.items.length} prices we compare`} and{" "}
                {menuCount === 1 ? "1 menu item" : `${menuCount} menu items`}.
              </p>
            </>
          ) : null}
        </section>
      </div>

      {data ? (
        <>
          <PricesRefresh.Provider value={api.retry}>
            <WalkConfigContext.Provider value={configApi.data ?? DEFAULT_CONFIG}>
            <TrackedSection rows={data.items} outletId={data.outlet.id} now={now} />
            </WalkConfigContext.Provider>
          </PricesRefresh.Provider>
          <FullMenu menu={data.menu} now={now} />
          <p className="mt-8 px-4 text-ink-2">
            {data.price_source_used === "pipeline"
              ? "Compared prices from the last Databricks refresh."
              : "Live prices from the campus database."}
          </p>
        </>
      ) : null}
    </main>
  );
}

/** Shown while the page reads its params (before the client takes over). */
export function OutletSkeleton() {
  return (
    <main className="mx-auto min-h-dvh max-w-xl bg-paper">
      <header className="flex items-center gap-3 border-b-2 border-ink px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3">
        <BackToMap />
        <h1 className="font-heading text-2xl font-extrabold leading-tight">Loading outlet…</h1>
      </header>
    </main>
  );
}
