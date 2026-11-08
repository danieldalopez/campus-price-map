"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { requestLocation, resumeLocationIfGranted, walkLabel, walkMinutes, type LocationState } from "@/lib/geo";
import { byPopularity } from "@/lib/item-art";
import { isApproximate, tierLabel, tierWords } from "@/lib/outlet";
import { searchItems } from "@/lib/search";
import type { ItemsResponse, LocationsResponse, Outlet } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useLocation } from "@/lib/use-location";
import { Button, buttonClasses } from "./Button";
import { ItemTiles } from "./ItemTiles";
import { OutletLink } from "./OutletLink";
import { SearchResults, searchSummary } from "./SearchResults";
import { SoundToggle } from "./SoundToggle";
import { WakingUp } from "./WakingUp";
import { WhileVisible } from "./WhileVisible";

// Leaflet is client only: never server render the map (SPEC rule 9).
const HomeMap = dynamic(() => import("./HomeMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-paper" aria-hidden="true" />,
});

type View = "map" | "list";

const SEE_ALL_TILE =
  "flex h-full w-full flex-col items-center justify-center gap-1 rounded-tag border border-dashed " +
  "border-ink-2 bg-paper-2 px-2 py-2 text-center font-heading text-[0.9375rem] font-bold leading-tight " +
  "active:bg-card";

// One half of the Map / List switch: each half is a full-height (48 px) target; the selected half is ink.
const SEGMENT =
  "flex h-full flex-1 items-center justify-center rounded-full font-heading text-base font-bold " +
  "text-ink aria-pressed:bg-ink aria-pressed:text-card";

const NOTE = "rounded-tag border border-ink-2 bg-card px-3 py-2 leading-snug";

/** Home: the map is the app (SPEC section 7). Items and outlets come from /api/items and /api/locations. */
export default function HomeScreen() {
  const router = useRouter();
  const [view, setView] = useState<View>("map");
  const [query, setQuery] = useState("");
  const allItems = useRef<HTMLDialogElement>(null);
  const location = useLocation();

  const itemsApi = useApi<ItemsResponse>("/api/items");
  const outletsApi = useApi<LocationsResponse>("/api/locations");
  const items = useMemo(() => byPopularity(itemsApi.data?.items ?? []), [itemsApi.data]);
  const outlets = useMemo(() => outletsApi.data?.locations ?? [], [outletsApi.data]);

  // Location is asked for on the first search or tile tap, never here. If it was already allowed on an
  // earlier visit, the dot comes back without a prompt.
  useEffect(() => resumeLocationIfGranted(), []);

  // "/?q=ramen" opens Home already searching (a tapped line on an outlet's full menu links here). Read after
  // mount: the page is a static shell, so the URL isn't known while rendering it.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from the URL on mount
    if (q) setQuery(q);
  }, []);

  const result = useMemo(() => searchItems(query, items), [query, items]);
  const searching = result.kind !== "empty";

  // Tapping a tile or a search result is the first search: ask for location then.
  const pick = () => requestLocation();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const first = result.kind === "match" || result.kind === "typo" ? result.items[0] : undefined;
    if (!first) return;
    requestLocation();
    router.push(`/item/${first.id}`);
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-paper">
      {/* The map fills the screen. Hidden from keyboard and screen readers in list view. */}
      <div className="absolute inset-0" role="region" aria-label="Map of campus outlets" inert={view === "list"}>
        <WhileVisible fallback={<div className="h-full w-full bg-paper" aria-hidden="true" />}>
          <HomeMap outlets={outlets} />
        </WhileVisible>
      </div>

      <div className="pointer-events-none absolute inset-0 z-[1100] flex flex-col">
        {/* Floating on top: title, search and item tiles. */}
        <div
          data-map-overlay="top"
          className="pointer-events-auto border-b border-ink/15 bg-paper pt-[env(safe-area-inset-top)]"
        >
          <header className="flex h-14 items-center justify-between gap-2 pr-1 pl-4">
            <h1 className="font-heading text-[1.375rem] font-extrabold leading-none">
              <span className="bg-[linear-gradient(transparent_55%,var(--tag)_55%)] px-0.5">Campus Price Map</span>
            </h1>
            <SoundToggle />
          </header>

          <form role="search" onSubmit={submit} className="mx-4 flex gap-2">
            <label htmlFor="item-search" className="sr-only">
              Search products
            </label>
            <div className="relative min-w-0 flex-1">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-ink-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="6.5" />
                <path d="M16 16l4.5 4.5" />
              </svg>
              <input
                id="item-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                aria-describedby="search-status"
                className="h-[3.125rem] w-full rounded-tag border border-ink-2 bg-card pr-3 pl-10 text-base placeholder:text-ink-2 [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                className="flex h-[3.125rem] w-12 shrink-0 items-center justify-center rounded-tag border border-ink-2 bg-card text-2xl"
                onClick={() => setQuery("")}
              >
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
          </form>
          <p id="search-status" role="status" aria-live="polite" className="sr-only">
            {searchSummary(result)}
          </p>

          <div className="pt-2">
            {itemsApi.error ? (
              <div role="alert" className={`${NOTE} mx-4 flex items-center justify-between gap-3`}>
                <span>{itemsApi.error}</span>
                <Button onClick={itemsApi.retry}>Try again</Button>
              </div>
            ) : searching ? (
              <SearchResults result={result} query={query} items={items} onPick={pick} />
            ) : (
              <nav aria-label="Items">
                {items.length > 0 ? (
                  <ItemTiles
                    layout="row"
                    items={items}
                    onSelect={pick}
                    trailing={
                      <button
                        type="button"
                        className={SEE_ALL_TILE}
                        aria-haspopup="dialog"
                        onClick={() => allItems.current?.showModal()}
                      >
                        <span aria-hidden="true" className="text-2xl leading-none">
                          ▦
                        </span>
                        See all items
                      </button>
                    }
                  />
                ) : (
                  <p className="sr-only">Loading items…</p>
                )}
              </nav>
            )}
            <WakingUp show={itemsApi.slow || outletsApi.slow} className="mx-4 mb-2" />
          </div>
        </div>

        {/* List view: everything the map shows, in text. The screen reader path. */}
        <div className="min-h-0 flex-1">
          {view === "list" ? (
            <OutletList outlets={outlets} loading={outletsApi.loading} location={location} />
          ) : null}
        </div>

        {/* Bottom bar */}
        <div data-map-overlay="bottom" className="pointer-events-auto px-4 pb-[max(env(safe-area-inset-bottom),12px)]">
          {outletsApi.error ? (
            <div role="alert" className={`${NOTE} mb-2 flex items-center justify-between gap-3`}>
              <span>{outletsApi.error}</span>
              <Button onClick={outletsApi.retry}>Try again</Button>
            </div>
          ) : null}
          <div
            role="group"
            aria-label="Show outlets as"
            className="mx-auto flex h-[3.125rem] w-[11.5rem] rounded-full border border-ink-2 bg-card"
          >
            <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")} className={SEGMENT}>
              Map
            </button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={SEGMENT}>
              List
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <Link
              href="/scan"
              className={buttonClasses("secondary", "md", "min-h-[3.25rem]! shrink-0 border! border-ink-2! px-4 shadow-none!")}
            >
              <span aria-hidden="true">▥</span> Scan
            </Link>
            <Link href="/snap" className={buttonClasses("primary", "md", "min-h-[3.25rem]! min-w-0 flex-1 text-lg!")}>
              <span aria-hidden="true">📷</span> Snap a price
            </Link>
          </div>
        </div>
      </div>

      {/* See all items: native modal dialog (focus trap and Escape for free). */}
      <dialog
        ref={allItems}
        aria-labelledby="all-items-heading"
        className="m-auto max-h-[90dvh] w-[min(100%-2rem,28rem)] overflow-y-auto rounded-tag border-2 border-ink bg-paper p-4 text-ink shadow-ink backdrop:bg-ink/50"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="all-items-heading" className="font-heading text-2xl font-extrabold">
            All {items.length} items
          </h2>
          <Button onClick={() => allItems.current?.close()}>Close</Button>
        </div>
        <ItemTiles layout="grid" items={items} onSelect={pick} />
      </dialog>
    </main>
  );
}

/** Every outlet the map shows, in text: name, area, tier in words, walk time once location is on. */
function OutletList({ outlets, loading, location }: { outlets: Outlet[]; loading: boolean; location: LocationState }) {
  const known = location.status === "on";
  const rows = outlets
    .map((o) => ({ o, walk: walkMinutes(location.origin, o) }))
    .sort((a, b) => (known ? a.walk - b.walk : 0) || a.o.name.localeCompare(b.o.name));
  return (
    <section
      aria-labelledby="outlets-heading"
      className="pointer-events-auto h-full overflow-y-auto bg-paper px-4 pt-2 pb-4"
    >
      <h2 id="outlets-heading" className="font-heading text-2xl font-extrabold">
        {loading ? "Loading outlets…" : `${outlets.length} outlets`}
      </h2>
      <p className="text-ink-2">{known ? "Closest first, from where you are." : "In alphabetical order."}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map(({ o, walk }) => (
          <li key={o.id} className="rounded-tag border border-ink/20 bg-card p-3">
            <p className="font-heading text-lg font-extrabold leading-tight">
              <OutletLink id={o.id}>{o.name}</OutletLink>
            </p>
            {o.area ? <p className="text-ink-2">{o.area}</p> : null}
            <p className="mt-1">
              {o.is_benchmark ? null : <span className="font-mono font-bold">{tierLabel(o)} · </span>}
              {tierWords(o)}
            </p>
            {known || isApproximate(o.location_precision) ? (
              <p className="text-ink-2">
                {[known ? walkLabel(walk) : null, isApproximate(o.location_precision) ? "approximate location" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
