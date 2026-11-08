import { CircleCheck, Clock3, PackageX } from 'lucide-react';
import type { PriceLevel } from '../../../shared/types';
import { LEVEL_LABEL, LEVEL_NAME, students, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

const LEVEL_STYLE: Record<PriceLevel, string> = {
  1: 'bg-[var(--level-1-soft)] text-[var(--level-1)]',
  2: 'bg-[var(--level-2-soft)] text-[var(--level-2)]',
  3: 'bg-[var(--level-3-soft)] text-[var(--level-3)]',
};

/** $ / $$ / $$$ chip. The label carries the meaning; colour reinforces it. */
export function LevelBadge({ level, className }: { level: PriceLevel; className?: string }) {
  return (
    <span
      className={cn('inline-flex h-6 min-w-9 items-center justify-center rounded-full px-2 text-xs font-bold tracking-wide', LEVEL_STYLE[level], className)}
      title={LEVEL_NAME[level]}
    >
      <span aria-hidden>{LEVEL_LABEL[level]}</span>
      <span className="sr-only">{LEVEL_NAME[level]}</span>
    </span>
  );
}

/** "Confirmed by 3 students, 20 min ago", faded when stale. */
export function Freshness({
  confirmedBy,
  confirmedAt,
  stale,
  className,
}: {
  confirmedBy: number;
  confirmedAt: string | null;
  stale: boolean;
  className?: string;
}) {
  if (!confirmedAt) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
      {stale ? <Clock3 className="h-3.5 w-3.5" aria-hidden /> : <CircleCheck className="h-3.5 w-3.5" aria-hidden />}
      {stale ? `Last confirmed ${timeAgo(confirmedAt)}, may be out of date` : `Confirmed by ${students(confirmedBy)}, ${timeAgo(confirmedAt)}`}
    </span>
  );
}

export function SoldOutTag({ since, possibly }: { since: string | null; possibly?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        possibly ? 'bg-[var(--level-2-soft)] text-[var(--level-2)]' : 'bg-muted text-foreground',
      )}
    >
      <PackageX className="h-3.5 w-3.5" aria-hidden />
      {possibly ? 'Might be sold out' : `Sold out here${since ? `, ${timeAgo(since)}` : ''}`}
    </span>
  );
}

export function ItemIcon({ icon, className }: { icon: string; className?: string }) {
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-2xl bg-muted text-2xl', className ?? 'h-12 w-12')}>
      {icon}
    </span>
  );
}
