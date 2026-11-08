"use client";

import { timeAgo } from "@/lib/pricing";
import type { PriceFields } from "@/lib/types";
import { useOpenBought } from "./BoughtProvider";

/**
 * Contribution buttons ("I bought it here", "Sold out here?", "It's back"): secondary and quiet, so the price
 * and Worth the walk lead. Thin border, no shadow, but still a 48 px target with a 3:1 edge.
 */
export const QUIET_BUTTON =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-tag border border-ink/50 bg-card px-3 " +
  "text-center font-heading text-base font-bold leading-tight text-ink select-none " +
  "hover:bg-paper active:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-60";

type Props = {
  outlet: { id: string; name: string };
  item: { id: string; name: string; size: string };
  price: number | null;
  className?: string;
};

/** "I bought it here" on a price (SPEC Step 8): opens the sheet to confirm what you paid. */
export function BoughtButton({ outlet, item, price, className = "" }: Props) {
  const open = useOpenBought();
  return (
    <button
      type="button"
      className={`${QUIET_BUTTON} ${className}`}
      onClick={() => open({ outlet, item, price })}
      aria-label={`I bought ${item.name} at ${outlet.name}`}
    >
      I bought it here
    </button>
  );
}

/**
 * "Wrong price?" under a price: opens the same sheet to report the right one (a tag photo or typed). It
 * waits for a second student before it changes anything, like every report.
 */
export function WrongPriceButton({ outlet, item, price, className = "" }: Props) {
  const open = useOpenBought();
  return (
    <button
      type="button"
      onClick={() => open({ outlet, item, price, mode: "wrong" })}
      className={`flex min-h-12 items-center text-left font-bold underline decoration-2 underline-offset-4 ${className}`}
      aria-label={`Wrong price? Report the price of ${item.name} at ${outlet.name}`}
    >
      Wrong price?
    </button>
  );
}

/**
 * "✓ Confirmed by a student · 20 min ago": when a student last confirmed this price (Step 8). Shown with every
 * price that has one, so people know how fresh it is.
 */
export function ConfirmedLine({
  row,
  now,
}: {
  row: Pick<PriceFields, "last_confirmed_at" | "source" | "updated_at">;
  now: number;
}) {
  const at = row.last_confirmed_at;
  if (!at) return null;
  // A student price already says "Confirmed by 2 students · 20 min ago" (src/lib/pricing.ts freshness):
  // only add this line when a later confirmation makes it fresher.
  const studentPrice = row.source === "photo" || row.source === "receipt" || row.source === "typed";
  if (studentPrice && row.updated_at && Date.parse(at) <= Date.parse(row.updated_at) + 60_000) return null;
  return (
    <p className="mt-1 text-sm font-bold leading-snug text-cheap">
      <span aria-hidden="true">✓ </span>Confirmed by a student · {timeAgo(at, now)}
    </p>
  );
}
