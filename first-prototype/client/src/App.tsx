import { Grid3X3, Map as MapIcon, ScanLine, UserRound } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, NavLink, Outlet, RouterProvider, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import { BoughtItSheet } from '@/components/BoughtItSheet';
import { CatalogProvider, useCatalog } from '@/lib/catalog';
import { cn } from '@/lib/utils';
import { MePage } from '@/pages/MePage';
import { OutletPage } from '@/pages/OutletPage';
import { PickItemPage } from '@/pages/PickItemPage';
import { ReportPage } from '@/pages/ReportPage';
import { ResultsPage } from '@/pages/ResultsPage';
import { ScanPage } from '@/pages/ScanPage';

// The map (Leaflet) loads on demand so the scanner home screen opens fast.
const MapPage = lazy(() => import('@/pages/MapPage').then((m) => ({ default: m.MapPage })));

const TABS = [
  { to: '/', label: 'Scan', icon: ScanLine, end: true },
  { to: '/map', label: 'Map', icon: MapIcon, end: false },
  { to: '/items', label: 'Items', icon: Grid3X3, end: false },
  { to: '/me', label: 'You', icon: UserRound, end: false },
] as const;

function Shell() {
  const { error, reload } = useCatalog();
  const { pathname } = useLocation();
  const isMap = pathname.startsWith('/map');

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <p
        role="note"
        className="bg-[var(--primary)] px-4 py-1 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--primary-foreground)]"
      >
        First prototype · sample data
      </p>
      <main className={cn('mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4', isMap && 'flex h-dvh min-h-0 flex-col pb-20')}>
        {error && (
          <div className="mb-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            Couldn't reach Campus Price Map. {error}{' '}
            <button type="button" className="font-semibold underline" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        )}
        <Outlet />
      </main>

      <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
        <ul className="mx-auto grid h-16 max-w-md grid-cols-4">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex h-full flex-col items-center justify-center gap-0.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition', isActive && 'bg-[var(--brand-soft)] text-[var(--brand-ink)]')}>
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <BoughtItSheet />
      <Toaster position="top-center" richColors={false} closeButton toastOptions={{ className: 'font-sans' }} />
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: (
      <CatalogProvider>
        <Shell />
      </CatalogProvider>
    ),
    children: [
      { path: '/', element: <ScanPage /> },
      { path: '/items', element: <PickItemPage /> },
      { path: '/item/:itemId', element: <ResultsPage /> },
      { path: '/item/:itemId/report', element: <ReportPage /> },
      {
        path: '/map',
        element: (
          <Suspense fallback={<div className="h-full min-h-[420px] animate-pulse rounded-2xl bg-muted" />}>
            <MapPage />
          </Suspense>
        ),
      },
      { path: '/outlet/:outletId', element: <OutletPage /> },
      { path: '/me', element: <MePage /> },
      { path: '*', element: <ScanPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
