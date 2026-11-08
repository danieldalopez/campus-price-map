import { Delete } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

const MAX_DIGITS = 4; // up to $99.99

/** Cash-register style entry: digits fill from the right, so "349" reads $3.49. */
export function priceFromDigits(digits: string): number {
  return digits ? Number(digits) : 0;
}

export function digitsFromCents(cents: number | null): string {
  return cents && cents > 0 ? String(cents) : '';
}

export function PriceDisplay({ digits, className }: { digits: string; className?: string }) {
  const cents = priceFromDigits(digits);
  return (
    <output
      aria-live="polite"
      aria-label={`Price ${(cents / 100).toFixed(2)} dollars`}
      className={cn('tabular block text-center font-semibold tracking-tight', cents ? 'text-foreground' : 'text-muted-foreground', className)}
    >
      ${(cents / 100).toFixed(2)}
    </output>
  );
}

export function NumberPad({
  digits,
  onChange,
  compact = false,
}: {
  digits: string;
  onChange: (next: string) => void;
  compact?: boolean;
}) {
  const press = (d: string) => {
    if (digits.length >= MAX_DIGITS) return;
    const next = (digits + d).replace(/^0+/, '');
    onChange(next);
  };
  const back = () => onChange(digits.slice(0, -1));

  // Physical keyboard support for desktop demos.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        if (digits.length < MAX_DIGITS) onChange((digits + e.key).replace(/^0+/, ''));
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        onChange(digits.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [digits, onChange]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const keyClass = cn(
    'tabular flex items-center justify-center rounded-2xl bg-card text-2xl font-medium text-foreground shadow-[0_1px_0_var(--border)] ring-1 ring-border transition active:scale-[0.97] active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    compact ? 'h-12' : 'h-14 sm:h-16',
  );

  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Number pad">
      {keys.map((k) => (
        <button key={k} type="button" className={keyClass} onClick={() => press(k)}>
          {k}
        </button>
      ))}
      <span aria-hidden />
      <button type="button" className={keyClass} onClick={() => press('0')}>
        0
      </button>
      <button type="button" className={keyClass} onClick={back} aria-label="Delete last digit" disabled={!digits}>
        <Delete className="h-6 w-6" aria-hidden />
      </button>
    </div>
  );
}
