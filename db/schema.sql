-- Campus Price Map: Lakebase (Postgres 17) schema. docs/SPEC.md section 6.
-- Run as the owner role, in this order: schema.sql, views.sql, roles.sql, seed.sql.
-- Rows in prices, price_votes and stock_reports are never updated: statuses are computed in views.sql.

create table locations (
  id                 text primary key,                 -- slug, e.g. 'blue-chip-cafe'
  name               text not null,
  area               text,
  operator           text not null check (operator in ('ams','ubc_food_services','chain','independent')),
  type               text not null check (type in ('cafe','convenience','quick_service','restaurant','dining_hall','grocery')),
  address            text,
  hours              text,                              -- as listed, e.g. 'M-F: 7 am - 7 pm; Sat-Sun: 9 am - 5 pm'
  lat                double precision not null,
  lng                double precision not null,
  is_benchmark       boolean not null default false,    -- grocery baseline, never ranked
  poi_id             text,                              -- UBC Wayfinding POI, e.g. 'VPOI10094'
  location_precision text not null default 'exact' check (location_precision in ('exact','building','area'))
);

create table items (
  id        text primary key,                           -- 'I01' .. 'I23'
  name      text not null,
  size      text not null,
  volume_ml int,
  category  text not null,
  image     text,                                       -- '/items/I01.webp'
  aliases   text not null default ''                    -- search aliases, pipe separated
);

-- seed = undated AI-estimated prototype prices, treated as official (see verification rules)
create type price_source as enum ('walk','menu','grocery','seed','photo','receipt','typed');

create table prices (
  id           bigint generated always as identity primary key,
  item_id      text not null references items(id),
  location_id  text not null references locations(id),
  price        numeric(6,2) not null check (price between 0.25 and 25),
  source       price_source not null,
  device_id    text check (device_id ~ '^[0-9a-f-]{36}$'),   -- null for team and seed rows
  user_id      text,                                          -- Auth0 user id after Step 12
  needs_review boolean not null default false,
  reported_at  timestamptz not null default now()
);

create table price_votes (
  id         bigint generated always as identity primary key,
  price_id   bigint not null references prices(id),
  device_id  text not null check (device_id ~ '^[0-9a-f-]{36}$'),
  user_id    text,
  vote       text not null check (vote in ('yes','no','unsure')),
  created_at timestamptz not null default now(),
  unique (price_id, device_id)
);

create table stock_reports (
  id          bigint generated always as identity primary key,
  item_id     text not null references items(id),
  location_id text not null references locations(id),
  status      text not null check (status in ('sold_out','back')),
  device_id   text not null check (device_id ~ '^[0-9a-f-]{36}$'),
  user_id     text,
  reported_at timestamptz not null default now()
);

create table carries (                                   -- what each outlet sells, priced or not
  item_id     text not null references items(id),
  location_id text not null references locations(id),
  primary key (item_id, location_id)
);

create table menu_items (                                -- every menu line we have, tracked or not (Genie, browsing)
  id          bigint generated always as identity primary key,
  location_id text not null references locations(id),
  category    text,
  item        text not null,
  variant     text,
  price       numeric(7,2) not null,
  source      price_source not null,
  reported_on date not null,
  item_ids    text not null default ''                  -- tracked items this line counts as, pipe separated
);

create table app_config (                                -- numbers both the app and Databricks use
  key        text primary key,
  value      text not null,
  source     text,
  updated_at timestamptz not null default now()
);

create table walk_matrix (                               -- outlet to outlet walking, filled later
  from_id   text not null references locations(id),
  to_id     text not null references locations(id),
  meters    int not null,
  minutes   numeric(5,1) not null,
  step_free boolean not null default false,
  source    text not null check (source in ('ubc_paths','ors','haversine')),
  primary key (from_id, to_id, step_free)
);

create table photo_reads (                               -- rate limiting only; no image, no result
  id         bigint generated always as identity primary key,
  device_id  text not null check (device_id ~ '^[0-9a-f-]{36}$'),
  created_at timestamptz not null default now()
);

create index prices_item_loc_time on prices (item_id, location_id, reported_at desc);
create index prices_device_time   on prices (device_id, reported_at desc);
create index votes_price          on price_votes (price_id);
create index votes_device_time    on price_votes (device_id, created_at desc);
create index stock_item_loc_time  on stock_reports (item_id, location_id, reported_at desc);
create index stock_device_time    on stock_reports (device_id, reported_at desc);
create index photo_reads_device   on photo_reads (device_id, created_at desc);
create index menu_items_location  on menu_items (location_id);
