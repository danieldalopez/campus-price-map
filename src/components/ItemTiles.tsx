import Link from "next/link";
import type { ReactNode } from "react";
import { ItemArt } from "@/components/ItemArt";
import type { Item } from "@/lib/types";

type Props = {
  items: Item[];
  /** "row": the horizontal scroll on Home. "grid": the See all items grid. */
  layout: "row" | "grid";
  /** Extra tile at the end of the row (the "See all items" button). */
  trailing?: ReactNode;
  /** Called on tap, before Results opens (Home asks for location here). */
  onSelect?: (item: Item) => void;
  className?: string;
};

// Quiet sticker: white card, light border, no shadow. The art sits in a 48 px square so every tile lines up.
const TILE =
  "flex h-full flex-col items-center justify-start gap-0.5 rounded-tag border border-ink/20 " +
  "bg-card px-2.5 pt-1.5 pb-2 text-center transition-colors hover:border-ink-2 active:bg-paper-2";

/**
 * Item stickers as tiles, from /api/items. Tapping one opens Results for that item (/item/[id]).
 * The emoji is a stand-in for the Step 10 stickers and is decorative; the name and size are always text.
 */
export function ItemTiles({ items, layout, trailing, onSelect, className = "" }: Props) {
  // The row hides its scrollbar: the cut-off last tile shows it scrolls, and
  // "See all items" is the non-scrolling alternative.
  const list =
    layout === "row"
      ? "flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pt-0.5 pb-3 scroll-px-4 [scrollbar-width:none]"
      : "grid grid-cols-3 gap-3";
  // Row tiles grow to fit their name and size on one line (never cut, never wrapped), from 120 px up.
  const cell = layout === "row" ? "min-w-[7.5rem] shrink-0 snap-start" : "min-w-0";

  return (
    <ul className={`${list} ${className}`}>
      {items.map((item) => (
        <li key={item.id} className={cell}>
          <Link
            href={`/item/${item.id}`}
            prefetch={false}
            className={TILE}
            onClick={() => onSelect?.(item)}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center" aria-hidden="true">
              <ItemArt item={item} size={40} />
            </span>
            {/* Name and size: one line each in the row, in full (the tile widens instead). */}
            <span
              className={`w-full font-semibold leading-tight ${layout === "row" ? "text-[0.9375rem] whitespace-nowrap" : ""}`}
            >
              {item.name}
            </span>
            <span className={`w-full text-sm leading-snug text-ink-2 ${layout === "row" ? "whitespace-nowrap" : ""}`}>
              {item.size}
            </span>
          </Link>
        </li>
      ))}
      {trailing ? <li className={cell}>{trailing}</li> : null}
    </ul>
  );
}
