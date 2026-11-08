import Link from "next/link";
import type { ReactNode } from "react";

/** Where an outlet's page lives: name, today's hours, compared prices and the full menu (SPEC section 7). */
export function outletHref(id: string): string {
  return `/outlet/${encodeURIComponent(id)}`;
}

type Props = { id: string; children: ReactNode; className?: string };

/**
 * An outlet name that opens its page. Underlined so it reads as a link; the invisible ::before extends the
 * tap target to at least 48 px tall (section 11) without making the row taller.
 */
export function OutletLink({ id, children, className = "" }: Props) {
  return (
    <Link
      href={outletHref(id)}
      prefetch={false}
      className={
        "relative underline decoration-2 underline-offset-4 before:absolute before:-inset-x-1 " +
        `before:-inset-y-3.5 before:content-[''] ${className}`
      }
    >
      {children}
    </Link>
  );
}
