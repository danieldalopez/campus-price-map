-- Campus Price Map: app roles. docs/SPEC.md sections 5 and 6, guardrail G6.
-- Native Postgres password roles, because Lakebase OAuth tokens expire after 1 hour and Vercel holds a
-- static connection string. If CREATE ROLE ... PASSWORD is refused, turn on native Postgres login in the
-- Lakebase project settings.
--
-- Before running: replace <READER_PASSWORD> and <WRITER_PASSWORD> below with long random passwords
-- (e.g. `openssl rand -base64 32`). Never commit the real values; they go only in .env.local and Vercel.

do $$
begin
  if '<READER_PASSWORD>' like '<%' or '<WRITER_PASSWORD>' like '<%' then
    raise exception 'Replace <READER_PASSWORD> and <WRITER_PASSWORD> in roles.sql before running it';
  end if;
end
$$;

create role app_reader login password '<READER_PASSWORD>';
create role app_writer login password '<WRITER_PASSWORD>';

grant usage on schema public to app_reader, app_writer;

-- Reader: select on every table and view, now and later (created by this owner).
grant select on all tables in schema public to app_reader;
alter default privileges in schema public grant select on tables to app_reader;

-- Writer: insert only, on four tables. select(id) lets INSERT ... RETURNING id work; nothing else is readable.
grant insert on prices, price_votes, stock_reports, photo_reads to app_writer;
grant select (id) on prices, price_votes, stock_reports, photo_reads to app_writer;

-- Synced Databricks tables land in schema "serving" (section 10). Run once it exists, and again after a
-- snapshot sync if the grants disappear (databricks/src/04_grants.py automates this):
--   grant usage on schema serving to app_reader;
--   grant select on all tables in schema serving to app_reader;
