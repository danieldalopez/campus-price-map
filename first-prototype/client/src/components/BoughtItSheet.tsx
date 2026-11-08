import { Camera, ChevronDown, ImageOff, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@databricks/appkit-ui/react';
import type { Evidence, SubmitProposalBody, SubmitProposalResult } from '../../../shared/types';
import { api } from '@/lib/api';
import { useCatalog } from '@/lib/catalog';
import { notifyDataChanged } from '@/lib/events';
import { announceSubmission } from '@/lib/feedback';
import { money } from '@/lib/format';
import { setPendingPurchase, type PendingPurchase } from '@/lib/purchase';
import { digitsFromCents, NumberPad, PriceDisplay, priceFromDigits } from './NumberPad';
import { OutletPicker } from './OutletPicker';
import { ItemIcon } from './PriceBits';

interface OpenRequest {
  itemId: string;
  /** Null when we don't know where they bought it: the sheet asks first. */
  outletId: string | null;
  /** Price to prefill: the student's shelf report, or the current official price. */
  prefillCents: number | null;
  /** The student's own shelf report at this outlet, if any. */
  shelfCents: number | null;
  shelfEvidence: Evidence | null;
}

let request: OpenRequest | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Ask "Did you buy it?" for an item at an outlet. */
export function openBoughtIt(next: OpenRequest) {
  request = next;
  listeners.forEach((l) => l());
}

export function openBoughtItFromPending(p: PendingPurchase, officialCents: number | null) {
  openBoughtIt({
    itemId: p.itemId,
    outletId: p.outletId,
    prefillCents: p.shelfCents ?? officialCents,
    shelfCents: p.shelfCents,
    shelfEvidence: p.shelfEvidence,
  });
}

function close() {
  request = null;
  listeners.forEach((l) => l());
}

/** Mounted once in the app shell. */
export function BoughtItSheet() {
  const req = useSyncExternalStore(subscribe, () => request, () => request);
  const { item, outlet, catalog } = useCatalog();
  const [digits, setDigits] = useState('');
  const [outletId, setOutletId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!req) return;
    setDigits(digitsFromCents(req.prefillCents));
    setOutletId(req.outletId);
    setEditing(req.prefillCents === null);
    setReceipt((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    if (!req.outletId) setPickerOpen(true);
  }, [req]);

  const it = item(req?.itemId);
  const out = outlet(outletId);
  const cents = priceFromDigits(digits);

  const submit = async () => {
    if (!req || !outletId || cents <= 0) return;
    setSubmitting(true);
    try {
      const body: SubmitProposalBody = {
        itemId: req.itemId,
        outletId,
        priceCents: cents,
        kind: 'checkout',
        // A receipt photo is proof; otherwise reuse the shelf report's evidence only when this is the
        // same outlet and the same price, so a corrected or relocated price counts as typed.
        evidence: receipt
          ? 'receipt'
          : req.shelfEvidence && outletId === req.outletId && cents === req.shelfCents
            ? req.shelfEvidence
            : 'typed',
      };
      const result = await api<SubmitProposalResult>('/api/proposals', { method: 'POST', body });
      announceSubmission(result, it);
      setPendingPurchase(null);
      notifyDataChanged();
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const dismiss = (forget: boolean) => {
    if (forget) setPendingPurchase(null);
    close();
  };

  return (
    <>
      <Drawer open={req !== null} onOpenChange={(o) => !o && dismiss(false)}>
        <DrawerContent>
          <div className="mx-auto w-full max-w-md">
            <DrawerHeader className="text-left">
              <div className="flex items-center gap-3">
                {it && <ItemIcon icon={it.icon} className="h-11 w-11" />}
                <div className="min-w-0">
                  <DrawerTitle>Did you buy it?</DrawerTitle>
                  <DrawerDescription className="truncate">
                    {it ? `${it.name}, ${it.size}` : ''} · what you actually paid
                  </DrawerDescription>
                </div>
              </div>
            </DrawerHeader>

            <div className="space-y-4 px-4">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex min-h-11 w-full items-center justify-between rounded-xl bg-muted px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>
                  At <span className="font-semibold">{out?.name ?? 'choose outlet'}</span>
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  Change <ChevronDown className="h-4 w-4" aria-hidden />
                </span>
              </button>

              <PriceDisplay digits={digits} className="text-5xl" />

              {editing ? (
                <NumberPad digits={digits} onChange={setDigits} compact />
              ) : (
                <Button variant="outline" className="h-11 w-full" onClick={() => setEditing(true)}>
                  The till price was different
                </Button>
              )}

              <div className="flex items-center gap-3 rounded-xl border border-dashed p-3">
                {receipt ? (
                  <img src={receipt} alt="Receipt preview" className="h-12 w-12 rounded-lg object-cover" />
                ) : (
                  <Camera className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">{receipt ? 'Receipt added' : 'Add a receipt photo (optional)'}</p>
                  <p className="text-muted-foreground">Proof moves the price live faster. The photo stays on your phone.</p>
                </div>
                {receipt ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    aria-label="Remove receipt photo"
                    onClick={() => {
                      URL.revokeObjectURL(receipt);
                      setReceipt(null);
                    }}
                  >
                    <ImageOff className="h-5 w-5" aria-hidden />
                  </Button>
                ) : (
                  <Button variant="outline" className="h-11" onClick={() => fileRef.current?.click()}>
                    Add
                  </Button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setReceipt(URL.createObjectURL(f));
                    e.target.value = '';
                  }}
                />
              </div>
            </div>

            <DrawerFooter className="pb-safe">
              <Button className="h-12 text-base" disabled={submitting || cents <= 0 || !outletId} onClick={() => void submit()}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                {cents > 0 ? `Yes, I paid ${money(cents)}` : 'Enter what you paid'}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" className="h-11" onClick={() => dismiss(false)}>
                  Ask me later
                </Button>
                <Button variant="ghost" className="h-11" onClick={() => dismiss(true)}>
                  I didn't buy it
                </Button>
              </div>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
      {catalog && (
        <OutletPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          outlets={catalog.outlets}
          selectedId={outletId}
          onSelect={(o) => setOutletId(o.id)}
          title="Where did you buy it?"
        />
      )}
    </>
  );
}
