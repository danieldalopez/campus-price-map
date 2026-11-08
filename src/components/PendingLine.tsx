"use client";

import { createContext, useContext, useState } from "react";
import { getDeviceId } from "@/lib/device";
import { formatPrice, spokenPrice } from "@/lib/format";
import type { PriceFields, Vote, VoteResult } from "@/lib/types";
import { Button } from "./Button";
import { Stamp } from "./Stamp";

/** The page's "reload prices" (useApi's retry), called after a vote made a report official or rejected. */
export const PricesRefresh = createContext<() => void>(() => {});

type Props = {
  /** Null once the report is no longer pending: the line goes, the thank-you after a vote stays. */
  pending: PriceFields["pending"];
  /** What the price is for, in the buttons' accessible names: "Red Bull" or "Blue Chip Cafe". */
  what: string;
};

const VOTE_WORDS: Record<Vote, string> = { yes: "Yes", no: "No", unsure: "Not sure" };

function thanks(result: VoteResult, vote: Vote): string {
  if (result.status === "official") return "Thanks, it's confirmed. It's now the official price.";
  if (result.status === "rejected") return "Thanks. That report is now hidden.";
  if (!result.recorded) return "You've already voted on this one.";
  return vote === "unsure" ? "Thanks. Someone else can confirm it." : "Thanks, your vote is in.";
}

/**
 * The pending line on Results and the Outlet page (SPEC section 7): a PENDING stamp and "New report: $3.25 ·
 * waiting for a second student", or "Your report: …" when this device made it. Never colour alone: the
 * word PENDING and "waiting for a second student" carry the meaning.
 *
 * Step 7: everyone but the reporter gets Yes / No / Not sure (POST /api/vote). A device that already voted
 * sees its vote instead. Render this whether or not there's a pending report, so the thank-you survives the
 * reload that removes a report once it's confirmed or rejected.
 */
export function PendingLine({ pending, what }: Props) {
  const refresh = useContext(PricesRefresh);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [voted, setVoted] = useState<Vote | null>(null);

  async function cast(vote: Vote) {
    if (!pending || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ price_id: pending.price_id, vote, device_id: getDeviceId() }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const error =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Couldn't save your vote. Try again in a moment.";
        setMessage({ text: error, error: true });
        return;
      }
      const result = body as VoteResult;
      setVoted(vote);
      setMessage({ text: thanks(result, vote), error: false });
      if (result.status !== "pending") refresh();
    } catch {
      setMessage({ text: "Couldn't save your vote. Check your connection and try again.", error: true });
    } finally {
      setBusy(false);
    }
  }

  const myVote = voted ?? pending?.my_vote ?? null;
  const canVote = pending !== null && !pending.mine && myVote === null;

  return (
    <>
      {pending ? (
        <div className="mt-2">
          <p className="flex flex-wrap items-center gap-2">
            <Stamp kind="pending" />
            <span>
              {pending.mine ? "Your report" : "New report"}:{" "}
              <span className="font-mono font-bold" aria-label={spokenPrice(pending.price)}>
                {formatPrice(pending.price)}
              </span>{" "}
              · waiting for a second student
            </span>
          </p>
          {canVote ? (
            <div role="group" aria-label={`Is ${formatPrice(pending.price)} the price, ${what}?`} className="mt-2">
              <p className="font-bold">Is this the price?</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {(Object.keys(VOTE_WORDS) as Vote[]).map((v) => (
                  <Button
                    key={v}
                    variant={v === "yes" ? "primary" : "secondary"}
                    disabled={busy}
                    onClick={() => cast(v)}
                    aria-label={`${VOTE_WORDS[v]}: ${formatPrice(pending.price)}, ${what}`}
                  >
                    {VOTE_WORDS[v]}
                  </Button>
                ))}
              </div>
            </div>
          ) : myVote && !pending.mine ? (
            <p className="mt-1 text-ink-2">You voted {VOTE_WORDS[myVote]}.</p>
          ) : null}
        </div>
      ) : null}
      <p role="status" className={message ? `mt-1 font-bold ${message.error ? "text-pricey" : ""}` : "sr-only"}>
        {message?.text ?? ""}
      </p>
    </>
  );
}
