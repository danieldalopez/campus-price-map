"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { clearIntent } from "@/lib/bought";
import { getDeviceId } from "@/lib/device";
import { formatPrice } from "@/lib/format";
import { compressPhoto, PhotoDecodeError } from "@/lib/image";
import { parsePriceInput, priceInRange, PRICE_MAX, PRICE_MIN, type PhotoDraft, type SaveResult } from "@/lib/snap";
import type { OutletResponse } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Button, buttonClasses } from "./Button";

export type BoughtTarget = {
  outlet: { id: string; name: string };
  /** Null: the student picks the item from what this outlet sells. */
  item: { id: string; name: string; size: string } | null;
  /** The official price on screen, to prefill and to compare with. */
  price: number | null;
};

type Props = {
  target: BoughtTarget | null;
  onClose: () => void;
  /** After a save, so the page can reload its prices. */
  onSaved?: () => void;
};

/** Within this of the shown price, a report confirms it (same band as the server, src/lib/prices.ts). */
const CONFIRM_BAND = 0.1;

/** "Are you sure?" when the new price is this far from the shown one: catches $70 typed for $7.00. */
function farOff(price: number, shown: number | null): boolean {
  if (shown === null) return false;
  return Math.abs(price - shown) > Math.max(1, shown * 0.5);
}

type Receipt =
  | { state: "none" }
  | { state: "reading" }
  | { state: "read"; price: number }
  | { state: "failed"; message: string };

const FIELD =
  "min-h-12 rounded-tag border-2 border-ink bg-card px-3 font-sans text-ink focus-visible:outline-focus";

/**
 * "I bought it" (SPEC Step 8): what did you pay? Prefilled with the shown price, so confirming takes one tap.
 * A receipt photo is optional (read by Gemini through /api/read-photo, never stored). Nothing is forced:
 * "Not now" closes it.
 *
 * Safeguards: $0.25 to $25 only (here and on the server), an "Are you sure?" when the price is far from the
 * one shown, and one student can never change a price on their own: a different price waits for a second
 * student (section 6). A price within $0.10 of the shown one confirms it and refreshes "Confirmed … ago".
 */
export function BoughtSheet({ target, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  // Open as a modal whenever there's a target.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (target && !d.open) d.showModal();
    else if (!target && d.open) d.close();
  }, [target]);

  function close() {
    clearIntent();
    onClose();
  }

  return (
    <dialog
      ref={dialog}
      aria-label="I bought it"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="m-0 mt-auto w-full max-w-xl self-end rounded-t-tag border-2 border-b-0 border-ink bg-paper p-0 text-ink shadow-ink backdrop:bg-ink/40 sm:mx-auto"
    >
      {target ? (
        <SheetBody
          key={`${target.outlet.id}:${target.item?.id ?? ""}:${target.price ?? ""}`}
          target={target}
          close={close}
          onSaved={onSaved}
        />
      ) : null}
    </dialog>
  );
}

/** The form, keyed by target so every new trip starts fresh. */
function SheetBody({ target, close, onSaved }: { target: BoughtTarget; close: () => void; onSaved?: () => void }) {
  const ids = useId();
  const [itemId, setItemId] = useState("");
  const [priceText, setPriceText] = useState(target.price !== null ? target.price.toFixed(2) : "");
  const [receipt, setReceipt] = useState<Receipt>({ state: "none" });
  const [check, setCheck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Only when the item isn't known yet: what this outlet sells, with its prices.
  const outletApi = useApi<OutletResponse>(
    !target.item ? `/api/outlet/${encodeURIComponent(target.outlet.id)}` : null,
  );
  const choices = (outletApi.data?.items ?? []).filter((r) => r.price !== null);
  const picked = target.item ? null : choices.find((r) => r.item.id === itemId) ?? null;
  const shown = target.item ? target.price : picked?.price ?? null;
  const item = target.item ?? (picked ? { id: picked.item.id, name: picked.item.name, size: picked.item.size } : null);

  function pickItem(id: string) {
    setItemId(id);
    const row = choices.find((r) => r.item.id === id);
    if (row?.price != null && receipt.state !== "read") setPriceText(row.price.toFixed(2));
    setCheck(false);
  }

  async function onReceipt(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReceipt({ state: "reading" });
    setError(null);
    try {
      const photo = await compressPhoto(file);
      const res = await fetch("/api/read-photo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: photo.base64, hint: "receipt", device_id: getDeviceId() }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Couldn't read the receipt. Type the price instead.";
        setReceipt({ state: "failed", message: msg });
        return;
      }
      const draft = body as PhotoDraft;
      const priced = draft.items.filter((it) => it.price !== null);
      const match = (item ? priced.find((it) => it.item_id === item.id) : null) ?? (item ? null : priced[0]);
      if (!match || match.price === null) {
        setReceipt({ state: "failed", message: "Couldn't find this item's price on the receipt. Type it instead." });
        return;
      }
      if (!item) setItemId(match.item_id);
      setPriceText(match.price.toFixed(2));
      setReceipt({ state: "read", price: match.price });
      setCheck(false);
    } catch (err) {
      setReceipt({
        state: "failed",
        message:
          err instanceof PhotoDecodeError
            ? "That photo couldn't be opened. Try another, or type the price."
            : "Couldn't read the receipt. Check your connection, or type the price.",
      });
    }
  }

  async function save() {
    if (!item) {
      setError("Pick what you bought.");
      return;
    }
    const price = parsePriceInput(priceText);
    if (price === null || !priceInRange(price)) {
      setError(`Type the price you paid, between $${PRICE_MIN.toFixed(2)} and $${PRICE_MAX}.`);
      return;
    }
    if (farOff(price, shown) && !check) {
      setCheck(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fromReceipt = receipt.state === "read" && Math.round(receipt.price * 100) === Math.round(price * 100);
      const res = await fetch("/api/save-price", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_id: item.id,
          location_id: target.outlet.id,
          price,
          source: fromReceipt ? "receipt" : "typed",
          device_id: getDeviceId(),
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Couldn't save. Try again in a moment.",
        );
        return;
      }
      const result = body as SaveResult;
      const confirms = shown !== null && Math.abs(price - shown) <= CONFIRM_BAND + 1e-9;
      setDone(
        confirms || result.status === "official"
          ? `Thanks! ${item.name} at ${target.outlet.name} is confirmed at ${formatPrice(price)}, just now.`
          : `Thanks! Your ${formatPrice(price)} report is waiting for a second student before it changes the price.`,
      );
      clearIntent();
      onSaved?.();
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const price = parsePriceInput(priceText);

  return (
    <div className="max-h-[85dvh] overflow-y-auto px-4 pt-4 pb-[max(env(safe-area-inset-bottom),16px)]">
          <h2 id={`${ids}-h`} className="font-heading text-2xl font-extrabold leading-tight">
            {done ? "Thank you" : item ? `Did you buy ${item.name}?` : `Did you buy something at ${target.outlet.name}?`}
          </h2>

          {done ? (
            <>
              <p role="status" className="mt-2 font-bold">
                {done}
              </p>
              <Button variant="primary" className="mt-4 w-full" onClick={close}>
                Done
              </Button>
            </>
          ) : (
            <>
              <p className="mt-1">
                Tell us what you paid at <span className="font-bold">{target.outlet.name}</span>. It shows everyone
                when this price was last confirmed. Totally optional.
              </p>

              {!target.item ? (
                <label className="mt-3 flex flex-col gap-1 font-bold">
                  What did you buy?
                  <select className={FIELD} value={itemId} onChange={(e) => pickItem(e.target.value)}>
                    <option value="">{outletApi.loading ? "Loading…" : "Pick an item"}</option>
                    {choices.map((r) => (
                      <option key={r.item.id} value={r.item.id}>
                        {r.item.name}, {r.item.size}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="mt-2 text-ink-2">{target.item.size}</p>
              )}

              <label className="mt-3 flex flex-col gap-1 font-bold">
                What did you pay?
                <span className="flex items-center gap-2">
                  <span className="font-mono text-2xl" aria-hidden="true">
                    $
                  </span>
                  <input
                    className={`${FIELD} w-36 font-mono text-2xl`}
                    inputMode="decimal"
                    value={priceText}
                    onChange={(e) => {
                      setPriceText(e.target.value);
                      setCheck(false);
                    }}
                    aria-describedby={`${ids}-shown`}
                  />
                </span>
              </label>
              <p id={`${ids}-shown`} className="mt-1 text-ink-2">
                {shown !== null ? `The app shows ${formatPrice(shown)}. If that's what you paid, just tap Save.` : ""}
              </p>

              <div className="mt-3">
                <label
                  className={buttonClasses(
                    "secondary",
                    "md",
                    "w-full cursor-pointer focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focus",
                  )}
                >
                  <span aria-hidden="true">🧾</span>{" "}
                  {receipt.state === "reading" ? "Reading your receipt…" : "Add a receipt photo (optional)"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={onReceipt}
                    disabled={receipt.state === "reading"}
                  />
                </label>
                <p aria-live="polite" className="mt-1">
                  {receipt.state === "read" ? (
                    <span className="font-bold">Read {formatPrice(receipt.price)} from your receipt.</span>
                  ) : receipt.state === "failed" ? (
                    receipt.message
                  ) : (
                    <span className="text-sm text-ink-2">
                      Photos go to Google Gemini to read the price and aren&apos;t stored. Cover any card details.
                    </span>
                  )}
                </p>
              </div>

              {check && price !== null ? (
                <p role="alert" className="mt-3 rounded-tag border-2 border-ink bg-card p-2 font-bold">
                  {formatPrice(price)} is a lot different from {shown !== null ? formatPrice(shown) : "the usual price"}.
                  Is it right? Tap Save again to send it, or fix it above.
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="mt-3 font-bold text-pricey">
                  {error}
                </p>
              ) : null}

              <div className="mt-4 flex flex-col gap-2">
                <Button variant="primary" size="lg" onClick={save} disabled={saving || receipt.state === "reading"}>
                  {saving ? "Saving…" : check ? "Yes, save it" : "Save"}
                </Button>
                <Button onClick={close}>Not now</Button>
              </div>
            </>
          )}
    </div>
  );
}
