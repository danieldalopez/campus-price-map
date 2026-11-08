import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";
type Size = "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-tag " +
  "font-heading leading-tight select-none transition-transform " +
  "disabled:cursor-not-allowed disabled:opacity-60 " +
  "aria-pressed:bg-ink aria-pressed:text-card";

const VARIANTS: Record<Variant, string> = {
  // The one loud control: yellow, ink border, hard offset shadow (the sticker look).
  primary:
    "bg-tag text-tag-ink border-2 border-ink shadow-ink font-extrabold " +
    "active:translate-x-[2px] active:translate-y-[2px] active:shadow-ink-sm",
  // Everything else is the same sticker one step down: cream, ink border, small (2 px) shadow, same press.
  secondary:
    "bg-card text-ink border-2 border-ink shadow-ink-sm font-bold hover:bg-tag-pale " +
    "active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
};

// 48 px tall minimum (tap target rule); lg is the 52 px "Snap a price" size.
const SIZES: Record<Size, string> = {
  md: "min-h-12 px-4 text-base",
  lg: "min-h-[52px] px-5 text-lg",
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

/** Chunky button, 48 px minimum: ink border and offset shadow. Primary is yellow (3 px), secondary cream (2 px). */
export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: Props) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...rest} />;
}
