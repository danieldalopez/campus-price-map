import { BadgeCheck, HandHeart, Lock, Megaphone, ShieldCheck, UsersRound } from 'lucide-react';
import { Skeleton, ToggleGroup, ToggleGroupItem } from '@databricks/appkit-ui/react';
import type { MyStats } from '../../../shared/types';
import { PageHeader } from '@/components/PageHeader';
import { useQuery } from '@/lib/api';
import { useOnDataChanged } from '@/lib/events';
import { students } from '@/lib/format';
import { PERSONAS, setPersona, usePersona, type PersonaKey } from '@/lib/student';

const TRUST_COPY: Record<MyStats['trust'], { title: string; body: string }> = {
  new: { title: 'New contributor', body: 'Your reports need the usual number of confirmations. Keep sharing and this improves.' },
  trusted: { title: 'Trusted contributor', body: 'Your reports are usually confirmed, so they need one fewer confirmation.' },
  standard: { title: 'Contributor', body: 'Your reports need the usual number of confirmations.' },
  needs_more_checks: { title: 'Extra checks on', body: 'Several recent reports were not confirmed, so yours need one extra confirmation for now.' },
};

export function MePage() {
  const persona = usePersona();
  const { data, reload } = useQuery<MyStats>('/api/me');
  useOnDataChanged(() => void reload());

  return (
    <div className="mx-auto max-w-2xl pb-6">
      <PageHeader title="Your impact" subtitle="This week on Campus Price Map" back={false} />

      {!data ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={`m${i}`} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {data.studentsHelped > 0 && (
            <section className="mb-3 rounded-2xl bg-[var(--primary)] p-5 text-[var(--primary-foreground)]">
              <HandHeart className="mb-2 h-7 w-7 text-[var(--brand)]" aria-hidden />
              <p className="text-xl font-semibold leading-snug">You helped {students(data.studentsHelped)} who searched the items you checked this week.</p>
            </section>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Stat icon={<BadgeCheck className="h-5 w-5" aria-hidden />} value={data.confirmationsThisWeek} label={`price${data.confirmationsThisWeek === 1 ? '' : 's'} you helped confirm`} />
            <Stat icon={<Megaphone className="h-5 w-5" aria-hidden />} value={data.reportsThisWeek} label={`price${data.reportsThisWeek === 1 ? '' : 's'} you shared`} />
            <Stat icon={<UsersRound className="h-5 w-5" aria-hidden />} value={data.pricesWentLive} label="of your reports went live" />
            <Stat icon={<ShieldCheck className="h-5 w-5" aria-hidden />} value={TRUST_COPY[data.trust].title} label={TRUST_COPY[data.trust].body} small />
          </div>
          {data.confirmationsThisWeek + data.reportsThisWeek === 0 && (
            <p className="mt-4 rounded-2xl bg-muted p-4 text-sm">
              Confirming is the easiest way to help: when you see "Is that right?" on an item, one tap keeps prices fresh for everyone.
            </p>
          )}
        </>
      )}

      <section className="mt-6 rounded-2xl bg-card p-4 ring-1 ring-border" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" className="mb-1 flex items-center gap-2 text-base font-semibold">
          <Lock className="h-4 w-4" aria-hidden /> Privacy
        </h2>
        <p className="text-sm text-muted-foreground">
          No name or account needed. Your phone gets a random ID so your reports can be confirmed by someone else. Receipt photos stay on your phone and are
          never uploaded.
        </p>
      </section>

      <section className="mt-3 rounded-2xl border border-dashed p-4" aria-labelledby="demo-heading">
        <h2 id="demo-heading" className="text-base font-semibold">
          Demo: act as another student
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Only someone else can confirm a report. Switch student to try the full loop on one device.
        </p>
        <ToggleGroup
          type="single"
          value={persona}
          onValueChange={(v) => v && setPersona(v as PersonaKey)}
          className="grid w-full grid-cols-3 gap-2"
          aria-label="Demo student"
        >
          {PERSONAS.map((p) => (
            <ToggleGroupItem
              key={p.key}
              value={p.key}
              className="h-11 rounded-xl bg-muted data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {p.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>

      <p className="mt-6 px-1 text-xs text-muted-foreground">
        First prototype (v0.1.0) with sample data: outlet prices, hours and BC averages are illustrative, not real quotes or StatCan figures.
      </p>
    </div>
  );
}

function Stat({ icon, value, label, small }: { icon: React.ReactNode; value: number | string; label: string; small?: boolean }) {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-muted">{icon}</span>
      <p className={small ? 'font-semibold' : 'tabular text-3xl font-semibold'}>{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
