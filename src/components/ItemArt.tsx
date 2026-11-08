import Image from "next/image";
import { itemArtSrc } from "@/lib/item-art";
import type { Item } from "@/lib/types";

/** An item's sticker. Decorative: the item name is always next to it as text. */
export function ItemArt({ item, size, className = "" }: { item: Pick<Item, "id">; size: number; className?: string }) {
  return (
    <Image
      src={itemArtSrc(item)}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`shrink-0 rounded-tag ${className}`}
    />
  );
}
