import { formatPrice } from "@/lib/format";
import type { Deal } from "@/lib/types";
import { Stamp } from "./Stamp";

const COUNT_WORDS: Record<number, string> = { 2: "two", 3: "three", 4: "four" };

/**
 * A multi-buy deal under the price: "DEAL · 2 for $5.99 · $3.00 each, $1.99 less than buying two", and
 * "Cheapest on campus if you buy 2" when it beats every other outlet's single price. The single price above
 * stays the main price (src/lib/deals.ts).
 */
export function DealLine({ deal }: { deal: Deal | null | undefined }) {
  if (!deal) return null;
  const count = COUNT_WORDS[deal.qty] ?? String(deal.qty);
  return (
    <div className="mt-2">
      <p className="flex items-start gap-2">
        <Stamp kind="deal" className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="font-bold">
            {deal.qty} for {formatPrice(deal.price)}
          </span>{" "}
          · {formatPrice(deal.each)} each
          {deal.saving !== null ? `, ${formatPrice(deal.saving)} less than buying ${count}` : ""}
        </span>
      </p>
      {deal.cheapest_on_campus ? (
        <p className="mt-1 font-bold text-cheap">Cheapest on campus if you buy {deal.qty}</p>
      ) : null}
    </div>
  );
}
