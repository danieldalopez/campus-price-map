"use client";

import { useContext, useState } from "react";
import { getDeviceId } from "@/lib/device";
import type { Stock, StockResult } from "@/lib/types";
import { Button } from "./Button";
import { PricesRefresh } from "./PendingLine";

type Props = {
  itemId: string;
  locationId: string;
  stock: Stock;
  /** The item, in the buttons' accessible names: "Red Bull". */
  what: string;
};

type Report = "sold_out" | "back";

function thanks(result: StockResult, report: Report): string {
  if (report === "back") return result.recorded ? "Thanks. It's marked as back in stock." : "It's already marked as in stock.";
  if (!result.recorded) return "You've already said it's sold out. Another student needs to confirm it.";
  if (result.stock === "sold_out") return "Thanks. It's now marked sold out.";
  return "Thanks. It'll show as sold out once another student says so too.";
}

/**
 * Sold out reports on the Outlet page (SPEC section 7, Step 9). In stock: a **Sold out** button. One student
 * said so (maybe_sold_out): the "may be sold out" line, **Sold out here too** and **It's back**. Sold out: the
 * stamp is on the card already, so just **It's back**. The view does the counting (db/views.sql
 * `stock_status`): 2 students in 4 h for sold out, and it expires on its own.
 */
export function StockLine({ itemId, locationId, stock, what }: Props) {
  const refresh = useContext(PricesRefresh);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // This device's own sold out report, so it isn't offered the same button again before the reload.
  const [saidSoldOut, setSaidSoldOut] = useState(false);

  async function send(report: Report) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: itemId, location_id: locationId, status: report, device_id: getDeviceId() }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const error =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Couldn't save that. Try again in a moment.";
        setMessage({ text: error, error: true });
        return;
      }
      const result = body as StockResult;
      setSaidSoldOut(report === "sold_out");
      setMessage({ text: thanks(result, report), error: false });
      if (result.stock !== stock) refresh();
    } catch {
      setMessage({ text: "Couldn't save that. Check your connection and try again.", error: true });
    } finally {
      setBusy(false);
    }
  }

  const canSaySoldOut = stock !== "sold_out" && !saidSoldOut;
  const canSayBack = stock !== "in_stock";

  return (
    <>
      {stock === "maybe_sold_out" ? <p className="mt-1">A student said it may be sold out.</p> : null}
      {canSaySoldOut || canSayBack ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {canSaySoldOut ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => send("sold_out")}
              aria-label={stock === "maybe_sold_out" ? `${what} is sold out here too` : `${what} is sold out here`}
            >
              {stock === "maybe_sold_out" ? "Sold out here too" : "Sold out"}
            </Button>
          ) : null}
          {canSayBack ? (
            <Button variant="secondary" disabled={busy} onClick={() => send("back")} aria-label={`${what} is back in stock`}>
              It&apos;s back
            </Button>
          ) : null}
        </div>
      ) : null}
      <p role="status" className={message ? `mt-1 font-bold ${message.error ? "text-pricey" : ""}` : "sr-only"}>
        {message?.text ?? ""}
      </p>
    </>
  );
}
