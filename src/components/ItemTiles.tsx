import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { tiltFor } from "@/lib/format";
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

const TILE =
  "flex h-full flex-col items-center justify-start gap-0.5 rounded-tag border-2 border-ink " +
  "bg-card px-1.5 pt-1.5 pb-2 text-center shadow-ink transition-transform " +
  "hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-ink-sm";

/**
 * Item stickers as tiles, from /api/items. Tapping one opens Results for that item (/item/[id]).
 * The emoji is a stand-in for the Step 10 stickers and is decorative; the name and size are always text.
 */
export function ItemTiles({ items, layout, trailing, onSelect, className = "" }: Props) {
  // The row hides its scrollbar: the cut-off last tile shows it scrolls, and
  // "See all items" is the non-scrolling alternative.
  const list =
    layout === "row"
      ? "flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pt-1 pb-3 scroll-px-4 [scrollbar-width:none]"
      : "grid grid-cols-3 gap-3";
  const cell = layout === "row" ? "h-[6.75rem] w-[7rem] shrink-0 snap-start" : "min-w-0";

  return (
    <ul className={`${list} ${className}`}>
      {items.map((item) => (
        <li key={item.id} className={cell}>
          <Link
            href={`/item/${item.id}`}
            prefetch={false}
            className={TILE}
            style={{ rotate: `${tiltFor(item.id) / 2}deg` } as CSSProperties}
            onClick={() => onSelect?.(item)}
          >
            <ItemArt item={item} size={48} />
            <span className={`font-bold leading-tight ${layout === "row" ? "line-clamp-2" : ""}`}>{item.name}</span>
            <span className={`leading-tight text-ink-2 ${layout === "row" ? "line-clamp-1" : ""}`}>
              {item.size}
            </span>
          </Link>
        </li>
      ))}
      {trailing ? <li className={cell}>{trailing}</li> : null}
    </ul>
  );
}
