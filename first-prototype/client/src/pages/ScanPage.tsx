import { Camera, CameraOff, Grid3X3, Keyboard, Map as MapIcon, ScanLine, ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button, Input } from '@databricks/appkit-ui/react';
import type { Item, ItemResults } from '../../../shared/types';
import { openBoughtItFromPending } from '@/components/BoughtItSheet';
import { ItemIcon } from '@/components/PriceBits';
import { Scanner, type ScannerState } from '@/components/Scanner';
import { api, ApiError } from '@/lib/api';
import { useCatalog } from '@/lib/catalog';
import { usePendingPurchase } from '@/lib/purchase';

const SAMPLE_BARCODE = '9002490100070'; // Red Bull 250 ml

export function ScanPage() {
  const navigate = useNavigate();
  const { item, outlet } = useCatalog();
  const [scanning, setScanning] = useState(false);
  const [state, setState] = useState<ScannerState>('idle');
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState('');
  const [looking, setLooking] = useState(false);
  const pending = usePendingPurchase();

  // Start the camera straight away if the student already allowed it.
  useEffect(() => {
    let alive = true;
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((p) => {
        if (alive && p.state === 'granted') setScanning(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const lookup = async (barcode: string) => {
    if (looking) return;
    setLooking(true);
    try {
      const found = await api<Item>(`/api/items/by-barcode/${encodeURIComponent(barcode)}`);
      setScanning(false);
      void navigate(`/item/${found.id}/report?via=scan`);
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 404 ? "We don't track this item yet." : 'Could not look that up.';
      toast(msg, { description: 'Try picking it from the list instead.', action: { label: 'Pick item', onClick: () => void navigate('/items') } });
    } finally {
      setLooking(false);
    }
  };

  const pendingItem = pending ? item(pending.itemId) : undefined;
  const pendingOutlet = pending ? outlet(pending.outletId) : undefined;

  return (
    <div className="flex min-h-full flex-col gap-4">
      <section
        className="relative -mx-4 -mt-4 flex min-h-[58vh] flex-col overflow-hidden bg-[var(--scanner)] text-white sm:mx-0 sm:mt-0 sm:rounded-3xl"
        aria-label="Barcode scanner"
      >
        <Scanner
          active={scanning}
          onDetect={(c) => void lookup(c)}
          onStateChange={(s) => {
            setState(s);
            // On failure, stop so the button can retry.
            if (s === 'denied' || s === 'unavailable') setScanning(false);
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" aria-hidden />

        <div className="relative z-10 px-5 pt-6">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-white/70">Campus Price Map · First prototype</p>
          <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight">Where is it cheapest on campus?</h1>
        </div>

        <div className="relative z-10 flex flex-1 items-center justify-center px-8 py-6">
          <div className="relative aspect-[4/3] w-full max-w-xs">
            {(['left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl', 'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-2xl', 'right-0 bottom-0 border-r-4 border-b-4 rounded-br-2xl'] as const).map(
              (c) => (
                <span key={c} className={`absolute h-10 w-10 border-[var(--brand)] ${c}`} aria-hidden />
              ),
            )}
            {state === 'scanning' && (
              <span className="cpm-sweep absolute inset-x-3 top-0 h-0.5 rounded bg-[var(--brand)] shadow-[0_0_16px_var(--brand)]" aria-hidden />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              {!scanning && (
                <Button
                  size="lg"
                  className="h-14 gap-2 rounded-full bg-[var(--brand-strong)] px-7 text-base font-semibold text-white hover:bg-[var(--brand-strong)]/90"
                  onClick={() => {
                    setState('idle');
                    setScanning(true);
                  }}
                >
                  <Camera className="h-5 w-5" aria-hidden />
                  {state === 'denied' || state === 'unavailable' ? 'Try the camera again' : 'Scan an item'}
                </Button>
              )}
              {scanning && state === 'starting' && <p className="text-sm text-white/80">Starting camera…</p>}
              {scanning && state === 'scanning' && (
                <p className="mt-auto pb-3 text-sm text-white/85">{looking ? 'Looking it up…' : 'Point at the barcode'}</p>
              )}
              {!scanning && (state === 'denied' || state === 'unavailable') && (
                <div className="order-first space-y-2 px-2">
                  <CameraOff className="mx-auto h-8 w-8 text-white/80" aria-hidden />
                  <p className="text-sm text-white/90">
                    {state === 'denied' ? 'Camera access is off. Allow it in your browser, or use the options below.' : 'No camera here. Use the options below.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="relative z-10 space-y-2 px-5 pb-5">
          {typing ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (/^\d{6,14}$/.test(code)) void lookup(code);
                else toast('Barcodes are 6 to 14 digits.');
              }}
            >
              <Input
                autoFocus
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Barcode number"
                placeholder="Barcode number"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="h-12 border-white/20 bg-white/10 text-white placeholder:text-white/50"
              />
              <Button type="submit" className="h-12 bg-white text-[var(--scanner)] hover:bg-white/90">
                Look up
              </Button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
              <button type="button" className="inline-flex min-h-11 items-center gap-1.5 text-white/85 underline-offset-4 hover:underline" onClick={() => setTyping(true)}>
                <Keyboard className="h-4 w-4" aria-hidden /> Type the barcode
              </button>
              <button type="button" className="inline-flex min-h-11 items-center gap-1.5 text-white/85 underline-offset-4 hover:underline" onClick={() => void lookup(SAMPLE_BARCODE)}>
                <ScanLine className="h-4 w-4" aria-hidden /> Demo: scan a Red Bull
              </button>
            </div>
          )}
        </div>
      </section>

      {pending && pendingItem && (
        <button
          type="button"
          onClick={() => {
            // Prefill with the official price when the shelf price was skipped.
            if (pending.shelfCents !== null) return openBoughtItFromPending(pending, null);
            api<ItemResults>(`/api/items/${pending.itemId}/results?from=${encodeURIComponent(pending.outletId)}`)
              .then((r) => openBoughtItFromPending(pending, r.outlets.find((o) => o.outlet.id === pending.outletId)?.priceCents ?? null))
              .catch(() => openBoughtItFromPending(pending, null));
          }}
          className="flex items-center gap-3 rounded-2xl bg-[var(--brand-soft)] p-3 text-left ring-1 ring-[var(--brand)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ShoppingBag className="h-6 w-6 shrink-0 text-[var(--brand-ink)]" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Did you buy the {pendingItem.name}?</span>
            <span className="block truncate text-sm text-muted-foreground">Confirm what you paid{pendingOutlet ? ` at ${pendingOutlet.name}` : ''}</span>
          </span>
        </button>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/map"
          className="flex min-h-16 items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition hover:ring-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
            <MapIcon className="h-5 w-5" aria-hidden />
          </span>
          <span>
            <span className="block font-semibold">Just browsing? See the map</span>
            <span className="block text-sm text-muted-foreground">Search any item, compare outlets</span>
          </span>
        </Link>
        <Link
          to="/items"
          className="flex min-h-16 items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition hover:ring-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
            <Grid3X3 className="h-5 w-5" aria-hidden />
          </span>
          <span>
            <span className="block font-semibold">No barcode? Pick your item</span>
            <span className="block text-sm text-muted-foreground">Coffee, muffins, sandwiches, fruit</span>
          </span>
        </Link>
      </div>

      <PopularStrip />
    </div>
  );
}

function PopularStrip() {
  const { catalog } = useCatalog();
  const popular = ['red-bull-250', 'drip-12', 'latte-12', 'coke-355', 'bagel-cc'];
  const items = popular.map((id) => catalog?.items.find((i) => i.id === id)).filter((i): i is Item => Boolean(i));
  if (!items.length) return null;
  return (
    <section aria-labelledby="popular-heading" className="pb-2">
      <h2 id="popular-heading" className="mb-2 text-sm font-semibold text-muted-foreground">
        Popular right now
      </h2>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {items.map((i) => (
          <Link
            key={i.id}
            to={`/item/${i.id}`}
            className="flex min-h-12 shrink-0 items-center gap-2 rounded-full bg-card py-1.5 pl-1.5 pr-4 ring-1 ring-border hover:ring-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ItemIcon icon={i.icon} className="h-9 w-9 rounded-full text-lg" />
            <span className="text-sm font-medium">{i.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
