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

// Sticker card: cream, 2 px ink outline, 2 px hard shadow; pale yellow while pressed or selected
// (aria-current). Art sits in a 48 px square so every tile lines up; 8 px to the name, 4 px to the size.
const TILE =
  "flex h-full flex-col items-center rounded-tag border-2 border-ink bg-card px-2.5 pt-2 pb-2.5 " +
  "text-center shadow-ink-sm transition-[translate,box-shadow,background-color] " +
  "hover:bg-tag-pale active:translate-x-[2px] active:translate-y-[2px] active:bg-tag-pale active:shadow-none " +
  "aria-[current=true]:bg-tag-pale";

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
  // Row tiles fit the size on one line, from 120 to 160 px wide; a long name wraps onto its second line.
  const cell = layout === "row" ? "w-max min-w-[7.5rem] max-w-[10rem] shrink-0 snap-start" : "min-w-0";

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
            {/* Two-line name area on every tile, text sitting on its bottom line, so names and sizes line up
                across the row and the size stays 4 px under the name. */}
            <span className="mt-2 flex min-h-[2.5em] w-full items-end justify-center text-[0.9375rem] leading-[1.25]">
              <span className="line-clamp-2 font-semibold">{item.name}</span>
            </span>
            <span className={`mt-1 w-full text-sm leading-tight text-ink-2 ${layout === "row" ? "whitespace-nowrap" : ""}`}>
              {item.size}
            </span>
          </Link>
        </li>
      ))}
      {trailing ? <li className={cell}>{trailing}</li> : null}
    </ul>
  );
}
