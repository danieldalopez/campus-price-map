-- Add Red Bull 473 ml (I24) to the live database, without re-running the whole seed.
-- Run once in the Lakebase SQL editor as the owner (the same role that ran db/seed.sql). Safe to run twice:
-- every insert skips rows that are already there, and it's all one transaction.
-- Generated from data/items.csv, data/prices.csv and data/carries.csv after scripts/build_seed.py added I24.

begin;

insert into items (id, name, size, volume_ml, category, image, aliases)
values ('I24', 'Red Bull', '473 ml can', 473, 'Energy drinks', '/items/I24.webp', 'red bull 473|tall red bull|large red bull')
on conflict (id) do nothing;

-- The 16 menu prices (undated, so source 'seed' like the rest of the prototype data).
insert into prices (item_id, location_id, price, source, reported_at)
select 'I24', v.location_id, v.price, 'seed'::price_source, timestamptz '2026-11-07 12:00:00-08'
from (values
    ('avenue-c-neville-scarfe', 5.79),
    ('corner-store', 5.79),
    ('gage-market', 6.29),
    ('grocery-checkout', 5.69),
    ('h-mart', 5.09),
    ('harvest-market', 5.59),
    ('hero-coffee-market', 6.19),
    ('hero-harvest', 5.99),
    ('hubbards-global-market', 5.79),
    ('ins-market', 5.50),
    ('magda-s-night-market', 5.79),
    ('prime-news', 5.99),
    ('save-on-foods-wesbrook-village', 4.99),
    ('shoppers-drug-mart-university-blvd', 5.39),
    ('shoppers-drug-mart-wesbrook-village', 5.59),
    ('thirstyyy', 5.89)
) as v(location_id, price)
join locations l on l.id = v.location_id
where not exists (
  select 1 from prices p
  where p.item_id = 'I24' and p.location_id = v.location_id and p.source = 'seed' and p.price = v.price
);

insert into carries (item_id, location_id)
select 'I24', v.location_id
from (values
    ('avenue-c-neville-scarfe'),
    ('corner-store'),
    ('gage-market'),
    ('grocery-checkout'),
    ('h-mart'),
    ('harvest-market'),
    ('hero-coffee-market'),
    ('hero-harvest'),
    ('hubbards-global-market'),
    ('ins-market'),
    ('magda-s-night-market'),
    ('prime-news'),
    ('save-on-foods-wesbrook-village'),
    ('shoppers-drug-mart-university-blvd'),
    ('shoppers-drug-mart-wesbrook-village'),
    ('thirstyyy')
) as v(location_id)
join locations l on l.id = v.location_id
on conflict do nothing;

-- Menu lines for Red Bull 473 ml now count as I24 (Genie and the full menus read item_ids).
update menu_items
set item_ids = case when item_ids = '' then 'I24' else item_ids || '|I24' end
where item = 'Red Bull Energy Drink' and variant = '473 ml' and item_ids not like '%I24%';

commit;

-- Check: expect 1, 16, 16, 16.
select (select count(*) from items where id = 'I24') as items,
       (select count(*) from prices where item_id = 'I24') as prices,
       (select count(*) from carries where item_id = 'I24') as carries,
       (select count(*) from menu_items where item_ids like '%I24%') as menu_lines;
