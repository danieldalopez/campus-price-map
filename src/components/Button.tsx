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
  // Everything else is quieter: thin edge, no shadow (design pass).
  secondary: "bg-card text-ink border border-line font-bold hover:border-ink active:bg-paper-2",
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

/** Button, 48 px minimum. Primary: yellow, ink border, offset shadow. Secondary: quiet, thin edge. */
export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: Props) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...rest} />;
}
