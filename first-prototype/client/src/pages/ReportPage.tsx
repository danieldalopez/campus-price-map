import { ChevronDown, Loader2, LocateFixed, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import type { SubmitProposalBody, SubmitProposalResult } from '../../../shared/types';
import { NumberPad, PriceDisplay, priceFromDigits } from '@/components/NumberPad';
import { OutletPicker } from '@/components/OutletPicker';
import { PageHeader } from '@/components/PageHeader';
import { ItemIcon } from '@/components/PriceBits';
import { api } from '@/lib/api';
import { useCatalog } from '@/lib/catalog';
import { notifyDataChanged } from '@/lib/events';
import { announceSubmission } from '@/lib/feedback';
import { setPendingPurchase } from '@/lib/purchase';
import { locate, setCurrentOutlet, suggestOutlet, useCurrentOutletId } from '@/lib/where';

export function ReportPage() {
  const { itemId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { catalog, item, outlet } = useCatalog();
  const currentId = useCurrentOutletId();
  const [outletId, setOutletId] = useState<string | null>(params.get('outlet') ?? currentId);
  const [suggested, setSuggested] = useState(false);
  const [locating, setLocating] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [digits, setDigits] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const via = params.get('via') === 'scan' ? 'scan' : 'pick';

  const it = item(itemId);
  const out = outlet(outletId);

  // Suggest the outlet from location when we don't know it yet.
  useEffect(() => {
    if (outletId || !catalog) return;
    let alive = true;
    setLocating(true);
    void locate().then((fix) => {
      if (!alive) return;
      setLocating(false);
      const guess = fix ? suggestOutlet(fix, catalog.outlets) : null;
      if (guess) {
        setOutletId(guess.id);
        setSuggested(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [catalog, outletId]);

  const chooseOutlet = (id: string) => {
    setOutletId(id);
    setSuggested(false);
    setCurrentOutlet(id);
  };

  const resultsUrl = `/item/${itemId}${outletId ? `?from=${outletId}` : ''}`;

  const share = async () => {
    if (!itemId || !outletId) {
      setPickerOpen(true);
      return;
    }
    const cents = priceFromDigits(digits);
    if (cents <= 0) return;
    setSubmitting(true);
    try {
      setCurrentOutlet(outletId);
      const body: SubmitProposalBody = { itemId, outletId, priceCents: cents, kind: 'shelf', evidence: via === 'scan' ? 'scan' : 'typed' };
      const result = await api<SubmitProposalResult>('/api/proposals', { method: 'POST', body });
      announceSubmission(result, it);
      setPendingPurchase({ itemId, outletId, shelfCents: cents, shelfEvidence: body.evidence });
      notifyDataChanged();
      void navigate(resultsUrl, { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't share that price. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const skip = () => {
    if (itemId && outletId) {
      setCurrentOutlet(outletId);
      setPendingPurchase({ itemId, outletId, shelfCents: null, shelfEvidence: null });
    }
    void navigate(resultsUrl, { replace: true });
  };

  if (catalog && !it) {
    return (
      <div>
        <PageHeader title="Item not found" />
        <p className="text-muted-foreground">We don't track that item.</p>
      </div>
    );
  }

  const cents = priceFromDigits(digits);

  return (
    <div className="mx-auto flex max-w-md flex-col">
      <PageHeader title="What's the price here?" />

      <div className="mb-4 flex items-center gap-3">
        {it ? <ItemIcon icon={it.icon} className="h-14 w-14 text-3xl" /> : <Skeleton className="h-14 w-14 rounded-2xl" />}
        <div className="min-w-0">
          {it ? (
            <>
              <p className="text-xl font-semibold leading-tight">{it.name}</p>
              <p className="text-muted-foreground">{it.size}</p>
            </>
          ) : (
            <Skeleton className="h-6 w-32" />
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="mb-2 flex min-h-12 w-full items-center gap-2 rounded-xl bg-muted px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {locating ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden /> : suggested ? <LocateFixed className="h-5 w-5 text-[var(--brand)]" aria-hidden /> : <MapPin className="h-5 w-5 text-muted-foreground" aria-hidden />}
        <span className="min-w-0 flex-1">
          {out ? (
            <>
              <span className="text-sm text-muted-foreground">{suggested ? 'Looks like you are at' : 'You are at'} </span>
              <span className="font-semibold">{out.name}</span>
            </>
          ) : (
            <span className="font-medium">{locating ? 'Finding your outlet…' : 'Which outlet are you in?'}</span>
          )}
        </span>
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {out ? 'Change' : 'Choose'} <ChevronDown className="h-4 w-4" aria-hidden />
        </span>
      </button>

      <PriceDisplay digits={digits} className="my-4 text-6xl" />

      <NumberPad digits={digits} onChange={setDigits} />

      <div className="mt-5 space-y-2 pb-4">
        <Button className="h-13 min-h-12 w-full text-base" disabled={submitting || cents <= 0} onClick={() => void share()}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {!outletId ? 'Choose your outlet to share' : cents > 0 ? 'Share price & see where it’s cheaper' : 'Enter the price you see'}
        </Button>
        <Button variant="ghost" className="h-12 w-full text-base" onClick={skip}>
          Skip, just show me prices
        </Button>
        <p className="px-2 text-center text-xs text-muted-foreground">
          Your price stays pending until another student confirms it. No name needed.
        </p>
      </div>

      {catalog && (
        <OutletPicker open={pickerOpen} onOpenChange={setPickerOpen} outlets={catalog.outlets} selectedId={outletId} onSelect={(o) => chooseOutlet(o.id)} />
      )}
    </div>
  );
}
