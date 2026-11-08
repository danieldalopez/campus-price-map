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

// Quiet sticker: white card, light border, no shadow. The art sits in a 56 px square so every tile lines up.
const TILE =
  "flex h-full flex-col items-center justify-start gap-1 rounded-tag border border-ink/20 " +
  "bg-card px-2 pt-2 pb-2.5 text-center transition-colors hover:border-ink-2 active:bg-paper-2";

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
  // Row tiles share one height (the tallest tile's), so a two-line size never gets cut off.
  const cell = layout === "row" ? "w-[8.5rem] shrink-0 snap-start" : "min-w-0";

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
            <span className="flex h-14 w-14 shrink-0 items-center justify-center" aria-hidden="true">
              <ItemArt item={item} size={44} />
            </span>
            {/* Name: a two-line area so the sizes line up; the full name is in the title and on Results. */}
            <span
              title={item.name}
              className={`w-full font-semibold leading-tight ${layout === "row" ? "line-clamp-2 min-h-[2.5em] text-[0.9375rem]" : ""}`}
            >
              {item.name}
            </span>
            {/* Size: always in full, wrapping to a second line rather than cut off. */}
            <span className="w-full text-sm leading-snug text-ink-2">{item.size}</span>
          </Link>
        </li>
      ))}
      {trailing ? <li className={cell}>{trailing}</li> : null}
    </ul>
  );
}
