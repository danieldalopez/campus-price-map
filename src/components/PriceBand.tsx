import type { Band } from "@/lib/types";

export type { Band };

const BANDS: Record<Band, { icon: string; word: string }> = {
  good: { icon: "✓", word: "Good price" },
  average: { icon: "=", word: "Average" },
  high: { icon: "↑", word: "High" },
};

type Props = {
  /** null (fewer than 3 outlets, grocery baseline, estimated rows) renders nothing. */
  band: Band | null;
  /** Percent vs the campus median, e.g. -15 for 15% below. Spoken, not shown. */
  pctVsMedian?: number | null;
  className?: string;
};

/** Overrides the chunky .price-band chip (globals.css) down to a small label. */
const LABEL = "min-h-0 rounded border-0 px-1.5 py-0.5 text-sm";

function spokenPct(pct: number): string {
  const p = Math.round(Math.abs(pct));
  if (p === 0) return ", at the campus median";
  return `, ${p}% ${pct < 0 ? "below" : "above"} the campus median`;
}

/**
 * Small flat label beside the PriceTag, never replacing it: no border, no shadow, so it reads as a note on the
 * price rather than a button. Always icon plus word, never colour alone. Screen readers hear e.g. "Good price,
 * 15% below the campus median".
 */
export function PriceBand({ band, pctVsMedian = null, className = "" }: Props) {
  if (!band) return null;
  const { icon, word } = BANDS[band];
  return (
    <span className={`price-band price-band--${band} ${LABEL} ${className}`}>
      <span aria-hidden="true">{icon}</span>
      {word}
      {pctVsMedian !== null && <span className="sr-only">{spokenPct(pctVsMedian)}</span>}
    </span>
  );
}
