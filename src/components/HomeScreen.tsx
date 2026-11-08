"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { ITEMS, ITEMS_BY_POPULARITY } from "@/lib/item-list";
import type { Outlet } from "@/lib/outlet";
import { Button } from "./Button";
import { ItemTiles } from "./ItemTiles";

// Leaflet is client only: never server render the map (SPEC rule 9).
const HomeMap = dynamic(() => import("./HomeMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-paper" aria-hidden="true" />,
});

type Props = {
  outlets: Outlet[];
  /** "placeholder" while data/outlets.csv is missing (Step 1 fixture). */
  source: "csv" | "placeholder";
};

type View = "map" | "list";

const SEE_ALL_TILE =
  "flex h-full w-full flex-col items-center justify-center gap-1 rounded-tag border-2 " +
  "border-dashed border-ink bg-paper-2 px-2 py-2 text-center font-heading font-extrabold " +
  "leading-tight shadow-ink active:translate-x-[2px] active:translate-y-[2px] active:shadow-ink-sm";

export default function HomeScreen({ outlets, source }: Props) {
  const [view, setView] = useState<View>("map");
  const allItems = useRef<HTMLDialogElement>(null);
  const sorted = [...outlets].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="fixed inset-0 overflow-hidden bg-paper">
      {/* The map fills the screen. Hidden from keyboard and screen readers in list view. */}
      <div
        className="absolute inset-0"
        role="region"
        aria-label="Map of campus outlets"
        inert={view === "list"}
      >
        <HomeMap outlets={outlets} />
      </div>

      {/* List view: everything the map shows, in text. The screen reader path. */}
      {view === "list" ? (
        <section
          aria-labelledby="outlets-heading"
          className="absolute inset-0 z-[1050] overflow-y-auto bg-paper px-4 pt-[calc(max(env(safe-area-inset-top),12px)+11.5rem)] pb-[calc(max(env(safe-area-inset-bottom),12px)+12rem)]"
        >
          <h2 id="outlets-heading" className="font-heading text-2xl font-extrabold">
            {outlets.length} outlets
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {sorted.map((o) => (
              <li
                key={o.id}
                className="rounded-tag border-2 border-ink bg-card p-3 shadow-ink"
              >
                <p className="font-heading text-lg font-extrabold leading-tight">{o.name}</p>
                {o.area ? <p className="text-ink-2">{o.area}</p> : null}
                <p className="mt-1">
                  {o.isBenchmark
                    ? "Grocery baseline, for comparison only"
                    : "Price tier: ? · no price tier yet"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Floating on top: title and item tiles. */}
      <div
        data-map-overlay="top"
        className="pointer-events-none absolute inset-x-0 top-0 z-[1100] pt-[max(env(safe-area-inset-top),12px)]"
      >
        <header className="px-4">
          <h1 className="pointer-events-auto inline-flex -rotate-1 items-center gap-2 rounded-tag border-2 border-ink bg-tag px-3 py-1.5 font-heading text-xl font-extrabold leading-none shadow-ink">
            Campus Price Map
          </h1>
        </header>
        <nav aria-label="Items" className="pointer-events-auto mt-2">
          <ItemTiles
            layout="row"
            items={ITEMS_BY_POPULARITY}
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
        </nav>
      </div>

      {/* Bottom bar */}
      <div
        data-map-overlay="bottom"
        className="absolute inset-x-0 bottom-0 z-[1100] px-4 pb-[max(env(safe-area-inset-bottom),12px)]"
      >
        {source === "placeholder" ? (
          <p
            role="note"
            className="mb-2 rounded-tag border-2 border-dashed border-ink bg-card px-3 py-1.5 leading-snug"
          >
            <strong>Placeholder outlets.</strong> data/outlets.csv isn&apos;t in the repo
            yet, so these are 5 sample UBC outlets.
          </p>
        ) : null}
        <div
          role="group"
          aria-label="Show outlets as"
          className="grid grid-cols-2 gap-2 rounded-tag border-2 border-ink bg-card p-2 shadow-ink"
        >
          <Button aria-pressed={view === "map"} onClick={() => setView("map")}>
            <span aria-hidden="true">🗺️</span> Map
          </Button>
          <Button aria-pressed={view === "list"} onClick={() => setView("list")}>
            <span aria-hidden="true">☰</span> List
          </Button>
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
            All {ITEMS.length} items
          </h2>
          <Button onClick={() => allItems.current?.close()}>Close</Button>
        </div>
        <ItemTiles layout="grid" items={ITEMS} />
      </dialog>
    </main>
  );
}
