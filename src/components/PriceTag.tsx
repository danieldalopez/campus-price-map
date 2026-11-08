import type { CSSProperties } from "react";
import { formatPrice, tiltFor } from "@/lib/format";

type Size = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<Size, string> = {
  sm: "text-base px-2 py-1",
  md: "text-xl px-2.5 py-1.5",
  lg: "text-3xl px-3 py-2",
};

type Props = {
  /** The official price. PriceTag is the only place a price is ever shown big. */
  price: number;
  /** Outlet id: fixes the tilt (-2 to 2 degrees) so it never changes between renders. */
  tiltId: string;
  size?: Size;
  className?: string;
};

/** Yellow price tag with a hole on the left, 2 px ink border, mono price (SPEC section 11). */
export function PriceTag({ price, tiltId, size = "md", className = "" }: Props) {
  const style = { "--tilt": `${tiltFor(tiltId)}deg` } as CSSProperties;
  return (
    <span className={`price-tag ${SIZE_CLASSES[size]} ${className}`} style={style}>
      {formatPrice(price)}
    </span>
  );
}
