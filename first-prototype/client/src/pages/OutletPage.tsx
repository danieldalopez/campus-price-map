import { ArrowRight, Clock, MapPin, Trophy } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Skeleton } from '@databricks/appkit-ui/react';
import { CATEGORY_LABELS, CATEGORY_ORDER, type OutletDetail, type OutletItemComparison } from '../../../shared/types';
import { PageHeader } from '@/components/PageHeader';
import { Freshness, ItemIcon, SoldOutTag } from '@/components/PriceBits';
import { useQuery } from '@/lib/api';
import { useOnDataChanged } from '@/lib/events';
import { money, ordinal, savings } from '@/lib/format';
import { cn } from '@/lib/utils';

export function OutletPage() {
  const { outletId } = useParams();
  const { data, error, reload } = useQuery<OutletDetail>(outletId ? `/api/outlets/${outletId}` : null);
  useOnDataChanged(() => void reload());

  if (error && !data)
    return (
      <div>
        <PageHeader title="Outlet" />
        <p className="rounded-xl bg-destructive/10 p-3 text-destructive">{error}</p>
      </div>
    );
  if (!data)
    return (
      <div className="space-y-3 pt-14">
        <Skeleton className="h-16 rounded-2xl" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={`o${i}`} className="h-16 rounded-2xl" />
        ))}
      </div>
    );

  const cheapestCount = data.items.filter((i) => i.rank === 1).length;
  const groups = CATEGORY_ORDER.map((c) => ({ category: c, items: data.items.filter((i) => i.item.category === c) })).filter((g) => g.items.length);

  return (
    <div className="mx-auto max-w-2xl pb-6">
      <PageHeader title={data.outlet.name} subtitle={data.outlet.area} />

      <div className="mb-5 flex flex-wrap gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5">
          <Clock className="h-4 w-4" aria-hidden /> {data.outlet.hours}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5">
          <MapPin className="h-4 w-4" aria-hidden /> {data.items.length} tracked items
        </span>
        {cheapestCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--level-1-soft)] px-3 py-1.5 text-[var(--level-1)]">
            <Trophy className="h-4 w-4" aria-hidden /> Cheapest on campus for {cheapestCount}
          </span>
        )}
      </div>

      {groups.map((g) => (
        <section key={g.category} className="mb-6" aria-labelledby={`oc-${g.category}`}>
          <h2 id={`oc-${g.category}`} className="mb-2 px-1 text-sm font-semibold text-muted-foreground">
            {CATEGORY_LABELS[g.category]}
          </h2>
          <ul className="divide-y overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            {g.items.map((c) => (
              <ItemRow key={c.item.id} c={c} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Comparison({ c }: { c: OutletItemComparison }) {
  if (c.of <= 1) return <span className="text-xs text-muted-foreground">Only outlet on campus with this</span>;
  if (c.rank === 1)
    return <span className="rounded-full bg-[var(--level-1-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--level-1)]">Cheapest on campus</span>;
  const diff = c.diffFromAverageCents;
  const tone = diff > 0 ? 'bg-[var(--level-3-soft)] text-[var(--level-3)]' : 'bg-[var(--level-1-soft)] text-[var(--level-1)]';
  const label =
    Math.abs(diff) >= 10
      ? `${savings(diff)} ${diff > 0 ? 'above' : 'below'} campus average`
      : `${ordinal(c.rank)} cheapest of ${c.of}`;
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', Math.abs(diff) >= 10 ? tone : 'bg-muted text-foreground')}>{label}</span>;
}

function ItemRow({ c }: { c: OutletItemComparison }) {
  return (
    <li className={cn('p-3', c.stock === 'sold_out' && 'opacity-70')}>
      <div className="flex items-center gap-3">
        <ItemIcon icon={c.item.icon} className="h-11 w-11 text-2xl" />
        <div className="min-w-0 flex-1">
          <Link to={`/item/${c.item.id}`} className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {c.item.name} <span className="font-normal text-muted-foreground">{c.item.size}</span>
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Comparison c={c} />
            {c.stock !== 'in_stock' && <SoldOutTag since={null} possibly={c.stock === 'possibly_out'} />}
          </div>
        </div>
        <span className={cn('tabular text-lg font-semibold', c.stale && 'text-muted-foreground')}>{money(c.priceCents)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 pl-14">
        <Freshness confirmedBy={c.confirmedBy} confirmedAt={c.confirmedAt} stale={c.stale} />
        {c.cheapest && (
          <Link
            to={`/item/${c.item.id}`}
            className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-[var(--brand-ink)] underline-offset-4 hover:underline"
          >
            {money(c.cheapest.priceCents)} at {c.cheapest.outletName} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>
    </li>
  );
}
