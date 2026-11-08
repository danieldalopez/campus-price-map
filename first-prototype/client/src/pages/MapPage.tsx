import L from 'leaflet';
import { ArrowRight, List, Map as MapIcon, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import { Link, useSearchParams } from 'react-router';
import { Button, Input, Skeleton, ToggleGroup, ToggleGroupItem } from '@databricks/appkit-ui/react';
import type { Item, MapPin, PriceLevel } from '../../../shared/types';
import { ItemIcon, LevelBadge, SoldOutTag } from '@/components/PriceBits';
import { useQuery } from '@/lib/api';
import { useCatalog } from '@/lib/catalog';
import { useOnDataChanged } from '@/lib/events';
import { LEVEL_LABEL, LEVEL_NAME, money } from '@/lib/format';
import { cn } from '@/lib/utils';

const CAMPUS_CENTER: [number, number] = [49.2635, -123.2468];

function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

const LEVEL_VAR: Record<PriceLevel, string> = { 1: 'var(--level-1)', 2: 'var(--level-2)', 3: 'var(--level-3)' };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Pins closer than this to an earlier pin get their label below the point, so neighbours don't overlap. */
const CROWDED_METERS = 150;

function crowdedIds(pins: MapPin[]): Set<string> {
  const flipped = new Set<string>();
  pins.forEach((p, i) => {
    const near = pins.slice(0, i).some((q) => !flipped.has(q.outlet.id) && L.latLng(p.outlet.lat, p.outlet.lng).distanceTo([q.outlet.lat, q.outlet.lng]) < CROWDED_METERS);
    if (near) flipped.add(p.outlet.id);
  });
  return flipped;
}

function pinIcon(pin: MapPin, selected: boolean, below: boolean): L.DivIcon {
  const color = pin.level ? LEVEL_VAR[pin.level] : 'var(--foreground)';
  const label = pin.priceCents !== null && pin.level ? `<b style="letter-spacing:.02em">${LEVEL_LABEL[pin.level]}</b>&nbsp;${money(pin.priceCents)}` : escapeHtml(pin.outlet.name);
  const soldOut = pin.stock === 'sold_out';
  const html = `
    <div style="display:flex;flex-direction:${below ? 'column-reverse' : 'column'};align-items:center;transform:translate(-50%,${below ? '-8px' : '-100%'});">
      <div style="white-space:nowrap;font:600 13px/1 var(--font-sans);padding:7px 10px;border-radius:999px;
        background:${selected ? color : 'var(--card)'};color:${selected ? 'var(--card)' : color};
        border:2px solid ${color};box-shadow:0 2px 6px rgba(11,32,38,.25);${soldOut ? 'opacity:.6;text-decoration:line-through;' : ''}">
        ${label}
      </div>
      <div style="width:2px;height:${below ? 4 : 8}px;background:${color}"></div>
      <div style="width:8px;height:8px;border-radius:999px;background:${color};border:2px solid var(--card)"></div>
    </div>`;
  return L.divIcon({ html, className: 'cpm-pin', iconSize: [0, 0], iconAnchor: [0, 0] });
}

function FitToPins({ pins }: { pins: MapPin[] }) {
  const map = useMap();
  useEffect(() => {
    if (!pins.length) return;
    const bounds = L.latLngBounds(pins.map((p) => [p.outlet.lat, p.outlet.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
  }, [map, pins.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function MapPage() {
  const [params, setParams] = useSearchParams();
  const itemId = params.get('item');
  const view = params.get('view') === 'list' ? 'list' : 'map';
  const { catalog, item } = useCatalog();
  const selectedItem = item(itemId ?? undefined);
  const { data: pins, reload } = useQuery<MapPin[]>(`/api/map${itemId ? `?item=${encodeURIComponent(itemId)}` : ''}`);
  useOnDataChanged(() => void reload());
  const [selected, setSelected] = useState<string | null>(null);
  const dark = useDarkMode();

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const sorted = useMemo(() => {
    const list = [...(pins ?? [])];
    if (itemId)
      list.sort(
        (a, b) =>
          (a.priceCents === null ? 1 : 0) - (b.priceCents === null ? 1 : 0) ||
          (a.stock === 'sold_out' ? 1 : 0) - (b.stock === 'sold_out' ? 1 : 0) ||
          (a.priceCents ?? 0) - (b.priceCents ?? 0),
      );
    return list;
  }, [pins, itemId]);

  const visiblePins = itemId ? sorted.filter((p) => p.priceCents !== null) : sorted;
  const crowded = useMemo(() => crowdedIds(visiblePins), [visiblePins]);
  const selectedPin = visiblePins.find((p) => p.outlet.id === selected) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <ItemSearch items={catalog?.items ?? []} selected={selectedItem ?? null} onSelect={(i) => {
          setSelected(null);
          setParam('item', i?.id ?? null);
        }} />
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && setParam('view', v === 'map' ? null : v)}
          className="shrink-0 rounded-xl bg-muted p-1"
          aria-label="View"
        >
          <ToggleGroupItem value="map" aria-label="Map view" className="h-11 w-11 rounded-lg data-[state=on]:bg-card">
            <MapIcon className="h-5 w-5" aria-hidden />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view" className="h-11 w-11 rounded-lg data-[state=on]:bg-card">
            <List className="h-5 w-5" aria-hidden />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {itemId && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
          {([1, 2, 3] as const).map((l) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <LevelBadge level={l} /> {LEVEL_NAME[l]} for this item
            </span>
          ))}
        </div>
      )}
      {!itemId && <p className="text-sm text-muted-foreground">Search an item to compare its price at every outlet. Each outlet is cheap for some things and pricey for others.</p>}

      {view === 'map' ? (
        <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-2xl ring-1 ring-border">
          <MapContainer center={CAMPUS_CENTER} zoom={15} className="absolute inset-0 h-full w-full" zoomControl={false} attributionControl>
            <TileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              className={dark ? 'cpm-tiles-dark' : 'cpm-tiles'}
              maxZoom={19}
            />
            {visiblePins.map((p) => (
              <Marker
                key={`${p.outlet.id}-${p.priceCents ?? 'x'}-${p.outlet.id === selected}-${crowded.has(p.outlet.id)}`}
                position={[p.outlet.lat, p.outlet.lng]}
                icon={pinIcon(p, p.outlet.id === selected, crowded.has(p.outlet.id))}
                title={p.outlet.name}
                alt={p.outlet.name}
                keyboard
                eventHandlers={{ click: () => setSelected(p.outlet.id) }}
              />
            ))}
            <FitToPins pins={visiblePins} />
          </MapContainer>
          {!pins && <Skeleton className="absolute inset-0" />}
          {selectedPin && (
            <PinCard pin={selectedPin} item={selectedItem ?? null} onClose={() => setSelected(null)} />
          )}
        </div>
      ) : (
        <ul className="space-y-2 pb-4" aria-label={selectedItem ? `Outlets selling ${selectedItem.name}` : 'Outlets'}>
          {!pins && Array.from({ length: 5 }, (_, i) => <Skeleton key={`l${i}`} className="h-16 rounded-2xl" />)}
          {sorted.map((p) => (
            <li key={p.outlet.id}>
              <Link
                to={`/outlet/${p.outlet.id}`}
                className={cn(
                  'flex min-h-16 items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border hover:ring-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  itemId && p.priceCents === null && 'opacity-60',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{p.outlet.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">{p.outlet.area}</span>
                  {p.stock === 'sold_out' && <SoldOutTag since={null} />}
                </span>
                {itemId &&
                  (p.priceCents !== null && p.level ? (
                    <span className="flex items-center gap-2">
                      <span className="tabular text-lg font-semibold">{money(p.priceCents)}</span>
                      <LevelBadge level={p.level} />
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Not sold here</span>
                  ))}
                <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PinCard({ pin, item, onClose }: { pin: MapPin; item: Item | null; onClose: () => void }) {
  return (
    <div className="absolute inset-x-3 bottom-3 z-[500] rounded-2xl bg-card p-4 shadow-lg ring-1 ring-border" role="dialog" aria-label={pin.outlet.name}>
      <button type="button" onClick={onClose} className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted" aria-label="Close">
        <X className="h-4 w-4" aria-hidden />
      </button>
      <p className="pr-10 font-semibold">{pin.outlet.name}</p>
      <p className="text-sm text-muted-foreground">
        {pin.outlet.area} · {pin.outlet.hours}
      </p>
      {item && pin.priceCents !== null && pin.level && (
        <p className="mt-2 flex items-center gap-2">
          <ItemIcon icon={item.icon} className="h-8 w-8 rounded-xl text-base" />
          <span className="text-sm">
            {item.name} {item.size}
          </span>
          <span className="tabular ml-auto text-xl font-semibold">{money(pin.priceCents)}</span>
          <LevelBadge level={pin.level} />
        </p>
      )}
      {pin.stock === 'sold_out' && <SoldOutTag since={null} />}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11" asChild>
          <Link to={`/outlet/${pin.outlet.id}`}>Outlet page</Link>
        </Button>
        {item ? (
          <Button className="h-11" asChild>
            <Link to={`/item/${item.id}`}>All prices</Link>
          </Button>
        ) : (
          <Button className="h-11" asChild>
            <Link to={`/outlet/${pin.outlet.id}`}>What's here</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function ItemSearch({ items, selected, onSelect }: { items: Item[]; selected: Item | null; onSelect: (i: Item | null) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((i) => !term || `${i.name} ${i.size}`.toLowerCase().includes(term)).slice(0, 8);
  }, [items, q]);

  const choose = (i: Item) => {
    onSelect(i);
    setQ('');
    setOpen(false);
    setEditing(false);
  };

  if (selected && !editing) {
    return (
      <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-xl bg-card pl-1.5 pr-1 ring-1 ring-border">
        <ItemIcon icon={selected.icon} className="h-9 w-9 rounded-lg text-lg" />
        <button
          type="button"
          className="min-h-11 min-w-0 flex-1 truncate text-left font-medium"
          onClick={() => {
            setEditing(true);
            setOpen(true);
          }}
          aria-label={`Searching ${selected.name} ${selected.size}. Change item`}
        >
          {selected.name} <span className="font-normal text-muted-foreground">{selected.size}</span>
        </button>
        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Clear item" onClick={() => onSelect(null)}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    );
  }

  const showList = open && matches.length > 0;
  const activeIndex = Math.min(active, matches.length - 1);

  return (
    <div
      ref={wrapRef}
      className="relative min-w-0 flex-1"
      onBlur={(e) => {
        // Close only when focus leaves the whole widget.
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
          setEditing(false);
        }
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        autoFocus={editing}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && showList) {
            e.preventDefault();
            choose(matches[activeIndex]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setEditing(false);
          }
        }}
        placeholder="What do you want?"
        aria-label="What do you want?"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList ? `${listId}-${activeIndex}` : undefined}
        className="h-12 rounded-xl pl-10 text-base"
      />
      {showList && (
        <ul id={listId} role="listbox" aria-label="Items" className="absolute inset-x-0 top-14 z-[600] max-h-80 overflow-y-auto rounded-xl bg-popover p-1 shadow-lg ring-1 ring-border">
          {matches.map((i, idx) => (
            <li
              key={i.id}
              id={`${listId}-${idx}`}
              role="option"
              aria-selected={idx === activeIndex}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(idx)}
              onClick={() => choose(i)}
              className={cn('flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2', idx === activeIndex && 'bg-muted')}
            >
              <ItemIcon icon={i.icon} className="h-9 w-9 rounded-lg text-lg" />
              <span>
                <span className="font-medium">{i.name}</span> <span className="text-muted-foreground">{i.size}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
