import type { CSSProperties } from "react";
import { formatPrice, tiltFor } from "@/lib/format";

type Size = "sm" | "md" | "lg";

// Tighter padding than before so the tag hugs the price; lg is the 30 px price on Results and Outlet cards.
const SIZE_CLASSES: Record<Size, string> = {
  sm: "text-base px-1.5 py-0.5",
  md: "text-xl px-2 py-1",
  lg: "text-[30px] px-2 py-1",
};

type Props = {
  /** The official price. PriceTag is the only place a price is ever shown big. */
  price: number;
  /** Outlet id: fixes the tilt (-2 to 2 degrees) so it never changes between renders. */
  tiltId: string;
  size?: Size;
  className?: string;
};

/**
 * Yellow price tag with a hole on the left, 2 px ink border, mono price (SPEC section 11). It keeps the hard
 * offset shadow: with the primary button, it's the one thing on a screen that pops.
 */
export function PriceTag({ price, tiltId, size = "md", className = "" }: Props) {
  const style = { "--tilt": `${tiltFor(tiltId)}deg` } as CSSProperties;
  return (
    <span className={`price-tag ${SIZE_CLASSES[size]} ${className}`} style={style}>
      {formatPrice(price)}
    </span>
  );
}
