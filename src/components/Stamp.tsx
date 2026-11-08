export type StampKind = "cheapest" | "sold-out" | "pending" | "statcan";

const WORDS: Record<StampKind, string> = {
  cheapest: "CHEAPEST",
  "sold-out": "SOLD OUT",
  pending: "PENDING",
  statcan: "STATCAN",
};

/**
 * Outlined rubber stamp, slightly rotated: CHEAPEST (green), SOLD OUT (red), PENDING (blue), STATCAN (ink).
 * The word carries the meaning; the colour is extra (section 11).
 */
export function Stamp({ kind, className = "" }: { kind: StampKind; className?: string }) {
  return <span className={`stamp stamp--${kind} ${className}`}>{WORDS[kind]}</span>;
}
