import { createContext, useContext, type ReactNode } from 'react';
import type { Catalog, Item, Outlet } from '../../../shared/types';
import { useQuery } from './api';

interface CatalogContextValue {
  catalog: Catalog | null;
  error: string | null;
  item: (id: string | undefined) => Item | undefined;
  outlet: (id: string | null | undefined) => Outlet | undefined;
  reload: () => Promise<void>;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useQuery<Catalog>('/api/catalog');
  const value: CatalogContextValue = {
    catalog: data,
    error,
    item: (id) => data?.items.find((i) => i.id === id),
    outlet: (id) => (id ? data?.outlets.find((o) => o.id === id) : undefined),
    reload,
  };
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogContextValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used inside CatalogProvider');
  return ctx;
}
