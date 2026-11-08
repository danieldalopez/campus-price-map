import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";
type Size = "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-tag border-2 border-ink " +
  "font-heading font-extrabold leading-tight shadow-ink select-none " +
  "transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-ink-sm " +
  "disabled:cursor-not-allowed disabled:opacity-60 " +
  "aria-pressed:bg-ink aria-pressed:text-card";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-tag text-tag-ink",
  secondary: "bg-card text-ink",
};

// 48 px tall minimum; lg is the 64 px "Snap a price" size.
const SIZES: Record<Size, string> = {
  md: "min-h-12 px-4 text-base",
  lg: "min-h-16 px-6 text-xl",
};

/** Classes for anything that should look like a Button (e.g. a Link). */
export function buttonClasses(
  variant: Variant = "secondary",
  size: Size = "md",
  className = "",
): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

/** Chunky button: ink border, offset shadow, 48 px minimum; primary is yellow. */
export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: Props) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...rest} />;
}
