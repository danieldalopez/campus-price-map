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
// (aria-current). The art fills its square edge to edge (48 px on phones, 56 px wider up) so it carries
// the tile; 8 px to the name, 4 px to the size, spare height at the bottom.
const TILE =
  "flex h-full flex-col items-center rounded-tag border-2 border-ink bg-card px-2 pt-2 pb-2 " +
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
      ? "flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pt-0.5 pb-3 scroll-px-4 [scrollbar-width:none]"
      : "grid grid-cols-3 gap-3";
  // Row tiles are all one width (120 px on phones, 128 px wider up): enough for the longest size on one line
  // ("591 ml bottle"); a long name wraps onto its second line.
  const cell = layout === "row" ? "w-[7.5rem] shrink-0 snap-start sm:w-32" : "min-w-0";

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
            <ItemArt item={item} size={56} className="h-12 w-12 sm:h-14 sm:w-14" />
            {/* Same spacing on every tile: name 8 px under the art, size 4 px under the name. A two-line name
                pushes the size down; the spare height goes to the bottom, never between art and name. */}
            <span className="mt-2 line-clamp-2 w-full text-sm leading-[1.25] font-bold sm:text-[0.9375rem]">{item.name}</span>
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
