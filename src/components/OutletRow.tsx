import { formatPrice } from "@/lib/format";
import { walkLabel } from "@/lib/geo";
import { isApproximate } from "@/lib/outlet";
import { freshness } from "@/lib/pricing";
import type { PriceRow } from "@/lib/types";
import { BoughtButton, ConfirmedLine, WrongPriceButton } from "./BoughtButton";
import { OutletLink } from "./OutletLink";
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
  /** The item on this Results page, for "I bought it here". */
  item: { id: string; name: string; size: string };
};

/**
 * One outlet on Results (SPEC section 7). The official price is the only price shown big. Dimming never
 * drops text below 4.5:1: it changes the card, not the ink.
 */
export function OutletRow({ row, now, cheapest, dimmed, saves, item }: Props) {
  const fresh = freshness(row, now);
  const soldOut = row.stock === "sold_out";
  const place = [
    row.walk_min === null ? null : walkLabel(row.walk_min),
    isApproximate(row.outlet.location_precision) ? "approximate location" : null,
  ].filter(Boolean);
  const card = dimmed || fresh?.stale ? "border-dashed bg-paper-2" : "bg-card shadow-ink";

  return (
    <li className={`rounded-tag border-2 border-ink p-3 ${card}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-extrabold leading-tight">
            <OutletLink id={row.outlet.id}>{row.outlet.name}</OutletLink>
          </h3>
          {place.length > 0 ? <p className="text-ink-2">{place.join(" · ")}</p> : null}
        </div>
        {cheapest || soldOut ? (
          <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
            {cheapest ? <Stamp kind="cheapest" /> : null}
            {soldOut ? <Stamp kind="sold-out" /> : null}
          </div>
        ) : null}
      </div>

      {row.price !== null ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <PriceTag price={row.price} tiltId={row.outlet.id} size="lg" />
          <PriceBand band={row.band} pctVsMedian={row.pct_vs_median} />
          {row.chip ? <span className="chip">{row.chip}</span> : null}
        </div>
      ) : row.just_confirmed ? null : (
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

      {fresh ? <p className="mt-1 text-ink-2">{fresh.text}</p> : null}
      {row.price !== null ? <ConfirmedLine row={row} now={now} /> : null}
      {row.price !== null ? <WrongPriceButton outlet={row.outlet} item={item} price={row.price} /> : null}
      {saves !== null ? <p className="mt-1 font-bold text-cheap">Saves {formatPrice(saves)} compared with near you</p> : null}
      {row.just_confirmed ? (
        <p className="mt-1">
          <span className="font-bold">Just confirmed: </span>
          <span className="font-mono font-bold">{formatPrice(row.just_confirmed.price)}</span> · comparisons update
          on the next refresh
        </p>
      ) : null}
      <PendingLine pending={row.pending} what={`at ${row.outlet.name}`} />
      {row.stock === "maybe_sold_out" ? <p className="mt-1">A student said it may be sold out.</p> : null}
      {row.price !== null ? (
        <BoughtButton outlet={row.outlet} item={item} price={row.price} className="mt-2" />
      ) : null}
      <StockButtons outlet={row.outlet} item={item} stock={row.stock} />
    </li>
  );
}
