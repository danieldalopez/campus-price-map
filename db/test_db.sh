#!/bin/bash
# Tests db/*.sql on a throwaway local Postgres 17. Start one first, e.g.:
#   initdb -D /tmp/cpm-pg -U owner --auth=trust && LC_ALL=en_US.UTF-8 pg_ctl -D /tmp/cpm-pg -o "-p 54329 -c listen_addresses=127.0.0.1" start
# then: bash db/test_db.sh   (never point this at Lakebase: it drops and recreates database cpm)
set -u
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 PGHOST=127.0.0.1 PGPORT=54329 PGUSER=owner
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
SP="$(mktemp -d)"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
psql() { "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 "$@"; }
q() { "$PGBIN/psql" -X -At -d cpm -c "$1"; }
as() { PGPASSWORD="$2" "$PGBIN/psql" -X -q -At -h 127.0.0.1 -U "$1" -d cpm -c "$3" 2>&1; }

"$PGBIN/dropdb" --if-exists cpm 2>/dev/null; "$PGBIN/psql" -X -q -d postgres -c "drop role if exists app_reader; drop role if exists app_writer;" >/dev/null
"$PGBIN/createdb" cpm || exit 1

echo "== roles.sql unmodified must refuse:"
psql -d cpm -f "$REPO/db/roles.sql" 2>&1 | grep -o "ERROR:.*" || echo "FAIL: NOT REFUSED"

psql -d cpm -f "$REPO/db/schema.sql" -f "$REPO/db/views.sql" || exit 1
sed -e "s/<READER_PASSWORD>/test-reader-pw/g" -e "s/<WRITER_PASSWORD>/test-writer-pw/g" "$REPO/db/roles.sql" > "$SP/roles.test.sql"
psql -d cpm -f "$SP/roles.test.sql" -f "$REPO/db/seed.sql" || exit 1

echo "== counts"
q "select 'locations', count(*) from locations union all select 'items',count(*) from items
   union all select 'prices',count(*) from prices union all select 'current_prices',count(*) from current_prices
   union all select 'pending_prices',count(*) from pending_prices union all select 'menu_items',count(*) from menu_items
   union all select 'carries',count(*) from carries union all select 'app_config',count(*) from app_config"
echo "== medians I01 I04 I08"
q "select * from item_medians where item_id in ('I01','I04','I08') order by 1"

echo "== permissions"
echo "reader select view: $(as app_reader test-reader-pw "select count(*) from current_prices")"
echo "reader insert (must fail): $(as app_reader test-reader-pw "insert into photo_reads(device_id) values ('11111111-1111-1111-1111-111111111111')" | grep -o 'permission denied.*' || echo FAIL)"
echo "writer insert returning id: $(as app_writer test-writer-pw "insert into prices(item_id,location_id,price,source,device_id) values ('I01','blue-chip-cafe',3.25,'photo','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') returning id")"
echo "writer update (must fail): $(as app_writer test-writer-pw "update prices set price=1 where id=1" | grep -o 'permission denied.*' || echo FAIL)"
echo "writer select price (must fail): $(as app_writer test-writer-pw "select price from prices limit 1" | grep -o 'permission denied.*' || echo FAIL)"
echo "writer delete (must fail): $(as app_writer test-writer-pw "delete from prices where id=1" | grep -o 'permission denied.*' || echo FAIL)"
echo "price 30 rejected by check (must fail): $(as app_writer test-writer-pw "insert into prices(item_id,location_id,price,source,device_id) values ('I01','blue-chip-cafe',30,'photo','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')" | grep -o 'violates check.*' || echo FAIL)"

echo "== verification rules (fake students A..F, item I01 at harvest-market)"
A=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1; B=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2; C=cccccccc-cccc-cccc-cccc-ccccccccccc3
E=eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5; F=ffffffff-ffff-ffff-ffff-fffffffffff6
st() { q "select status||' yes='||yes||' no='||no||' matches='||matches from price_status where price_id=$1"; }
ins() { as app_writer test-writer-pw "insert into prices(item_id,location_id,price,source,device_id,needs_review) values ('$1','harvest-market',$2,'photo','$3',$4) returning id"; }
vote() { as app_writer test-writer-pw "insert into price_votes(price_id,device_id,vote) values ($1,'$2','$3') returning id" >/dev/null; }

p1=$(ins I01 3.25 $A false); echo "new report           -> $(st $p1) (expect pending)"
vote $p1 $A yes;             echo "self yes vote        -> $(st $p1) (expect pending, self ignored)"
echo "pending_prices has it -> $(q "select count(*) from pending_prices where price_id=$p1") (expect 1)"
vote $p1 $B yes;             echo "other student yes    -> $(st $p1) (expect official)"
echo "current price now     -> $(q "select price||' '||source from current_prices where item_id='I01' and location_id='harvest-market'") (expect 3.25 photo)"

p2=$(ins I02 2.50 $A false); vote $p2 $B yes; vote $p2 $C no
echo "tie 1 yes / 1 no     -> $(st $p2) (expect pending)"
vote $p2 $E no;              echo "1 yes / 2 no         -> $(st $p2) (expect rejected)"

p3=$(ins I04 2.00 $A false); p4=$(ins I04 2.05 $B false)
echo "matching reports     -> $(st $p3) / $(st $p4) (expect official / official)"

p5=$(ins I05 9.00 $A true); vote $p5 $B yes
echo "needs_review, 1 yes  -> $(st $p5) (expect pending)"
vote $p5 $C yes;             echo "needs_review, 2 yes  -> $(st $p5) (expect official)"

p6=$(ins I06 1.00 $A false); vote $p6 $B unsure
echo "only unsure vote     -> $(st $p6) (expect pending)"

p7=$(ins I19 2.00 $A false); vote $p7 $B no
p8=$(ins I19 2.05 $C false)
echo "match vs rejected    -> $(st $p7) / $(st $p8) (expect rejected / pending: a voted-down report confirms nothing)"

s1=$(q "select id from prices where source='seed' order by id limit 1")
s2=$(q "select id from prices where source='seed' order by id limit 1 offset 1")
pair1=$(q "select item_id||'@'||location_id from prices where id=$s1")
vote $s2 $A yes;             echo "seed price, 1 yes    -> $(st $s2) (expect official yes=1)"
vote $s1 $A no;              echo "seed price, 1 no     -> $(st $s1) (expect rejected)"
echo "rejected seed gone    -> $(q "select count(*) from current_prices where price_id=$s1") current row for $pair1 (expect 0)"
echo "benchmark prices      -> $(q "select count(*) from prices p join locations l on l.id=p.location_id where l.is_benchmark and p.source='seed'") seed rows (expect 0)"

echo "== stock"
so() { as app_writer test-writer-pw "insert into stock_reports(item_id,location_id,status,device_id) values ('I01','corner-store','$2','$1') returning id" >/dev/null; }
sstat() { q "select coalesce((select stock from stock_status where item_id='I01' and location_id='corner-store'),'in_stock')"; }
so $A sold_out; echo "1 sold out           -> $(sstat) (expect maybe_sold_out)"
so $B sold_out; echo "2 sold out           -> $(sstat) (expect sold_out)"
sleep 1; so $F back; echo "back after           -> $(sstat) (expect in_stock)"
