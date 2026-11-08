-- Campus Price Map: verification and stock views. docs/SPEC.md section 6, "Verification: Pending vs Official".
-- Statuses are computed here, never stored, so app_writer can stay insert only.
-- The Databricks pipeline applies the same rules (gold_price_status) and gold_parity checks the two agree.

-- "A different student": a different user_id when both rows have one, otherwise a different device_id.
-- Team and seed rows (no device, no user) count as nobody.
create or replace function different_student(u1 text, d1 text, u2 text, d2 text)
returns boolean language sql immutable as $$
  select case
    when (u1 is null and d1 is null) or (u2 is null and d2 is null) then false
    when u1 is not null and u2 is not null then u1 <> u2
    else d1 is distinct from d2
  end
$$;

-- One row per price with its status.
--  1. official  if the source is team or prototype data (walk, menu, grocery, seed)
--  2. rejected  if no >= 1 and no > yes
--  3. official  if (yes > no and yes >= 1) or a matching report exists, with at least
--               1 confirmation (2 when needs_review). Matching report: a different student reported
--               the same item and outlet within $0.10 and 48 h.
--  4. pending   otherwise. 'unsure' votes never count.
create or replace view price_status as
with votes as (
  select v.price_id,
         count(distinct coalesce(v.user_id, v.device_id)) filter (where v.vote = 'yes') as yes,
         count(distinct coalesce(v.user_id, v.device_id)) filter (where v.vote = 'no')  as no,
         max(v.created_at) filter (where v.vote = 'yes')                                   as last_yes_at
  from price_votes v
  join prices p on p.id = v.price_id
  where different_student(v.user_id, v.device_id, p.user_id, p.device_id)
  group by v.price_id
),
matches as (
  select p.id as price_id,
         count(distinct coalesce(q.user_id, q.device_id)) as n,
         max(q.reported_at)                              as last_match_at
  from prices p
  join prices q
    on q.item_id = p.item_id
   and q.location_id = p.location_id
   and q.id <> p.id
   and q.source in ('photo', 'receipt', 'typed')
   and abs(q.price - p.price) <= 0.10
   and q.reported_at between p.reported_at - interval '48 hours' and p.reported_at + interval '48 hours'
   and different_student(q.user_id, q.device_id, p.user_id, p.device_id)
  where p.source in ('photo', 'receipt', 'typed')
  group by p.id
)
select p.id                                    as price_id,
       p.item_id, p.location_id, p.price, p.source, p.device_id, p.user_id, p.needs_review, p.reported_at,
       coalesce(v.yes, 0)                      as yes,
       coalesce(v.no, 0)                       as no,
       coalesce(m.n, 0)                        as matches,
       coalesce(v.yes, 0) + coalesce(m.n, 0)   as confirmations,
       case
         when p.source in ('walk', 'menu', 'grocery', 'seed') then 'official'
         when coalesce(v.no, 0) >= 1 and coalesce(v.no, 0) > coalesce(v.yes, 0) then 'rejected'
         when ((coalesce(v.yes, 0) > coalesce(v.no, 0) and coalesce(v.yes, 0) >= 1) or coalesce(m.n, 0) >= 1)
              and coalesce(v.yes, 0) + coalesce(m.n, 0) >= case when p.needs_review then 2 else 1 end
           then 'official'
         else 'pending'
       end                                     as status,
       greatest(p.reported_at, v.last_yes_at, m.last_match_at) as updated_at
from prices p
left join votes   v on v.price_id = p.id
left join matches m on m.price_id = p.id;

-- Newest official price per item and outlet.
create or replace view current_prices as
select distinct on (item_id, location_id)
       item_id, location_id, price_id, price, source, confirmations, reported_at, updated_at
from price_status
where status = 'official'
order by item_id, location_id, reported_at desc, price_id desc;

-- Newest pending price per item and outlet that is newer than its official price. Always read live.
create or replace view pending_prices as
select distinct on (s.item_id, s.location_id)
       s.item_id, s.location_id, s.price_id, s.price, s.device_id, s.user_id, s.confirmations, s.reported_at
from price_status s
left join current_prices c on c.item_id = s.item_id and c.location_id = s.location_id
where s.status = 'pending'
  and (c.reported_at is null or s.reported_at > c.reported_at)
order by s.item_id, s.location_id, s.reported_at desc, s.price_id desc;

-- Campus median per item over non-benchmark outlets (price bands in live mode).
create or replace view item_medians as
select c.item_id,
       count(*)                                                          as n_outlets,
       percentile_cont(0.5) within group (order by c.price)::numeric(6,2) as campus_median,
       min(c.price)                                                      as campus_min
from current_prices c
join locations l on l.id = c.location_id
where not l.is_benchmark
group by c.item_id;

-- Stock per item and outlet that has reports since its last 'back'. Pairs not listed are in stock.
-- sold_out: 2+ different students in the last 4 h. maybe_sold_out: 1+ in the last 2 h.
create or replace view stock_status as
with last_back as (
  select item_id, location_id, max(reported_at) as at
  from stock_reports
  where status = 'back'
  group by item_id, location_id
),
recent as (
  select s.item_id, s.location_id,
         count(distinct coalesce(s.user_id, s.device_id)) filter (where s.reported_at > now() - interval '4 hours') as n4,
         count(distinct coalesce(s.user_id, s.device_id)) filter (where s.reported_at > now() - interval '2 hours') as n2,
         max(s.reported_at) as last_sold_out_at
  from stock_reports s
  left join last_back b on b.item_id = s.item_id and b.location_id = s.location_id
  where s.status = 'sold_out'
    and (b.at is null or s.reported_at > b.at)
  group by s.item_id, s.location_id
)
select item_id, location_id,
       case when n4 >= 2 then 'sold_out' when n2 >= 1 then 'maybe_sold_out' else 'in_stock' end as stock,
       last_sold_out_at
from recent;
