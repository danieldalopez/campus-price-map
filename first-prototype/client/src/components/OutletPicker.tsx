import { Check, MapPin } from 'lucide-react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@databricks/appkit-ui/react';
import type { Outlet } from '../../../shared/types';
import { cn } from '@/lib/utils';

export function OutletPicker({
  open,
  onOpenChange,
  outlets,
  selectedId,
  onSelect,
  title = 'Which outlet are you in?',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outlets: Outlet[];
  selectedId: string | null;
  onSelect: (outlet: Outlet) => void;
  title?: string;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-md">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>Prices are compared product by product across campus.</DrawerDescription>
          </DrawerHeader>
          <ul className="max-h-[60vh] overflow-y-auto px-2 pb-6">
            {outlets.map((o) => {
              const selected = o.id === selectedId;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(o);
                      onOpenChange(false);
                    }}
                    className={cn(
                      'flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected && 'bg-muted',
                    )}
                    aria-pressed={selected}
                  >
                    <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{o.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">{o.area}</span>
                    </span>
                    {selected && <Check className="h-5 w-5 text-[var(--brand)]" aria-label="Selected" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
