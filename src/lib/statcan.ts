// The StatCan line on Results (docs/SPEC.md section 7). Only in pipeline mode, only when
// `price_comparisons.statcan_kind` is set. The geography, month and assumption come from the data.

import { formatPrice } from "./format.ts";
import type { StatcanInfo } from "./types.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" → "Sep 2026". Anything else is shown as given. */
export function statcanMonth(refMonth: string | null): string | null {
  if (!refMonth) return null;
  const m = /^(\d{4})-(\d{2})/.exec(refMonth);
  if (!m) return refMonth;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : refMonth;
}

/** "British Columbia" → "BC". Canada and anything else are shown as given. */
export function statcanGeo(geo: string | null): string | null {
  if (!geo) return null;
  return geo.trim().toLowerCase() === "british columbia" ? "BC" : geo.trim();
}

/** "StatCan, BC, Sep 2026". */
export function statcanSource(bc: StatcanInfo): string {
  return ["StatCan", statcanGeo(bc.geo), statcanMonth(bc.ref_month)].filter(Boolean).join(", ");
}

export type StatcanLine = { stamp: boolean; text: string };

/**
 * same_item: "5.7x the BC grocery price · StatCan, BC, Sep 2026 · assuming a medium banana, about 120 g"
 * ingredients: "Brewing it yourself costs about $0.28 a cup · StatCan, BC, Sep 2026 · about 10 g of …"
 * `campusPrice` is the price the decision line points at; without it, same_item shows the StatCan price.
 */
export function statcanLine(bc: StatcanInfo, campusPrice: number | null): StatcanLine | null {
  if (!(bc.value > 0)) return null;
  const source = statcanSource(bc);
  const note = bc.note?.trim() || null;

  if (bc.kind === "same_item") {
    const geo = statcanGeo(bc.geo);
    const grocery = geo ? `the ${geo} grocery price` : "the grocery price";
    let head: string;
    if (campusPrice !== null && campusPrice > 0) {
      const ratio = Math.round((campusPrice / bc.value) * 10) / 10;
      head = ratio === 1 ? `About ${grocery}` : `${ratio.toFixed(1)}x ${grocery}`;
    } else {
      head = `${formatPrice(bc.value)} at ${grocery}`;
    }
    return { stamp: true, text: [head, source, note ? `assuming ${note}` : null].filter(Boolean).join(" · ") };
  }

  const head = `Brewing it yourself costs about ${formatPrice(bc.value)} a cup`;
  return { stamp: false, text: [head, source, note].filter(Boolean).join(" · ") };
}
