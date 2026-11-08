import { formatPrice } from "@/lib/format";
import { walkLabel } from "@/lib/geo";
import { isApproximate } from "@/lib/outlet";
import { freshness } from "@/lib/pricing";
import type { PriceRow } from "@/lib/types";
import { BoughtButton, ConfirmedLine, WrongPriceButton } from "./BoughtButton";
import Link from "next/link";
import { outletHref } from "./OutletLink";
import { DealLine } from "./DealLine";
import { PendingLine } from "./PendingLine";
import { PriceBand } from "./PriceBand";
import { PriceTag } from "./PriceTag";
import { Stamp } from "./Stamp";
import { StockButtons } from "./StockButtons";

type Props = {
  row: PriceRow;
  now: number;
  cheapest: boolean;
  /** Farther rows that don't save $1.00 or more, and prices older than 14 days. */
  dimmed: boolean;
  /** A Farther row that stands out: how much it saves compared with near you. */
  saves: number | null;
  /** "near you", or "near AMS Nest" when walk times are from the Nest. */
  nearWords?: string;
  /** The item on this Results page, for "I bought it here". */
  item: { id: string; name: string; size: string };
};

/**
 * One outlet on Results (SPEC section 7). The official price is the only price shown big. Dimming never
 * drops text below 4.5:1: it changes the card, not the ink.
 */
export function OutletRow({ row, now, cheapest, dimmed, saves, nearWords = "near you", item }: Props) {
  const fresh = freshness(row, now);
  const soldOut = row.stock === "sold_out";
  const place = [
    row.walk_min === null ? null : walkLabel(row.walk_min),
    isApproximate(row.outlet.location_precision) ? "approximate location" : null,
  ].filter(Boolean);
  const card = dimmed || fresh?.stale ? "border-dashed border-ink/30 bg-paper-2" : "border-ink/15 bg-card";

  return (
    <li className={`rounded-tag border p-3 ${card}`}>
      <div className="flex items-start justify-between gap-3">
        <Link
          href={outletHref(row.outlet.id)}
          prefetch={false}
          className="group -m-1 flex min-h-12 min-w-0 flex-1 items-center gap-1 rounded-tag p-1 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-heading text-lg font-bold leading-tight group-hover:underline">
              {row.outlet.name}
            </span>
            {place.length > 0 ? <span className="block text-sm text-ink-2">{place.join(" · ")}</span> : null}
          </span>
          <span aria-hidden="true" className="shrink-0 text-xl text-ink-2">
            ›
          </span>
        </Link>
        {row.price !== null ? (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <PriceTag price={row.price} tiltId={row.outlet.id} size="lg" />
            {fresh ? <p className="text-right text-sm text-ink-2">{fresh.text}</p> : null}
          </div>
        ) : null}
      </div>

      {cheapest || soldOut || (row.price !== null && (row.band || row.chip)) ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          {cheapest ? <Stamp kind="cheapest" /> : null}
          {soldOut ? <Stamp kind="sold-out" /> : null}
          {row.price !== null ? <PriceBand band={row.band} pctVsMedian={row.pct_vs_median} /> : null}
          {row.price !== null && row.chip ? <span className="chip">{row.chip}</span> : null}
        </div>
      ) : null}

      {row.price !== null || row.just_confirmed ? null : (
        <p className="mt-2">
          <span className="font-bold">No confirmed price yet</span>
          {row.estimate ? (
            <span className="text-ink-2">
              {" "}
              · estimated {formatPrice(row.estimate.low)} to {formatPrice(row.estimate.high)} · Snap it to confirm
            </span>
          ) : null}
        </p>
      )}
      {row.price === null && fresh ? <p className="mt-1 text-sm text-ink-2">{fresh.text}</p> : null}
      {row.price !== null ? <DealLine deal={row.deal} /> : null}
      {row.price !== null ? <ConfirmedLine row={row} now={now} /> : null}
      {row.price !== null ? <WrongPriceButton outlet={row.outlet} item={item} price={row.price} /> : null}
      {saves !== null ? <p className="mt-1 font-bold text-cheap">Saves {formatPrice(saves)} compared with {nearWords}</p> : null}
      {row.just_confirmed ? (
        <p className="mt-1">
          <span className="font-bold">Just confirmed: </span>
          <span className="font-mono font-bold">{formatPrice(row.just_confirmed.price)}</span> · comparisons update
          on the next refresh
        </p>
      ) : null}
      <PendingLine pending={row.pending} what={`at ${row.outlet.name}`} />
      {row.stock === "maybe_sold_out" ? <p className="mt-1">A student said it may be sold out.</p> : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {row.price !== null ? (
          <BoughtButton outlet={row.outlet} item={item} price={row.price} className="w-full text-center" />
        ) : null}
        <StockButtons outlet={row.outlet} item={item} stock={row.stock} />
      </div>
    </li>
  );
}
