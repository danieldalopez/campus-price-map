"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { getDeviceId } from "@/lib/device";
import { formatPrice } from "@/lib/format";
import { compressPhoto, PhotoDecodeError } from "@/lib/image";
import { useCamera, videoHasFrame } from "@/lib/use-camera";
import { play } from "@/lib/sounds";
import {
  parsePriceInput,
  priceInRange,
  PRICE_MAX,
  PRICE_MIN,
  type PhotoDraft,
  type PriceStatus,
  type SaveResult,
  type SnapItem,
  type SnapOutlet,
} from "@/lib/snap";
import { Button, buttonClasses } from "./Button";

// Snap a price (SPEC section 7): live camera → shutter → compress → Gemini reads it → one confirm card per item →
// nothing is saved until the student taps Looks right (G1) → "Your report: $3.25 · waiting for a second student".
// No camera, or no permission: the file input ("Upload a photo instead") takes over as the way in.

type Phase = "start" | "reading" | "confirm" | "pick";

type Loc =
  | { status: "idle" | "finding" | "off" }
  | { status: "on"; lat: number; lng: number };

type Card = {
  key: string;
  itemId: string;
  priceText: string;
  /** The price Gemini read, if any. Saved as source "photo" only while the student keeps it. */
  readPrice: number | null;
  /** The card came from a photo reading (not from picking a tile). */
  fromPhoto: boolean;
  sizeText: string | null;
  outletId: string;
  state: "editing" | "saving" | "saved";
  /** True once a save has taken over 3 s (Lakebase waking up). */
  slow: boolean;
  error: string | null;
  saved: { price: number; status: PriceStatus } | null;
};

const COULDNT_READ = "Couldn't read a price. Pick your item";
const COULDNT_READ_IT = "Couldn't read it, pick your item";
const PRIVACY = "Photos are sent to Google Gemini to read the price. Cover any card details on receipts.";

// ---------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------

/** Placeholder sticker art until public/items lands (Step 10). Decorative: name and size are always text. */
const ART_BY_WORD: [RegExp, string][] = [
  [/sparkling/i, "🫧"],
  [/\btea\b/i, "🍵"],
  [/iced|cold brew/i, "🧊"],
  [/bagel/i, "🥯"],
  [/muffin/i, "🧁"],
  [/wrap/i, "🌯"],
  [/sushi/i, "🍣"],
  [/chips/i, "🥔"],
  [/banana/i, "🍌"],
  [/apple/i, "🍎"],
];
const ART_BY_CATEGORY: Record<string, string> = {
  "Energy drinks": "⚡",
  "Soft drinks": "🥤",
  Water: "💧",
  "Hot drinks": "☕",
  "Cold coffee": "🧊",
  "Breakfast and bakery": "🥐",
  "Lunch grab and go": "🥪",
  Snacks: "🍫",
  Fruit: "🍎",
};
function artFor(item: SnapItem | undefined): string {
  if (!item) return "🏷️";
  return ART_BY_WORD.find(([re]) => re.test(item.name))?.[1] ?? ART_BY_CATEGORY[item.category] ?? "🏷️";
}

const itemLabel = (item: SnapItem) => `${item.name}, ${item.size}`;

/** Haversine metres. */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** SPEC section 7: haversine metres x 1.3 / 80 m per min, rounded up. */
const walkMinutes = (m: number) => Math.max(1, Math.ceil((m * 1.3) / 80));

/** Location stays on the phone (G15); rounded to about 11 m anyway. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** A receipt's store name, matched to exactly one outlet, or null. */
function outletFromHint(hint: string | null, outlets: readonly SnapOutlet[]): string | null {
  const h = hint ? norm(hint) : "";
  if (h.length < 4) return null;
  const hits = outlets.filter((o) => {
    const n = norm(o.name);
    return n.includes(h) || h.includes(n);
  });
  return hits.length === 1 ? hits[0].id : null;
}

function isDraft(data: unknown): data is PhotoDraft {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Partial<PhotoDraft>;
  return Array.isArray(d.items) && Array.isArray(d.unmatched);
}

function errorText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const e = (data as { error?: unknown }).error;
  return typeof e === "string" && e !== "" ? e : null;
}

function isSaveResult(data: unknown): data is SaveResult {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Partial<SaveResult>;
  return typeof d.id === "number" && (d.status === "pending" || d.status === "official" || d.status === "rejected");
}

/** ["Your report: $3.25", "waiting for a second student"], or confirmed if it matched another student's report. */
function savedParts(price: number, status: PriceStatus): [string, string] {
  const rest = status === "official" ? "confirmed, it matches another student's report" : "waiting for a second student";
  return [`Your report: ${formatPrice(price)}`, rest];
}
const savedLine = (price: number, status: PriceStatus) => savedParts(price, status).join(" · ");

// ---------------------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------------------

const HEADING = "font-heading text-2xl font-extrabold leading-tight focus:outline-none";
const CARD = "relative rounded-tag border-2 border-ink bg-card p-4 shadow-ink";
// No text size here: the selects add text-base, the price input its own big size.
const FIELD =
  "min-h-12 w-full rounded-tag border-2 border-ink bg-card px-3 text-ink " +
  "aria-[invalid=true]:border-pricey aria-[invalid=true]:border-[3px]";

function Header() {
  return (
    <header className="flex items-center gap-3">
      <Link href="/" className={buttonClasses("secondary", "md", "shrink-0")}>
        <span aria-hidden="true">←</span> Map
      </Link>
      <h1 className="-rotate-1 rounded-tag border-2 border-ink bg-tag px-3 py-1.5 font-heading text-xl font-extrabold leading-none shadow-ink">
        Snap a price
      </h1>
    </header>
  );
}

/** Shown while the item and outlet lists load, or when the database can't be reached. */
export function SnapShell({ error }: { error?: string }) {
  return (
    <main className="mx-auto min-h-dvh max-w-md bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-10">
      <Header />
      {error ? (
        <div role="alert" className={`${CARD} mt-6`}>
          <p className="font-bold">{error}</p>
          <Link href="/snap" className={buttonClasses("primary", "md", "mt-3")}>
            Try again
          </Link>
        </div>
      ) : (
        <p role="status" className="mt-6 text-ink-2">
          Getting the camera ready…
        </p>
      )}
    </main>
  );
}

type CameraButtonProps = {
  onPhoto: (e: ChangeEvent<HTMLInputElement>) => void;
  label: string;
  variant: "primary" | "secondary";
  /** Hint phones to open the camera app (true) or let the student pick a saved photo (false). */
  capture?: boolean;
};

/** A photo from a file: a real file input inside a big label, so it works with a keyboard and a screen reader. */
function CameraButton({ onPhoto, label, variant, capture = true }: CameraButtonProps) {
  return (
    <label
      className={buttonClasses(
        variant,
        variant === "primary" ? "lg" : "md",
        "w-full cursor-pointer focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focus",
      )}
    >
      <span aria-hidden="true">{capture ? "📷" : "🖼️"}</span> {label}
      <input
        type="file"
        accept="image/*"
        capture={capture ? "environment" : undefined}
        className="sr-only"
        onChange={onPhoto}
      />
    </label>
  );
}

/** The live back camera with a big shutter button. The picture is decorative; the button says what it does. */
function LiveViewfinder({
  videoRef,
  ready,
  slow,
  onShutter,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  ready: boolean;
  /** Still waiting after a few seconds (usually the permission question). */
  slow: boolean;
  onShutter: () => void;
}) {
  return (
    <div className="mt-4">
      <div className="relative aspect-[3/4] max-h-[50dvh] w-full overflow-hidden rounded-tag border-2 border-ink bg-ink shadow-ink">
        <video
          ref={videoRef}
          aria-hidden="true"
          playsInline
          muted
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
        />
        {ready ? null : (
          <p className="absolute inset-0 grid place-items-center px-4 text-center font-bold text-card">
            {slow
              ? "Waiting for the camera. Allow camera access if your browser asks, or upload a photo instead."
              : "Starting the camera…"}
          </p>
        )}
      </div>
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={onShutter}
          disabled={!ready}
          className="group flex min-h-12 flex-col items-center gap-1 rounded-tag px-3 font-heading text-lg font-extrabold disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span
            aria-hidden="true"
            className="grid h-20 w-20 place-items-center rounded-full border-[3px] border-ink bg-tag shadow-ink transition-transform group-active:translate-x-[2px] group-active:translate-y-[2px] group-active:shadow-ink-sm"
          >
            <span className="h-14 w-14 rounded-full border-2 border-ink bg-card" />
          </span>
          Take the photo
        </button>
      </div>
    </div>
  );
}

function PhotoPreview({ src, small = false }: { src: string; small?: boolean }) {
  return (
    // A data URL of the student's own photo: next/image adds nothing here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Your photo"
      className={`rounded-tag border-2 border-ink bg-card object-cover shadow-ink ${small ? "h-20 w-20" : "h-40 w-40"}`}
    />
  );
}

function Unmatched({ draft }: { draft: PhotoDraft | null }) {
  if (!draft || draft.unmatched.length === 0) return null;
  return (
    <div className="mt-4 rounded-tag border-2 border-dashed border-ink bg-paper-2 p-3">
      <p className="font-bold">Also on your photo, not tracked yet:</p>
      <ul className="mt-1 list-disc pl-5">
        {draft.unmatched.map((u, i) => (
          <li key={`${u.text}-${i}`}>
            {u.text}
            {u.price !== null ? <span className="font-mono"> {formatPrice(u.price)}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Sticker shuffle" while Gemini reads. Decorative; the words carry the state. */
function StickerShuffle() {
  const stickers = ["⚡", "☕", "🥪"];
  return (
    <div aria-hidden="true" className="flex items-end justify-center gap-3 py-4">
      {stickers.map((s, i) => (
        <span
          key={s}
          className="grid h-16 w-16 animate-bounce place-items-center rounded-tag border-2 border-ink bg-card text-3xl shadow-ink motion-reduce:animate-none"
          style={{ animationDelay: `${i * 160}ms`, rotate: `${(i - 1) * 6}deg` }}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function ItemTilesPicker({ items, onPick }: { items: SnapItem[]; onPick: (id: string) => void }) {
  return (
    <ul className="mt-4 grid grid-cols-3 gap-3">
      {items.map((item) => (
        <li key={item.id} className="min-w-0">
          <button
            type="button"
            onClick={() => onPick(item.id)}
            className="flex h-full min-h-28 w-full flex-col items-center justify-start gap-0.5 rounded-tag border-2 border-ink bg-card px-1.5 pt-2 pb-2 text-center shadow-ink active:translate-x-[2px] active:translate-y-[2px] active:shadow-ink-sm"
          >
            <span aria-hidden="true" className="text-[1.75rem] leading-none">
              {artFor(item)}
            </span>
            <span className="font-bold leading-tight">{item.name}</span>
            <span className="text-sm leading-tight text-ink-2">{item.size}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type CardProps = {
  card: Card;
  index: number;
  total: number;
  items: SnapItem[];
  itemById: ReadonlyMap<string, SnapItem>;
  outlets: SnapOutlet[];
  nearest: { outlet: SnapOutlet; minutes: number }[];
  loc: Loc;
  onChange: (patch: Partial<Card>) => void;
  onOutlet: (outletId: string) => void;
  onSave: (price: number) => void;
  onRemove: () => void;
};

function ConfirmCard({ card, index, total, items, itemById, outlets, nearest, loc, onChange, onOutlet, onSave, onRemove }: CardProps) {
  const id = useId();
  const priceRef = useRef<HTMLInputElement>(null);
  const outletRef = useRef<HTMLSelectElement>(null);
  const savedRef = useRef<HTMLDivElement>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [outletError, setOutletError] = useState<string | null>(null);
  const item = itemById.get(card.itemId);
  const askPrice = card.fromPhoto && card.readPrice === null;

  // Land on the saved message once it appears.
  useEffect(() => {
    if (card.state === "saved") savedRef.current?.focus();
  }, [card.state]);

  const categories = useMemo(() => {
    const groups = new Map<string, SnapItem[]>();
    for (const i of items) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);
    return [...groups.entries()];
  }, [items]);

  if (card.state === "saved" && card.saved && item) {
    const official = card.saved.status === "official";
    const [lead, rest] = savedParts(card.saved.price, card.saved.status);
    return (
      <div ref={savedRef} tabIndex={-1} className={`${CARD} focus:outline-none`}>
        <p className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-block -rotate-2 rounded-tag border-2 px-2 py-0.5 font-heading text-sm font-extrabold tracking-wider ${
              official ? "border-cheap text-cheap" : "border-pending text-pending"
            }`}
          >
            {official ? "CONFIRMED" : "PENDING"}
          </span>
          <span className="font-bold">{itemLabel(item)}</span>
        </p>
        <p className="mt-2 text-lg">
          <strong>{lead}</strong>
          {" · "}
          {rest}
        </p>
        <p className="mt-1 text-ink-2">Thanks, that helps everyone who buys this.</p>
        <Link href={`/item/${item.id}`} prefetch={false} className={buttonClasses("secondary", "md", "mt-3")}>
          See {item.name} prices
        </Link>
      </div>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const price = parsePriceInput(card.priceText);
    const pErr =
      price === null
        ? "Type the price, like 3.25."
        : priceInRange(price)
          ? null
          : `Prices are between ${formatPrice(PRICE_MIN)} and ${formatPrice(PRICE_MAX)}.`;
    const oErr = card.outletId ? null : "Pick the outlet you're at.";
    setPriceError(pErr);
    setOutletError(oErr);
    if (pErr) {
      priceRef.current?.focus();
    } else if (oErr) {
      outletRef.current?.focus();
    } else if (price !== null) {
      onSave(price);
    }
  }

  const saving = card.state === "saving";
  const describedPrice = [priceError ? `${id}-price-err` : null, card.sizeText ? `${id}-size` : null].filter(Boolean).join(" ");

  return (
    <form noValidate onSubmit={submit} className={CARD} aria-labelledby={`${id}-title`}>
      <span aria-hidden="true" className="absolute -top-2 left-6 h-4 w-14 -rotate-3 bg-[var(--tape)]" />
      <h3 id={`${id}-title`} className="flex items-center gap-2 font-heading text-lg font-extrabold">
        <span aria-hidden="true" className="text-2xl">
          {artFor(item)}
        </span>
        {total > 1 ? `Item ${index + 1} of ${total}` : "Your report"}
      </h3>

      <label htmlFor={`${id}-item`} className="mt-3 block font-bold">
        Item
      </label>
      <select
        id={`${id}-item`}
        className={`${FIELD} text-base`}
        value={card.itemId}
        disabled={saving}
        onChange={(e) => onChange({ itemId: e.target.value, error: null })}
      >
        {categories.map(([category, group]) => (
          <optgroup key={category} label={category}>
            {group.map((i) => (
              <option key={i.id} value={i.id}>
                {itemLabel(i)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <label htmlFor={`${id}-price`} className="mt-4 block font-bold">
        {askPrice ? "What's the price here?" : "Price"}
      </label>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="font-mono text-4xl font-bold">
          $
        </span>
        <input
          ref={priceRef}
          id={`${id}-price`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="0.00"
          className={`${FIELD} h-16 font-mono text-4xl font-bold tabular-nums`}
          value={card.priceText}
          disabled={saving}
          aria-invalid={priceError ? true : undefined}
          aria-describedby={describedPrice || undefined}
          onChange={(e) => {
            onChange({ priceText: e.target.value, error: null });
            if (priceError) setPriceError(null);
          }}
        />
      </div>
      {card.sizeText ? (
        <p id={`${id}-size`} className="mt-1 text-ink-2">
          The label says: {card.sizeText}
        </p>
      ) : null}
      {priceError ? (
        <p id={`${id}-price-err`} className="mt-1 font-bold text-pricey">
          <span aria-hidden="true">⚠ </span>
          {priceError}
        </p>
      ) : null}
      {askPrice && item ? (
        <Link href={`/item/${item.id}`} prefetch={false} className="mt-2 inline-flex min-h-12 items-center font-bold underline">
          Skip, just show me prices
        </Link>
      ) : null}

      <fieldset className="mt-4">
        <legend className="font-bold">Where are you?</legend>
        {nearest.length > 0 ? (
          <div role="group" aria-label="Nearest outlets" className="mt-1 flex flex-col gap-2">
            {nearest.map(({ outlet, minutes }) => (
              <Button
                key={outlet.id}
                aria-pressed={card.outletId === outlet.id}
                disabled={saving}
                className="w-full"
                onClick={() => {
                  onOutlet(outlet.id);
                  setOutletError(null);
                }}
              >
                {/* The tick, not just the inverted colours, shows which one is picked. */}
                {card.outletId === outlet.id ? <span aria-hidden="true">✓</span> : null}
                <span>{outlet.name}</span>
                <span className="shrink-0 font-sans text-sm font-bold">about {minutes} min walk</span>
              </Button>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-ink-2">
            {loc.status === "finding"
              ? "Finding the outlets near you…"
              : "Turn on location to see the 3 nearest outlets first, or pick yours from the list."}
          </p>
        )}
        <label htmlFor={`${id}-outlet`} className="mt-3 block font-bold">
          {nearest.length > 0 ? "Or pick from all outlets" : "Outlet"}
        </label>
        <select
          ref={outletRef}
          id={`${id}-outlet`}
          className={`${FIELD} text-base`}
          value={card.outletId}
          disabled={saving}
          aria-invalid={outletError ? true : undefined}
          aria-describedby={outletError ? `${id}-outlet-err` : undefined}
          onChange={(e) => {
            onOutlet(e.target.value);
            setOutletError(null);
          }}
        >
          <option value="">Choose an outlet</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.area ? `${o.name} · ${o.area}` : o.name}
            </option>
          ))}
        </select>
        {outletError ? (
          <p id={`${id}-outlet-err`} className="mt-1 font-bold text-pricey">
            <span aria-hidden="true">⚠ </span>
            {outletError}
          </p>
        ) : null}
      </fieldset>

      {card.error ? (
        <p role="alert" className="mt-3 font-bold text-pricey">
          <span aria-hidden="true">⚠ </span>
          {card.error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" className="mt-4 w-full" disabled={saving}>
        {saving ? "Saving…" : "Looks right"}
      </Button>
      {saving && card.slow ? (
        <p className="mt-2 text-center text-ink-2">Waking up prices…</p>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        disabled={saving}
        className="mt-2 min-h-12 w-full font-bold underline disabled:opacity-60"
      >
        Don&apos;t save this one
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------------------------------------

export default function SnapFlow({ items, outlets }: { items: SnapItem[]; outlets: SnapOutlet[] }) {
  const [phase, setPhase] = useState<Phase>("start");
  const [preview, setPreview] = useState<string | null>(null);
  const [draft, setDraft] = useState<PhotoDraft | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [pickReason, setPickReason] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [loc, setLoc] = useState<Loc>({ status: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstPhase = useRef(true);
  const readAbort = useRef<AbortController | null>(null);
  const keySeq = useRef(0);
  const shooting = useRef(false);
  // The live camera runs only on the start screen: it stops after the shutter and when the student leaves.
  const { videoRef, status: cameraStatus, problem: cameraIssue, slow: cameraSlow } = useCamera(phase === "start");

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const nearest = useMemo(() => {
    if (loc.status !== "on") return [];
    return outlets
      .map((outlet) => ({ outlet, metres: metresBetween(loc.lat, loc.lng, outlet.lat, outlet.lng) }))
      .sort((a, b) => a.metres - b.metres)
      .slice(0, 3)
      .map(({ outlet, metres }) => ({ outlet, minutes: walkMinutes(metres) }));
  }, [loc, outlets]);

  // Each new screen moves focus to its heading, so keyboard and screen reader users start there.
  useEffect(() => {
    if (firstPhase.current) {
      firstPhase.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [phase]);

  /** Location only after a tap (G15), only on the phone: it sorts the outlet picker and is never sent. */
  function locate() {
    if (loc.status !== "idle") return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLoc({ status: "off" });
      return;
    }
    setLoc({ status: "finding" });
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc({ status: "on", lat: round4(p.coords.latitude), lng: round4(p.coords.longitude) }),
      () => setLoc({ status: "off" }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }

  function newCard(init: Pick<Card, "itemId" | "readPrice" | "fromPhoto" | "sizeText" | "outletId">): Card {
    keySeq.current += 1;
    return {
      key: `card-${keySeq.current}`,
      priceText: init.readPrice !== null ? init.readPrice.toFixed(2) : "",
      state: "editing",
      slow: false,
      error: null,
      saved: null,
      ...init,
    };
  }

  function updateCard(key: string, patch: Partial<Card>) {
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  /** Picking an outlet on one card fills it in on the other unsaved cards that have none yet. */
  function setOutlet(key: string, outletId: string) {
    setCards((prev) =>
      prev.map((c) =>
        c.key === key ? { ...c, outletId, error: null } : c.state === "editing" && !c.outletId ? { ...c, outletId } : c,
      ),
    );
  }

  function toPick(reason: string) {
    setPickReason(reason);
    setPhase("pick");
    setAnnouncement(reason);
  }

  function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so the same photo can be picked again
    if (file) void readPhoto(file);
  }

  /** The shutter: the current camera frame onto a canvas, then the same path as a picked photo. */
  async function shoot() {
    play("snap");
    const video = videoRef.current;
    if (shooting.current || !videoHasFrame(video)) return;
    shooting.current = true;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        toPick(COULDNT_READ);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // The frame is ours now: leave the start screen, which turns the camera off.
      setPhase("reading");
      setAnnouncement("Reading the price…");
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) {
        toPick(COULDNT_READ);
        return;
      }
      await readPhoto(blob);
    } finally {
      shooting.current = false;
    }
  }

  async function readPhoto(file: Blob) {
    locate();
    readAbort.current?.abort();
    setDraft(null);
    setCards([]);
    setPreview(null);
    setPhase("reading");
    setAnnouncement("Reading the price…");

    let photo;
    try {
      photo = await compressPhoto(file);
    } catch (err) {
      toPick(err instanceof PhotoDecodeError ? `${err.message} ${COULDNT_READ}` : COULDNT_READ);
      return;
    }
    setPreview(photo.dataUrl);

    const controller = new AbortController();
    readAbort.current = controller;
    try {
      const res = await fetch("/api/read-photo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: photo.base64, device_id: getDeviceId() }),
        signal: controller.signal,
      });
      const data: unknown = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!res.ok) {
        toPick(errorText(data) ?? COULDNT_READ_IT);
        return;
      }
      if (!isDraft(data) || data.items.length === 0) {
        if (isDraft(data)) setDraft(data);
        toPick(COULDNT_READ);
        return;
      }
      const outletId = outletFromHint(data.outlet_hint, outlets) ?? "";
      const next = data.items.slice(0, 6).map((it) =>
        newCard({ itemId: it.item_id, readPrice: it.price, fromPhoto: true, sizeText: it.size_text, outletId }),
      );
      setDraft(data);
      setCards(next);
      setPhase("confirm");
      const first = itemById.get(next[0].itemId);
      setAnnouncement(
        next.length === 1 && next[0].readPrice === null && first
          ? `Found ${itemLabel(first)}. What's the price here?`
          : `Found ${next.length} ${next.length === 1 ? "item" : "items"}. Check ${next.length === 1 ? "it" : "each one"} and tap Looks right.`,
      );
    } catch {
      if (!controller.signal.aborted) toPick(COULDNT_READ_IT);
    } finally {
      if (readAbort.current === controller) readAbort.current = null;
    }
  }

  function cancelReading() {
    readAbort.current?.abort();
    readAbort.current = null;
    toPick("Pick your item");
  }

  function pickItem(itemId: string) {
    locate();
    const lastOutlet = [...cards].reverse().find((c) => c.outletId)?.outletId ?? "";
    setCards((prev) => [
      ...prev,
      newCard({ itemId, readPrice: null, fromPhoto: false, sizeText: null, outletId: lastOutlet }),
    ]);
    setPhase("confirm");
    const item = itemById.get(itemId);
    setAnnouncement(`${item ? itemLabel(item) : "Item"}. Type the price and pick your outlet, then tap Looks right.`);
  }

  function removeCard(key: string) {
    const left = cards.filter((c) => c.key !== key);
    setCards(left);
    if (left.length === 0) toPick("Pick your item");
  }

  async function save(card: Card, price: number) {
    // "photo" only while the price is the one Gemini read; a price the student typed or fixed is "typed".
    const source = card.fromPhoto && card.readPrice !== null && price === card.readPrice ? "photo" : "typed";
    updateCard(card.key, { state: "saving", slow: false, error: null, priceText: price.toFixed(2) });
    const slowTimer = setTimeout(() => updateCard(card.key, { slow: true }), 3000);
    try {
      const res = await fetch("/api/save-price", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_id: card.itemId,
          location_id: card.outletId,
          price,
          source,
          device_id: getDeviceId(),
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok || !isSaveResult(data)) {
        updateCard(card.key, { state: "editing", slow: false, error: errorText(data) ?? "Couldn't save. Try again in a moment." });
        return;
      }
      play(data.status === "official" ? "chime" : "slap");
      updateCard(card.key, { state: "saved", slow: false, saved: { price, status: data.status } });
      setAnnouncement(`Saved. ${savedLine(price, data.status)}.`);
    } catch {
      updateCard(card.key, { state: "editing", slow: false, error: "Couldn't save. Check your connection and try again." });
    } finally {
      clearTimeout(slowTimer);
    }
  }

  function startOver() {
    readAbort.current?.abort();
    setCards([]);
    setDraft(null);
    setPreview(null);
    setPhase("start");
    setAnnouncement("");
  }

  const editing = cards.filter((c) => c.state !== "saved").length;
  const singleAsk = cards.length === 1 && cards[0].fromPhoto && cards[0].readPrice === null;
  let body: ReactNode;

  if (phase === "start") {
    body = (
      <section aria-labelledby="snap-start" className="mt-6">
        <h2 id="snap-start" ref={headingRef} tabIndex={-1} className={HEADING}>
          Take a photo of the price
        </h2>
        <p className="mt-2">A price tag, a menu board or a receipt. We read it, you check it, then it&apos;s saved.</p>
        {/* Why there's no live camera, announced when it turns out that way. */}
        <div role="status" aria-live="polite">
          {cameraIssue ? (
            <p className="mt-4 rounded-tag border-2 border-ink bg-card px-3 py-2 leading-snug shadow-ink">
              <span aria-hidden="true">⚠ </span>
              {cameraIssue} Use your phone&apos;s camera app or a saved photo instead.
            </p>
          ) : null}
        </div>
        {cameraIssue ? (
          <div className="mt-4">
            <CameraButton onPhoto={onPhoto} label="Take or upload a photo" variant="primary" />
          </div>
        ) : (
          <>
            <LiveViewfinder
              videoRef={videoRef}
              ready={cameraStatus === "on"}
              slow={cameraSlow}
              onShutter={() => void shoot()}
            />
            <div className="mt-4">
              <CameraButton onPhoto={onPhoto} label="Upload a photo instead" variant="secondary" capture={false} />
            </div>
          </>
        )}
        <p className="mt-3 rounded-tag border-2 border-dashed border-ink bg-paper-2 px-3 py-2 leading-snug">{PRIVACY}</p>
        {cards.length > 0 ? (
          <Button className="mt-5 w-full" onClick={() => setPhase("confirm")}>
            Back to your report
          </Button>
        ) : null}
        <Button className="mt-5 w-full" onClick={() => toPick("Pick your item")}>
          No photo? Pick your item
        </Button>
      </section>
    );
  } else if (phase === "reading") {
    body = (
      <section aria-labelledby="snap-reading" className="mt-6 flex flex-col items-center text-center">
        <h2 id="snap-reading" ref={headingRef} tabIndex={-1} className={HEADING}>
          Reading the price…
        </h2>
        <StickerShuffle />
        {preview ? <PhotoPreview src={preview} /> : null}
        <p className="mt-4 text-ink-2">{PRIVACY}</p>
        <Button className="mt-4 w-full" onClick={cancelReading}>
          Cancel, I&apos;ll pick my item
        </Button>
      </section>
    );
  } else if (phase === "pick") {
    body = (
      <section aria-labelledby="snap-pick" className="mt-6">
        <h2 id="snap-pick" ref={headingRef} tabIndex={-1} className={HEADING}>
          {pickReason ?? "Pick your item"}
        </h2>
        {preview ? (
          <div className="mt-3 flex items-center gap-3">
            <PhotoPreview src={preview} small />
            <p className="text-ink-2">You can type the price yourself.</p>
          </div>
        ) : null}
        <Unmatched draft={draft} />
        <ItemTilesPicker items={items} onPick={pickItem} />
        <div className="mt-5 flex flex-col gap-3">
          {cards.length > 0 ? (
            <Button className="w-full" onClick={() => setPhase("confirm")}>
              Back to your report
            </Button>
          ) : null}
          <Button className="w-full" onClick={() => setPhase("start")}>
            <span aria-hidden="true">📷</span> Try another photo
          </Button>
        </div>
      </section>
    );
  } else {
    body = (
      <section aria-labelledby="snap-confirm" className="mt-6">
        <h2 id="snap-confirm" ref={headingRef} tabIndex={-1} className={HEADING}>
          {editing === 0 ? "Saved, thank you" : singleAsk ? "What's the price here?" : cards.some((c) => c.fromPhoto) ? "Check what we read" : "Check your report"}
        </h2>
        {editing > 0 ? (
          <p className="mt-1">Nothing is saved until you tap Looks right.</p>
        ) : null}
        {preview ? (
          <div className="mt-3">
            <PhotoPreview src={preview} small />
          </div>
        ) : null}
        <ul className="mt-4 flex flex-col gap-5">
          {cards.map((card, i) => (
            <li key={card.key}>
              <ConfirmCard
                card={card}
                index={i}
                total={cards.length}
                items={items}
                itemById={itemById}
                outlets={outlets}
                nearest={nearest}
                loc={loc}
                onChange={(patch) => updateCard(card.key, patch)}
                onOutlet={(outletId) => setOutlet(card.key, outletId)}
                onSave={(price) => void save(card, price)}
                onRemove={() => removeCard(card.key)}
              />
            </li>
          ))}
        </ul>
        <Unmatched draft={draft} />
        <div className="mt-6 flex flex-col gap-3">
          <Button variant={editing === 0 ? "primary" : "secondary"} className="w-full" onClick={() => setPhase("start")}>
            <span aria-hidden="true">📷</span> Snap another photo
          </Button>
          <Button className="w-full" onClick={() => toPick("Pick another item")}>
            Add an item by hand
          </Button>
          {editing === 0 ? (
            <Button className="w-full" onClick={startOver}>
              Start over
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),2.5rem)]">
      <Header />
      {/* Reading, found, saved: announced politely (SPEC section 11). Sounds come in Step 10. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {body}
    </main>
  );
}
