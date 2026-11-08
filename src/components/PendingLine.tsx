import { formatPrice } from "@/lib/format";
import type { PriceFields } from "@/lib/types";
import { Stamp } from "./Stamp";

type Props = { pending: NonNullable<PriceFields["pending"]> };

/**
 * The pending line on Results and the Outlet page (SPEC section 7): a PENDING stamp and "New report: $3.25 ·
 * waiting for a second student", or "Your report: …" when this device made it. Never colour alone: the
 * word PENDING and "waiting for a second student" carry the meaning.
 *
 * Step 7 adds Yes / No / Not sure here (only when `mine` is false), so both pages get them at once.
 */
export function PendingLine({ pending }: Props) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2">
      <Stamp kind="pending" />
      <span>
        {pending.mine ? "Your report" : "New report"}:{" "}
        <span className="font-mono font-bold">{formatPrice(pending.price)}</span> · waiting for a second student
      </span>
    </p>
  );
}
