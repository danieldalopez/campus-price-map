import Link from "next/link";
import { formatPrice } from "@/lib/format";
import { walkLabel } from "@/lib/geo";
import { ItemArt } from "@/components/ItemArt";
import type { SearchResult } from "@/lib/search";
import type { Item, MenuHit, MenuSearchResponse } from "@/lib/types";
import { useMenuSearch, type MenuSearchState } from "@/lib/use-menu-search";
import { ItemTiles } from "./ItemTiles";
import { outletHref } from "./OutletLink";

type Props = {
  result: SearchResult<Item>;
  /** What was typed: also searched on every menu ("On menus"). */
  query: string;
  /** Every item, for the tiles shown when nothing matches. */
  items: Item[];
  onPick: (item: Item) => void;
};

const ROW =
  "flex min-h-12 items-center gap-3 rounded-tag border-2 border-ink bg-card px-3 py-2 shadow-ink " +
  "active:translate-x-[2px] active:translate-y-[2px] active:shadow-ink-sm";

const NOTE = "inline-block rounded-tag border-2 border-ink bg-card px-3 py-1.5 font-bold shadow-ink";

/** One line for the aria-live status (section 11: results are announced). */
export function searchSummary(result: SearchResult<Item>): string {
  switch (result.kind) {
    case "empty":
      return "";
    case "match":
      return result.items.length === 1 ? "1 item found" : `${result.items.length} items found`;
    case "typo":
      return `Did you mean ${result.didYouMean.name}?`;
    case "none":
      return "We don't track that yet";
  }
}

/** The menu half of the announcement, once the answer for what was typed is in. */
function menuSummary(menu: MenuSearchState): string {
  if (!menu.active || menu.waiting) return "";
  if (menu.error) return "Couldn't search the menus.";
  const data = menu.data;
  if (!data || data.shown === 0) return "Not on any menu either.";
  const lines = data.shown === 1 ? "1 line" : `${data.shown} lines`;
  return data.kind === "typo" && data.did_you_mean ? `On menus, did you mean ${data.did_you_mean}? ${lines}.` : `On menus: ${lines}.`;
}

function ResultLink({ item, onPick, lead }: { item: Item; onPick: (item: Item) => void; lead?: string }) {
  return (
    <Link href={`/item/${item.id}`} prefetch={false} className={ROW} onClick={() => onPick(item)}>
      <ItemArt item={item} size={40} />
      <span className="min-w-0">
        {lead ? <span className="block font-heading font-extrabold leading-tight">{lead}</span> : null}
        <span className={`block leading-tight ${lead ? "" : "font-bold"}`}>{item.name}</span>
        <span className="block leading-tight text-ink-2">{item.size}</span>
      </span>
    </Link>
  );
}

/** One menu line: opens its outlet. With `withItem`, the item name leads (for an item at one outlet only). */
function MenuLineLink({ line, withItem }: { line: MenuHit; withItem: boolean }) {
  const details = [
    withItem ? line.outlet_name : null,
    line.variant,
    line.walk_min === null ? null : walkLabel(line.walk_min),
    line.is_benchmark ? "grocery store" : null,
  ].filter(Boolean);
  return (
    <Link
      href={outletHref(line.location_id)}
      prefetch={false}
      className="flex min-h-12 items-center justify-between gap-3 px-3 py-2 active:bg-paper-2"
    >
      <span className="min-w-0">
        <span className={`block leading-tight ${withItem ? "font-heading font-extrabold" : "font-bold"}`}>
          {withItem ? line.item : line.outlet_name}
        </span>
        {details.length > 0 ? <span className="block leading-tight text-ink-2">{details.join(" · ")}</span> : null}
      </span>
      <span className="shrink-0 font-mono font-bold tabular-nums">{formatPrice(line.price)}</span>
    </Link>
  );
}

/** "On menus": every menu line that matched, grouped by item name, cheapest first. Tapping opens the outlet. */
function MenuResults({ data }: { data: MenuSearchResponse }) {
  return (
    <section aria-labelledby="on-menus-heading" className="rounded-tag border-2 border-ink bg-card shadow-ink">
      <div className="px-3 pt-2 pb-1">
        <h2 id="on-menus-heading" className="font-heading text-lg font-extrabold leading-tight">
          On menus
        </h2>
        {data.kind === "typo" && data.did_you_mean ? (
          <p className="font-bold">Did you mean {data.did_you_mean}?</p>
        ) : null}
        <p className="leading-snug text-ink-2">
          {data.kind === "category" ? "From menu sections that match. " : ""}Cheapest first. Listed, not compared.
        </p>
      </div>
      {data.groups.map((group) =>
        group.lines.length === 1 ? (
          // An item at one outlet: one row, item name first.
          <div key={group.name} className="border-t-2 border-paper-2">
            <MenuLineLink line={group.lines[0]} withItem />
          </div>
        ) : (
          // The same item name at several outlets: a heading, then each outlet.
          <div key={group.name} className="border-t-2 border-paper-2">
            <h3 className="px-3 pt-2 font-heading font-extrabold leading-tight">{group.name}</h3>
            <ul className="divide-y-2 divide-paper-2">
              {group.lines.map((line) => (
                <li key={line.id}>
                  <MenuLineLink line={line} withItem={false} />
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
      {data.shown < data.total ? (
        <p className="border-t-2 border-paper-2 px-3 py-2 text-ink-2">
          The {data.shown} cheapest of {data.total}. Type more to narrow it down.
        </p>
      ) : null}
    </section>
  );
}

/** What Home shows under the search field while there is a query: tracked items first, then "On menus". */
export function SearchResults({ result, query, items, onPick }: Props) {
  const menu = useMenuSearch(query);
  if (result.kind === "empty") return null;
  return (
    <>
      {/* Always first, so the live region stays mounted while the layout below changes. */}
      <p role="status" aria-live="polite" className="sr-only">
        {menuSummary(menu)}
      </p>
      <Results result={result} menu={menu} items={items} onPick={onPick} />
    </>
  );
}

function Results({ result, menu, items, onPick }: Omit<Props, "query"> & { menu: MenuSearchState }) {
  const menuData = menu.active && !menu.waiting && menu.data && menu.data.shown > 0 ? menu.data : null;

  if (result.kind === "empty") return null;
  if (result.kind === "none") {
    if (menuData || (menu.active && menu.waiting)) {
      return (
        <div className="mx-4 max-h-[45dvh] overflow-y-auto pt-1 pr-1 pb-3">
          <p className={NOTE}>We don&apos;t compare that yet.{menuData ? "" : " Checking menus…"}</p>
          {menuData ? (
            <div className="mt-2">
              <MenuResults data={menuData} />
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <div>
        <p className={`${NOTE} mx-4`}>We don&apos;t track that yet. Pick an item:</p>
        <ItemTiles layout="row" items={items} onSelect={onPick} className="mt-2" />
      </div>
    );
  }

  const [first, ...rest] = result.items;
  return (
    <div className="mx-4 max-h-[45dvh] overflow-y-auto pt-1 pr-1 pb-3">
      <ul className="flex flex-col gap-2">
        <li>
          <ResultLink
            item={first}
            onPick={onPick}
            lead={result.kind === "typo" ? `Did you mean ${result.didYouMean.name}?` : undefined}
          />
        </li>
        {rest.map((item) => (
          <li key={item.id}>
            <ResultLink item={item} onPick={onPick} />
          </li>
        ))}
      </ul>
      {menuData ? (
        <div className="mt-3">
          <MenuResults data={menuData} />
        </div>
      ) : null}
    </div>
  );
}
