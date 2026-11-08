import { Footprints, Hourglass, Info, MoreHorizontal, PartyPopper, ShoppingBag, Sparkles, TrendingDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
} from '@databricks/appkit-ui/react';
import type { ItemResults, OpenProposal, OutletPrice, StockResult, Vote, VoteResult } from '../../../shared/types';
import { openBoughtIt } from '@/components/BoughtItSheet';
import { PageHeader } from '@/components/PageHeader';
import { Freshness, ItemIcon, LevelBadge, SoldOutTag } from '@/components/PriceBits';
import { api, useQuery } from '@/lib/api';
import { notifyDataChanged, useOnDataChanged } from '@/lib/events';
import { money, ordinal, savings, students, timeAgo, walk } from '@/lib/format';
import { getPendingPurchase, setPendingPurchase, usePendingPurchase } from '@/lib/purchase';
import { cn } from '@/lib/utils';
import { useCurrentOutletId } from '@/lib/where';

/** After this long on the results page at an outlet, gently ask "Did you buy it?". */
const LINGER_MS = 90_000;

export function ResultsPage() {
  const { itemId } = useParams();
  const [params] = useSearchParams();
  const currentId = useCurrentOutletId();
  const from = params.get('from') ?? currentId;
  const { data, error, loading, reload } = useQuery<ItemResults>(
    itemId ? `/api/items/${itemId}/results?log=1${from ? `&from=${encodeURIComponent(from)}` : ''}` : null,
  );
  useOnDataChanged(() => void reload());
  const [lingered, setLingered] = useState(false);
  const pending = usePendingPurchase();

  useEffect(() => {
    if (!from) return;
    const t = window.setTimeout(() => setLingered(true), LINGER_MS);
    return () => window.clearTimeout(t);
  }, [from, itemId]);

  if (error && !data) {
    return (
      <div>
        <PageHeader title="Prices" />
        <p className="rounded-xl bg-destructive/10 p-3 text-destructive">{error}</p>
      </div>
    );
  }
  if (!data) return <ResultsSkeleton />;

  const here = data.outlets.find((o) => o.outlet.id === data.currentOutletId) ?? null;
  const hereCents = here?.priceCents ?? null;

  // Ask only while this purchase is still unanswered at this outlet.
  const lingerPrompt =
    lingered && here !== null && pending !== null && pending.itemId === data.item.id && pending.outletId === here.outlet.id;

  const boughtIt = (row: OutletPrice | null) => {
    // With no known outlet, don't guess: the sheet asks where they bought it.
    const outletId = row?.outlet.id ?? data.currentOutletId ?? null;
    const p = getPendingPurchase();
    const mine = p && outletId && p.itemId === data.item.id && p.outletId === outletId ? p : null;
    const official = outletId ? (data.outlets.find((o) => o.outlet.id === outletId)?.priceCents ?? null) : null;
    if (outletId) {
      setPendingPurchase({ itemId: data.item.id, outletId, shelfCents: mine?.shelfCents ?? null, shelfEvidence: mine?.shelfEvidence ?? null });
    }
    openBoughtIt({
      itemId: data.item.id,
      outletId,
      prefillCents: mine?.shelfCents ?? official,
      shelfCents: mine?.shelfCents ?? null,
      shelfEvidence: mine?.shelfEvidence ?? null,
    });
  };

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {data.item.name}
            <span className="font-normal text-muted-foreground">{data.item.size}</span>
          </span>
        }
        subtitle={`${data.outlets.length} outlet${data.outlets.length === 1 ? '' : 's'} on campus · cheapest first`}
        action={<ItemIcon icon={data.item.icon} className="mr-1 h-10 w-10 text-xl" />}
      />

      <SavingsBanner data={data} here={here} />

      {data.bcAverage && <BcBadge data={data} hereCents={hereCents} />}

      {lingerPrompt && here && (
        <button
          type="button"
          onClick={() => {
            setLingered(false);
            boughtIt(here);
          }}
          className="mb-3 flex w-full items-center gap-3 rounded-2xl bg-[var(--brand-soft)] p-3 text-left ring-1 ring-[var(--brand)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ShoppingBag className="h-5 w-5 shrink-0 text-[var(--brand-ink)]" aria-hidden />
          <span className="text-sm">
            <span className="font-semibold">Bought it at {here.outlet.name}?</span> One tap to confirm what you paid.
          </span>
        </button>
      )}

      <ol className="space-y-2" aria-label={`Outlets selling ${data.item.name}, cheapest first`}>
        {data.outlets.map((row) => (
          <OutletRow key={row.outlet.id} row={row} isHere={row.outlet.id === data.currentOutletId} itemId={data.item.id} onBought={() => boughtIt(row)} />
        ))}
      </ol>

      {data.outlets.length === 0 && (
        <p className="rounded-2xl bg-card p-6 text-center text-muted-foreground ring-1 ring-border">No outlet on campus lists this item yet.</p>
      )}

      {data.campusAverageCents !== null && (
        <p className="mt-4 px-1 text-xs text-muted-foreground">
          Campus average {money(data.campusAverageCents)} · {students(data.weeklySearches)} searched this item in the last week · prices are shared and
          checked by students{loading ? ' · refreshing…' : ''}
        </p>
      )}

      <div className="pb-safe fixed inset-x-0 bottom-16 z-30 border-t bg-background/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-2">
          <Button className="h-12 flex-1 gap-2 text-base" onClick={() => boughtIt(here)}>
            <ShoppingBag className="h-5 w-5" aria-hidden /> I bought it
          </Button>
          <Button variant="outline" className="h-12 px-4" asChild>
            <Link to={`/map?item=${data.item.id}`}>Map</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function SavingsBanner({ data, here }: { data: ItemResults; here: OutletPrice | null }) {
  const best = data.outlets.find((o) => o.priceCents !== null && o.stock.state !== 'sold_out');
  if (!best || best.priceCents === null) return null;

  let icon = <TrendingDown className="h-6 w-6" aria-hidden />;
  let headline: string;
  let detail: string | null = null;

  if (here && here.stock.state === 'sold_out') {
    headline = `Sold out here. Cheapest in stock: ${money(best.priceCents)} at ${best.outlet.name}`;
    detail = walk(best.walkMinutes);
  } else if (here && here.priceCents !== null) {
    const saving = here.priceCents - best.priceCents;
    if (best.outlet.id === here.outlet.id || saving <= 0) {
      icon = <PartyPopper className="h-6 w-6" aria-hidden />;
      headline = 'Nice, this is the cheapest on campus.';
      detail = `${money(here.priceCents)} at ${here.outlet.name}${here.stock.state === 'possibly_out' ? ' · someone said it might be sold out' : ''}`;
    } else {
      headline = `You'd save ${savings(saving)} at ${best.outlet.name}`;
      detail = [walk(best.walkMinutes), `${money(best.priceCents)} vs ${money(here.priceCents)} here`].filter(Boolean).join(' · ');
    }
  } else {
    headline = `Cheapest: ${money(best.priceCents)} at ${best.outlet.name}`;
    detail = best.walkMinutes !== null ? walk(best.walkMinutes) : 'Tell us where you are to see walking times and savings';
  }

  return (
    <section
      aria-live="polite"
      className="mb-3 flex items-start gap-3 rounded-2xl bg-[var(--primary)] p-4 text-[var(--primary-foreground)]"
    >
      <span className="mt-0.5 text-[var(--brand)]">{icon}</span>
      <div>
        <p className="text-lg font-semibold leading-snug">{headline}</p>
        {detail && <p className="text-sm opacity-80">{detail}</p>}
      </div>
    </section>
  );
}

function BcBadge({ data, hereCents }: { data: ItemResults; hereCents: number | null }) {
  const bc = data.bcAverage;
  if (!bc) return null;
  const compare = hereCents ?? data.campusAverageCents;
  if (compare === null) return null;
  const pct = Math.round(((compare - bc.priceCents) / bc.priceCents) * 100);
  const subject = hereCents !== null ? 'Here' : 'Campus average';
  const relation = pct === 0 ? 'matches' : pct > 0 ? `is ${pct}% above` : `is ${Math.abs(pct)}% below`;
  return (
    <div className="mb-3 flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p>
        <span className="font-semibold">Vs BC average:</span> {subject} ({money(compare)}) {relation} the provincial average of {money(bc.priceCents)}.{' '}
        <span className="text-muted-foreground">
          Provincial average, not a campus price{bc.isSample ? ' · sample data for this demo, not real StatCan figures' : ` · ${bc.refPeriod}`}
        </span>
      </p>
    </div>
  );
}

function OutletRow({ row, isHere, itemId, onBought }: { row: OutletPrice; isHere: boolean; itemId: string; onBought: () => void }) {
  const navigate = useNavigate();
  const soldOut = row.stock.state === 'sold_out';
  const mine = row.proposals.find((p) => p.mine);
  const ask = row.proposals.find((p) => !p.mine && p.myVote === null);
  const voted = row.proposals.find((p) => !p.mine && p.myVote !== null);

  const stockAction = async (kind: 'out' | 'back') => {
    try {
      const r = await api<StockResult>('/api/stock', { method: 'POST', body: { itemId, outletId: row.outlet.id, kind } });
      toast.success(
        r.state === 'sold_out'
          ? 'Thanks, marked sold out for everyone'
          : r.state === 'possibly_out'
            ? 'Thanks. Another student will check it before it shows as sold out'
            : kind === 'back'
              ? 'Thanks. Once someone confirms, it shows as back in stock'
              : 'Thanks for checking',
      );
      notifyDataChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that');
    }
  };

  return (
    <li
      className={cn(
        'rounded-2xl bg-card p-4 ring-1 ring-border transition',
        isHere && 'ring-2 ring-[var(--brand)]',
        soldOut && 'opacity-75',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'tabular mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
            row.rank === 1 ? 'bg-[var(--level-1)] text-white dark:text-[var(--background)]' : 'bg-muted text-muted-foreground',
          )}
          aria-label={row.rank ? `${ordinal(row.rank)} cheapest` : 'Not ranked'}
        >
          {row.rank ?? '–'}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to={`/outlet/${row.outlet.id}`} className="font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {row.outlet.name}
            </Link>
            {isHere && (
              <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-ink)]">You're here</span>
            )}
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span className="truncate">{row.outlet.area}</span>
            {row.walkMinutes !== null && row.walkMinutes > 0 && (
              <span className="inline-flex items-center gap-1">
                <Footprints className="h-3.5 w-3.5" aria-hidden />
                {walk(row.walkMinutes)}
              </span>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {row.priceCents !== null ? (
              <Freshness confirmedBy={row.confirmedBy} confirmedAt={row.confirmedAt} stale={row.stale} />
            ) : (
              <span className="text-xs text-muted-foreground">No confirmed price yet</span>
            )}
            {row.stock.state !== 'in_stock' && <SoldOutTag since={row.stock.since} possibly={row.stock.state === 'possibly_out'} />}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          {row.priceCents !== null ? (
            <span className={cn('tabular text-2xl font-semibold tracking-tight', row.stale && 'text-muted-foreground')}>{money(row.priceCents)}</span>
          ) : (
            <span className="text-lg text-muted-foreground">—</span>
          )}
          {row.level && <LevelBadge level={row.level} />}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="-mr-2 -mt-1 h-11 w-11 shrink-0" aria-label={`More for ${row.outlet.name}`}>
              <MoreHorizontal className="h-5 w-5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void navigate(`/item/${itemId}/report?outlet=${row.outlet.id}&via=pick`)}>Update the price here</DropdownMenuItem>
            <DropdownMenuItem onSelect={onBought}>I bought it here</DropdownMenuItem>
            {row.stock.state === 'in_stock' && <DropdownMenuItem onSelect={() => void stockAction('out')}>Report sold out</DropdownMenuItem>}
            {row.stock.state === 'sold_out' && <DropdownMenuItem onSelect={() => void stockAction('back')}>It's back in stock</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => void navigate(`/outlet/${row.outlet.id}`)}>See everything at {row.outlet.name}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {mine && <MyProposal p={mine} />}
      {ask && <ConfirmPrompt p={ask} outletName={row.outlet.name} />}
      {!ask && voted && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4" aria-hidden /> Thanks for checking {money(voted.priceCents)}. {voted.yes} of {voted.required} confirmations so far.
        </p>
      )}
      <StockPrompt row={row} />
    </li>
  );
}

function MyProposal({ p }: { p: OpenProposal }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
      <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span>
        <span className="font-semibold">Your report: {money(p.priceCents)}</span> · {p.held ? 'held for extra review' : 'waiting for confirmation'} ({p.yes} of{' '}
        {p.required})
      </span>
    </p>
  );
}

function ConfirmPrompt({ p, outletName }: { p: OpenProposal; outletName: string }) {
  const [busy, setBusy] = useState<Vote | null>(null);
  const vote = async (v: Vote) => {
    setBusy(v);
    try {
      const r = await api<VoteResult>(`/api/proposals/${p.id}/votes`, { method: 'POST', body: { vote: v } });
      if (r.status === 'live') toast.success(`Confirmed. ${money(p.priceCents)} is now live for everyone`, { description: 'Thanks for keeping prices fresh.' });
      else if (r.status === 'rejected') toast('Thanks. That report has been discarded', { description: 'More students said it was wrong.' });
      else if (v === 'unsure') toast('No problem, we will ask someone else');
      else toast.success('Thanks for checking', { description: `${r.yes} of ${r.required} confirmations so far.` });
      notifyDataChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-3 rounded-xl bg-[var(--level-2-soft)] p-3" role="group" aria-label={`Confirm a reported price at ${outletName}`}>
      <p className="text-sm">
        <span className="font-semibold">Someone reported this is now {money(p.priceCents)}.</span> Is that right?
        <span className="text-muted-foreground"> · {timeAgo(p.createdAt)}{p.held ? ' · unusual price, extra review' : ''}</span>
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(['yes', 'no', 'unsure'] as const).map((v) => (
          <Button key={v} variant={v === 'yes' ? 'default' : 'outline'} className={v === 'yes' ? 'h-11' : 'h-11 bg-card'} disabled={busy !== null} onClick={() => void vote(v)}>
            {v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Not sure'}
          </Button>
        ))}
      </div>
    </div>
  );
}

function StockPrompt({ row }: { row: OutletPrice }) {
  const [busy, setBusy] = useState(false);
  const s = row.stock;
  const send = async (reportId: number, vote: 'yes' | 'no') => {
    setBusy(true);
    try {
      const r = await api<StockResult>(`/api/stock/${reportId}/votes`, { method: 'POST', body: { vote } });
      toast.success(
        r.state === 'sold_out' ? 'Thanks, it now shows as sold out' : r.state === 'in_stock' ? 'Thanks, it shows as in stock' : 'Thanks for checking',
      );
      notifyDataChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  };

  if (s.state === 'possibly_out' && s.reportId && !s.mineOrVoted) {
    return (
      <div className="mt-3 rounded-xl bg-muted p-3" role="group" aria-label="Check a sold out report">
        <p className="text-sm">
          <span className="font-semibold">Someone said this might be sold out.</span> Can you check?
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11 bg-card" disabled={busy} onClick={() => void send(s.reportId!, 'yes')}>
            Yes, sold out
          </Button>
          <Button variant="outline" className="h-11 bg-card" disabled={busy} onClick={() => void send(s.reportId!, 'no')}>
            No, it's here
          </Button>
        </div>
      </div>
    );
  }
  if (s.state === 'sold_out' && s.backReportId && !s.mineOrVoted) {
    return (
      <div className="mt-3 rounded-xl bg-muted p-3" role="group" aria-label="Check a back in stock report">
        <p className="text-sm">
          <span className="font-semibold">Someone said it's back in stock.</span> Is it?
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11 bg-card" disabled={busy} onClick={() => void send(s.backReportId!, 'yes')}>
            Yes, it's back
          </Button>
          <Button variant="outline" className="h-11 bg-card" disabled={busy} onClick={() => void send(s.backReportId!, 'no')}>
            Still sold out
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

function ResultsSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-3 pt-14">
      <Skeleton className="h-20 rounded-2xl" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={`r${i}`} className="h-24 rounded-2xl" />
      ))}
    </div>
  );
}
