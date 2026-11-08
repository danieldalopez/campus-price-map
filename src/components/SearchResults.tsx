import Link from "next/link";
import { itemEmoji } from "@/lib/item-art";
import type { SearchResult } from "@/lib/search";
import type { Item } from "@/lib/types";
import { ItemTiles } from "./ItemTiles";

type Props = {
  result: SearchResult<Item>;
  /** Every item, for the tiles shown when nothing matches. */
  items: Item[];
  onPick: (item: Item) => void;
};

const ROW =
  "flex min-h-12 items-center gap-3 rounded-tag border-2 border-ink bg-card px-3 py-2 shadow-ink " +
  "active:translate-x-[2px] active:translate-y-[2px] active:shadow-ink-sm";

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

function ResultLink({ item, onPick, lead }: { item: Item; onPick: (item: Item) => void; lead?: string }) {
  return (
    <Link href={`/item/${item.id}`} prefetch={false} className={ROW} onClick={() => onPick(item)}>
      <span aria-hidden="true" className="text-2xl leading-none">
        {itemEmoji(item)}
      </span>
      <span className="min-w-0">
        {lead ? <span className="block font-heading font-extrabold leading-tight">{lead}</span> : null}
        <span className={`block leading-tight ${lead ? "" : "font-bold"}`}>{item.name}</span>
        <span className="block leading-tight text-ink-2">{item.size}</span>
      </span>
    </Link>
  );
}

/** What Home shows under the search field while there is a query. */
export function SearchResults({ result, items, onPick }: Props) {
  if (result.kind === "empty") return null;

  if (result.kind === "none") {
    return (
      <div>
        <p className="mx-4 inline-block rounded-tag border-2 border-ink bg-card px-3 py-1.5 font-bold shadow-ink">
          We don&apos;t track that yet. Pick an item:
        </p>
        <ItemTiles layout="row" items={items} onSelect={onPick} className="mt-2" />
      </div>
    );
  }

  const [first, ...rest] = result.items;
  return (
    <ul className="mx-4 flex max-h-[45dvh] flex-col gap-2 overflow-y-auto pt-1 pr-1 pb-3">
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
  );
}
