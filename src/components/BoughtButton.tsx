"use client";

import { timeAgo } from "@/lib/pricing";
import type { PriceFields } from "@/lib/types";
import { useOpenBought } from "./BoughtProvider";
import { Button } from "./Button";

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
    <Button
      className={className}
      onClick={() => open({ outlet, item, price })}
      aria-label={`I bought ${item.name} at ${outlet.name}`}
    >
      I bought it here
    </Button>
  );
}

/**
 * "Wrong price?" under a price: opens the same sheet to report the right one (a tag photo or typed). It
 * waits for a second student before it changes anything, like every report.
 */
export function WrongPriceButton({ outlet, item, price }: Omit<Props, "className">) {
  const open = useOpenBought();
  return (
    <button
      type="button"
      onClick={() => open({ outlet, item, price, mode: "wrong" })}
      className="mt-1 min-h-12 py-2 text-left font-bold underline decoration-2 underline-offset-2"
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
    <p className="mt-1 font-bold text-cheap">
      <span aria-hidden="true">✓ </span>Confirmed by a student · {timeAgo(at, now)}
    </p>
  );
}
