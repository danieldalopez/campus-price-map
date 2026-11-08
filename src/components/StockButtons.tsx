"use client";

import { useState } from "react";
import { getDeviceId } from "@/lib/device";
import type { Stock, StockResult } from "@/lib/types";
import { PRICES_CHANGED } from "./BoughtProvider";
import { Button } from "./Button";

type Props = {
  outlet: { id: string; name: string };
  item: { id: string; name: string };
  stock: Stock;
};

/** This phone's own sold-out report counts for 4 hours (same window as the stock_status view). */
const MINE_FOR_MS = 4 * 60 * 60_000;
const key = (itemId: string, outletId: string) => `cpm.sold_out.${itemId}.${outletId}`;

function reportedRecently(itemId: string, outletId: string): boolean {
  try {
    const at = Number(window.localStorage.getItem(key(itemId, outletId)));
    return at > 0 && Date.now() - at < MINE_FOR_MS;
  } catch {
    return false;
  }
}

function remember(itemId: string, outletId: string, soldOut: boolean) {
  try {
    if (soldOut) window.localStorage.setItem(key(itemId, outletId), String(Date.now()));
    else window.localStorage.removeItem(key(itemId, outletId));
  } catch {
    // Storage blocked: the button may show again, and a repeat report from one phone still counts once.
  }
}

/**
 * Sold out (SPEC Step 9): "Sold out here?" with a confirm step, and "It's back". One report only says "may
 * be sold out" for 2 hours; SOLD OUT needs 2 different students in 4 hours; one "It's back" clears it
 * (computed by the stock_status view). The page reloads its prices after a report.
 */
export function StockButtons({ outlet, item, stock }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [mine, setMine] = useState(() => typeof window !== "undefined" && reportedRecently(item.id, outlet.id));

  async function report(status: "sold_out" | "back") {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: item.id, location_id: outlet.id, status, device_id: getDeviceId() }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({
          text:
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
              ? body.error
              : "Couldn't save that. Try again in a moment.",
          error: true,
        });
        return;
      }
      const result = body as StockResult;
      remember(item.id, outlet.id, status === "sold_out");
      setMine(status === "sold_out");
      setConfirming(false);
      setMessage({
        text:
          status === "back"
            ? "Thanks! It's marked as back in stock."
            : result.stock === "sold_out"
              ? "Thanks! It's now marked SOLD OUT for the next few hours."
              : "Thanks! If another student reports it too, it'll be marked SOLD OUT.",
        error: false,
      });
      window.dispatchEvent(new Event(PRICES_CHANGED));
    } catch {
      setMessage({ text: "Couldn't save that. Check your connection and try again.", error: true });
    } finally {
      setBusy(false);
    }
  }

  const showBack = stock !== "in_stock" || mine;
  const showSoldOut = stock !== "sold_out" && !mine;

  return (
    <div className="mt-2">
      {confirming ? (
        <div role="group" aria-label={`Is ${item.name} sold out at ${outlet.name}?`} className="flex flex-col gap-2">
          <p className="font-bold">
            Mark {item.name} sold out at {outlet.name}?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => report("sold_out")}>
              {busy ? "Saving…" : "Yes, it's sold out"}
            </Button>
            <Button disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {showSoldOut ? (
            <Button
              disabled={busy}
              onClick={() => setConfirming(true)}
              aria-label={`${stock === "maybe_sold_out" ? "Sold out here too" : "Sold out here"}? ${item.name} at ${outlet.name}`}
            >
              {stock === "maybe_sold_out" ? "Sold out here too?" : "Sold out here?"}
            </Button>
          ) : null}
          {showBack ? (
            <Button
              disabled={busy}
              onClick={() => report("back")}
              aria-label={`It's back: ${item.name} at ${outlet.name}`}
            >
              It&apos;s back
            </Button>
          ) : null}
        </div>
      )}
      {mine && stock !== "sold_out" && !message ? (
        <p className="mt-1 text-ink-2">You reported it sold out. Waiting for a second student.</p>
      ) : null}
      <p role="status" className={message ? `mt-1 font-bold ${message.error ? "text-pricey" : ""}` : "sr-only"}>
        {message?.text ?? ""}
      </p>
    </div>
  );
}
