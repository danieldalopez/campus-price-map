import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

export function PageHeader({ title, subtitle, action, back = true }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; back?: boolean }) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-2 flex items-center gap-2 bg-background/90 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      {back && (
        <button
          type="button"
          onClick={() => void (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
      )}
      <div className={back ? 'min-w-0 flex-1' : 'min-w-0 flex-1 px-2'}>
        <h1 className="truncate text-lg font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
