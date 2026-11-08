import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Input, Skeleton } from '@databricks/appkit-ui/react';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../../shared/types';
import { PageHeader } from '@/components/PageHeader';
import { ItemIcon } from '@/components/PriceBits';
import { useCatalog } from '@/lib/catalog';

export function PickItemPage() {
  const { catalog, error } = useCatalog();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  // "browse" goes straight to results; the default asks for the price first.
  const browse = params.get('mode') === 'browse';

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const items = (catalog?.items ?? []).filter((i) => !term || `${i.name} ${i.size}`.toLowerCase().includes(term));
    return CATEGORY_ORDER.map((c) => ({ category: c, items: items.filter((i) => i.category === c) })).filter((g) => g.items.length);
  }, [catalog, q]);

  return (
    <div>
      <PageHeader title="Pick your item" subtitle="21 everyday items, in fixed sizes so prices compare fairly" />
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" aria-label="Search items" className="h-12 rounded-xl pl-10 text-base" />
      </div>

      {error && <p className="rounded-xl bg-destructive/10 p-3 text-destructive">{error}</p>}
      {!catalog && !error && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={`s${i}`} className="h-28 rounded-2xl" />
          ))}
        </div>
      )}

      {groups.map((g) => (
        <section key={g.category} className="mb-6" aria-labelledby={`cat-${g.category}`}>
          <h2 id={`cat-${g.category}`} className="mb-2 text-sm font-semibold text-muted-foreground">
            {CATEGORY_LABELS[g.category]}
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {g.items.map((i) => (
              <li key={i.id}>
                <Link
                  to={browse ? `/item/${i.id}` : `/item/${i.id}/report?via=pick`}
                  className="flex h-full min-h-28 flex-col justify-between gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition hover:ring-foreground/25 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ItemIcon icon={i.icon} className="h-12 w-12 text-3xl" />
                  <span>
                    <span className="block font-semibold leading-tight">{i.name}</span>
                    <span className="block text-sm text-muted-foreground">{i.size}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {catalog && groups.length === 0 && <p className="py-10 text-center text-muted-foreground">No tracked item matches "{q}".</p>}
    </div>
  );
}
