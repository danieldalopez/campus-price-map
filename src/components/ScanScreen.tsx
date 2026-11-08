"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { createBarcodeReader, type BarcodeReader } from "@/lib/barcode-detect";
import type { BarcodeResult } from "@/lib/gtin";
import { byPopularity } from "@/lib/item-art";
import type { ItemsResponse } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useCamera, videoHasFrame } from "@/lib/use-camera";
import { Button, buttonClasses } from "./Button";
import { ItemTiles } from "./ItemTiles";
import { WakingUp } from "./WakingUp";

// Scan a barcode (docs/SPEC.md section 7, Scan; Step 16). Full-screen back camera, a viewfinder box, a close
// button, a torch where the phone has one, and "No barcode? Pick your item". On a read: a short vibration,
// then /api/barcode. Matched → that item's Results. Known but not tracked, unknown, or no camera → the tiles.

type Phase =
  | { kind: "camera" }
  | { kind: "looking"; code: string }
  | { kind: "matched"; itemId: string; name: string | null }
  | {
      kind: "tiles";
      why: "picked" | "known" | "unknown" | "failed";
      name?: string;
      code?: string;
      /** A tracked brand without a readable size: only its sizes are offered. */
      candidates?: string[];
    };

/** "Which size?" answers, remembered on this phone only: barcode → item id. */
const SIZE_KEY = (code: string) => `cpm.barcode.${code}`;

function rememberedItem(code: string): string | null {
  try {
    const v = window.localStorage.getItem(SIZE_KEY(code));
    return v && /^I\d{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function rememberItem(code: string, itemId: string) {
  try {
    window.localStorage.setItem(SIZE_KEY(code), itemId);
  } catch {
    // Storage blocked: it'll just ask again next time.
  }
}

const WAITING = "Waiting for the camera. Allow camera access if your browser asks.";

export const OFF_CREDIT = "Product data from Open Food Facts, available under the Open Database License (ODbL).";

/** zxing reads are checked twice before we trust them; the native detector once. */
const CONFIRM_WINDOW_MS = 1_500;
const LOOKUP_TIMEOUT_MS = 8_000;

/** "Red Bull Zero" + "473 mL" → "Red Bull Zero 473 mL", without saying the size twice. */
function productLabel(result: BarcodeResult): string | null {
  const name = result.product_name?.trim();
  if (!name) return null;
  const qty = result.quantity?.trim();
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  return qty && !squash(name).includes(squash(qty)) ? `${name} ${qty}` : name;
}

/**
 * Draw the part of the video under the viewfinder box (plus a margin) onto `canvas`. The video is shown with
 * object-fit: cover, so screen pixels map to video pixels through one scale and a centring offset.
 */
function drawViewfinder(video: HTMLVideoElement, box: HTMLElement, canvas: HTMLCanvasElement): boolean {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const vr = video.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  if (!vw || !vh || !vr.width || !vr.height) return false;
  const scale = Math.max(vr.width / vw, vr.height / vh);
  const offX = (vr.width - vw * scale) / 2;
  const offY = (vr.height - vh * scale) / 2;
  const marginX = br.width * 0.15;
  const marginY = br.height * 0.25;
  const sx = Math.max(0, (br.left - marginX - vr.left - offX) / scale);
  const sy = Math.max(0, (br.top - marginY - vr.top - offY) / scale);
  const sw = Math.min(vw - sx, (br.width + 2 * marginX) / scale);
  const sh = Math.min(vh - sy, (br.height + 2 * marginY) / scale);
  if (sw <= 0 || sh <= 0) return false;
  // Plenty for a 1D code, and keeps zxing quick on older phones.
  const out = Math.min(1, 960 / sw);
  canvas.width = Math.max(1, Math.round(sw * out));
  canvas.height = Math.max(1, Math.round(sh * out));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return true;
}

function isBarcodeResult(data: unknown): data is BarcodeResult {
  if (typeof data !== "object" || data === null) return false;
  const s = (data as { status?: unknown }).status;
  return s === "matched" || s === "known" || s === "unknown";
}

const CHIP = "rounded-tag border-2 border-ink bg-card px-3 py-2 text-center font-bold leading-snug text-ink shadow-ink";

function BarcodeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
      <rect x="2" y="4" width="2" height="16" />
      <rect x="6" y="4" width="1" height="16" />
      <rect x="9" y="4" width="2" height="16" />
      <rect x="13" y="4" width="1" height="16" />
      <rect x="16" y="4" width="3" height="16" />
      <rect x="21" y="4" width="1" height="16" />
    </svg>
  );
}

export default function ScanScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "camera" });
  const cameraWanted = phase.kind === "camera" || phase.kind === "looking";
  const {
    videoRef,
    status: cameraStatus,
    problem: cameraIssue,
    slow: cameraSlow,
    torch,
    retry: retryCamera,
  } = useCamera(cameraWanted);
  const boxRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const readerRef = useRef<Promise<BarcodeReader> | null>(null);
  const lookupAbort = useRef<AbortController | null>(null);

  const itemsApi = useApi<ItemsResponse>("/api/items");
  const items = useMemo(() => byPopularity(itemsApi.data?.items ?? []), [itemsApi.data]);

  // No camera (denied, none, not https): straight to the tiles, with the reason.
  const cameraProblem = cameraWanted ? cameraIssue : null;
  const showCamera = cameraWanted && !cameraProblem;

  // Each new screen moves focus to its heading.
  const screenKey = showCamera ? "camera" : phase.kind === "tiles" ? `tiles-${phase.why}` : phase.kind;
  const firstScreen = useRef(true);
  useEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [screenKey]);

  /** Stop a lookup that's still running, without it then reporting "failed". */
  function cancelLookup() {
    lookupAbort.current?.abort();
    lookupAbort.current = null;
  }
  // ...including when the student leaves the page.
  useEffect(() => () => cancelLookup(), []);

  const lookUp = useEffectEvent(async (code: string) => {
    if ("vibrate" in navigator) navigator.vibrate(80);
    // This phone already told us which size this barcode is ("Which size?"): go straight there.
    const remembered = rememberedItem(code);
    if (remembered) {
      setPhase({ kind: "matched", itemId: remembered, name: null });
      router.push(`/item/${remembered}`);
      return;
    }
    setPhase({ kind: "looking", code });
    lookupAbort.current?.abort();
    const controller = new AbortController();
    lookupAbort.current = controller;
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/barcode?code=${encodeURIComponent(code)}`, { signal: controller.signal });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok || !isBarcodeResult(data)) {
        setPhase({ kind: "tiles", why: "failed", code });
        return;
      }
      const name = productLabel(data);
      if (data.status === "matched" && data.item_id) {
        setPhase({ kind: "matched", itemId: data.item_id, name });
        router.push(`/item/${data.item_id}`);
      } else if (data.status === "known" && name) {
        setPhase({ kind: "tiles", why: "known", name, code, candidates: data.candidates });
      } else {
        setPhase({ kind: "tiles", why: "unknown", code });
      }
    } catch {
      // Left the page: nothing to show. Timed out or offline: say so.
      if (lookupAbort.current === controller && !document.hidden) setPhase({ kind: "tiles", why: "failed", code });
    } finally {
      clearTimeout(timer);
      if (lookupAbort.current === controller) lookupAbort.current = null;
    }
  });

  // The scan loop: grab the viewfinder area a few times a second until a barcode reads.
  useEffect(() => {
    if (phase.kind !== "camera" || cameraStatus !== "on") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: { code: string; at: number } | null = null;
    const canvas = document.createElement("canvas");
    readerRef.current ??= createBarcodeReader();
    const readerPromise = readerRef.current;

    void readerPromise.then((reader) => {
      const tick = async () => {
        if (stopped) return;
        const video = videoRef.current;
        const box = boxRef.current;
        if (videoHasFrame(video) && box && drawViewfinder(video, box, canvas)) {
          const code = await reader.read(canvas).catch(() => null);
          if (stopped) return;
          if (code) {
            const now = Date.now();
            if (reader.kind === "native" || (last?.code === code && now - last.at < CONFIRM_WINDOW_MS)) {
              void lookUp(code);
              return;
            }
            last = { code, at: now };
          }
        }
        timer = setTimeout(tick, reader.kind === "native" ? 120 : 160);
      };
      void tick();
    });

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase.kind, cameraStatus, videoRef]);

  function scanAgain() {
    if (cameraStatus !== "starting" && cameraStatus !== "on") retryCamera();
    setPhase({ kind: "camera" });
  }

  // A match is named the way the app names it ("Red Bull, 250 ml"), falling back to the product's own name.
  const matchedItem = phase.kind === "matched" ? items.find((i) => i.id === phase.itemId) : undefined;
  const matchedName = matchedItem
    ? `${matchedItem.name}, ${matchedItem.size}`
    : phase.kind === "matched"
      ? phase.name
      : null;

  // What the screen says, also announced politely for screen readers (SPEC section 11).
  let heading: string;
  let line: string | null = null;
  if (showCamera) {
    heading = "Scan a barcode";
    line =
      phase.kind === "looking"
        ? "Barcode read. Looking it up…"
        : cameraStatus === "on"
          ? "Camera on. Hold the barcode inside the box."
          : cameraSlow
            ? WAITING
            : "Starting the camera…";
  } else if (cameraProblem) {
    heading = "Pick your item";
    line = `${cameraProblem} Pick your item below instead.`;
  } else if (phase.kind === "matched") {
    heading = `Found ${matchedName ?? "your item"}`;
    line = "Opening its prices…";
  } else if (phase.kind === "tiles" && phase.why === "known" && phase.candidates?.length) {
    heading = `That's ${phase.name}. Which size?`;
    line = "Drinks are priced by size, not flavour: pick the size and you'll see where it's cheapest.";
  } else if (phase.kind === "tiles" && phase.why === "known") {
    heading = `That's ${phase.name}. We don't track it yet.`;
  } else if (phase.kind === "tiles" && phase.why === "unknown") {
    heading = "We couldn't find that barcode.";
    line = phase.code ? `Barcode ${phase.code}.` : null;
  } else if (phase.kind === "tiles" && phase.why === "failed") {
    heading = "We couldn't look that barcode up right now.";
    line = "Check your connection and scan again, or pick your item.";
  } else {
    heading = "Pick your item";
    line = "Tap what you're buying to see where it's cheapest.";
  }
  const announcement = [heading === "Scan a barcode" ? null : heading, line].filter(Boolean).join(" ");
  const live = (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );

  if (showCamera) {
    return (
      <>
        {live}
        <main className="fixed inset-0 overflow-hidden bg-ink text-ink">
          <h1 ref={headingRef} tabIndex={-1} className="sr-only">
            {heading}
          </h1>
          {/* The picture itself is decorative: the words around it carry the state. */}
          <video
            ref={videoRef}
            aria-hidden="true"
            playsInline
            muted
            autoPlay
            className="absolute inset-0 h-full w-full object-cover"
          />

          {/* Viewfinder: the box stays clear, everything around it is dimmed. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <div
              ref={boxRef}
              className="relative aspect-[8/5] w-[min(82vw,22rem)] rounded-tag shadow-[0_0_0_100vmax_rgba(26,26,26,0.62)]"
            >
              <span className="absolute -top-1 -left-1 h-8 w-8 rounded-tl-tag border-t-[5px] border-l-[5px] border-tag" />
              <span className="absolute -top-1 -right-1 h-8 w-8 rounded-tr-tag border-t-[5px] border-r-[5px] border-tag" />
              <span className="absolute -bottom-1 -left-1 h-8 w-8 rounded-bl-tag border-b-[5px] border-l-[5px] border-tag" />
              <span className="absolute -right-1 -bottom-1 h-8 w-8 rounded-br-tag border-r-[5px] border-b-[5px] border-tag" />
              <span className="absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 bg-tag/80 motion-safe:animate-pulse" />
              {/* Under the box: what's happening, in words (announced by the status line above). */}
              <p className={`${CHIP} absolute top-full left-1/2 mt-6 w-max max-w-[90vw] -translate-x-1/2`}>
                {phase.kind === "looking" ? (
                  <>
                    Looking up <span className="font-mono">{phase.code}</span>…
                  </>
                ) : cameraStatus === "on" ? (
                  "Hold the barcode inside the box"
                ) : cameraSlow ? (
                  WAITING
                ) : (
                  "Starting the camera…"
                )}
              </p>
            </div>
          </div>

          {/* Top: close, and the torch where the phone has one. */}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),12px)]">
            <Link href="/" aria-label="Close the scanner" className={buttonClasses("secondary", "md")}>
              <span aria-hidden="true" className="text-2xl leading-none">
                ×
              </span>
              Close
            </Link>
            {torch.supported ? (
              <Button aria-pressed={torch.on} onClick={torch.toggle}>
                <span aria-hidden="true">🔦</span> Torch
              </Button>
            ) : null}
          </div>

          {/* Bottom: the way out for fresh food, coffee, or a barcode that won't read. */}
          <div className="absolute inset-x-0 bottom-0 px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => {
                cancelLookup();
                setPhase({ kind: "tiles", why: "picked" });
              }}
            >
              No barcode? Pick your item
            </Button>
          </div>
        </main>
      </>
    );
  }

  const canRetryCamera = cameraStatus === "denied" || cameraStatus === "busy";
  const tilesHeading = phase.kind === "tiles" && phase.why !== "picked" && !cameraProblem;
  const fromBarcode = phase.kind === "matched" || (phase.kind === "tiles" && phase.why !== "picked");
  let actions: ReactNode = null;
  if (phase.kind === "matched") {
    actions = (
      <div className="mt-4 flex flex-col gap-3">
        <Link href={`/item/${phase.itemId}`} className={buttonClasses("primary", "lg", "w-full")}>
          {matchedItem ? `See ${matchedItem.name} prices` : "See its prices"}
        </Link>
        <Button className="w-full" onClick={scanAgain}>
          <BarcodeIcon /> Scan another barcode
        </Button>
      </div>
    );
  } else if (!cameraProblem || canRetryCamera) {
    actions = (
      <Button variant={cameraProblem ? "secondary" : "primary"} className="mt-4 w-full" onClick={scanAgain}>
        <BarcodeIcon /> {cameraProblem ? "Try the camera again" : "Scan again"}
      </Button>
    );
  }

  return (
    <>
      {live}
      <main className="mx-auto min-h-dvh max-w-md bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),2.5rem)]">
        <header className="flex items-center gap-3">
          <Link href="/" className={buttonClasses("secondary", "md", "shrink-0")}>
            <span aria-hidden="true">←</span> Map
          </Link>
          <p className="-rotate-1 rounded-tag border-2 border-ink bg-tag px-3 py-1.5 font-heading text-xl font-extrabold leading-none shadow-ink">
            Scan a barcode
          </p>
        </header>

        <section aria-labelledby="scan-heading" className="mt-6">
          <h1
            id="scan-heading"
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-2xl font-extrabold leading-tight focus:outline-none"
          >
            {heading}
          </h1>
          {line ? <p className="mt-2">{line}</p> : null}
          {actions}
        </section>

        {phase.kind === "matched" ? null : (
          <section aria-labelledby={tilesHeading ? "tiles-heading" : "scan-heading"} className="mt-6">
            {tilesHeading ? (
              <h2 id="tiles-heading" className="mb-3 font-heading text-xl font-extrabold">
                Pick your item
              </h2>
            ) : null}
            {itemsApi.error ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-tag border-2 border-ink bg-card px-3 py-2 shadow-ink"
              >
                <span>{itemsApi.error}</span>
                <Button onClick={itemsApi.retry}>Try again</Button>
              </div>
            ) : items.length > 0 ? (
              <nav aria-label="Items">
                <ItemTiles
                  layout="grid"
                  onSelect={(item) => {
                    if (phase.kind === "tiles" && phase.candidates?.length && phase.code) rememberItem(phase.code, item.id);
                  }}
                  items={
                    phase.kind === "tiles" && phase.candidates?.length
                      ? items.filter((i) => phase.candidates?.includes(i.id))
                      : items
                  }
                />
              </nav>
            ) : (
              <p className="text-ink-2">Loading items…</p>
            )}
            <WakingUp show={itemsApi.slow} className="mt-3" />
          </section>
        )}

        {fromBarcode ? <p className="mt-8 text-ink-2">{OFF_CREDIT}</p> : null}
      </main>
    </>
  );
}
