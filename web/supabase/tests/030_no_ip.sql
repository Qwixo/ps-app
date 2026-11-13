-- Checks for migration 030 (no IP addresses). LOCAL TEST DATABASE ONLY, never the live vault.
-- Run as the postgres user after applying migrations 001 to 030 on an empty local Supabase:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/030_no_ip.sql
-- Everything runs in one transaction and is rolled back at the end. Any failed check raises and stops.
begin;

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;

insert into public.signup_allowances (email, expires_at) values ('ipcheck@t.test', now() + interval '1 minute');
insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-0000000000f1', 'ipcheck@t.test', 'authenticated', 'authenticated');

-- A sign in as Supabase Auth writes it: the IP and the full User-Agent of a Mac browser.
insert into auth.sessions (id, user_id, created_at, updated_at, ip, user_agent) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', now(), now(), '203.0.113.7',
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15');
select pg_temp.check((select ip from auth.sessions where id = '00000000-0000-0000-0000-0000000000a1') is null, 'a new session keeps no IP');
select pg_temp.check((select user_agent from auth.sessions where id = '00000000-0000-0000-0000-0000000000a1') = 'Mac', 'a new session keeps only the device name');
select pg_temp.check((select count(*) from public.access_log where user_id = '00000000-0000-0000-0000-0000000000f1' and ip is null and user_agent = 'Mac') = 1, 'the Sign-in log gets the time and "Mac", no IP');

-- A token refresh writes them again.
update auth.sessions set ip = '198.51.100.9', user_agent = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36', refreshed_at = now()
  where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check((select ip is null and user_agent = 'Android' from auth.sessions where id = '00000000-0000-0000-0000-0000000000a1'), 'a refresh keeps no IP either');

-- The audit log.
insert into auth.audit_log_entries (instance_id, id, payload, created_at, ip_address) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000b1', '{}'::json, now(), '203.0.113.7');
select pg_temp.check((select ip_address from auth.audit_log_entries where id = '00000000-0000-0000-0000-0000000000b1') = '', 'an audit entry keeps no IP');

-- The Sign-in log refuses an IP outright.
do $$ begin
  insert into public.access_log (user_id, ip) values ('00000000-0000-0000-0000-0000000000f1', '203.0.113.7');
  raise exception 'FAIL: the Sign-in log took an IP';
exception when check_violation then raise notice 'ok - the Sign-in log refuses an IP';
end $$;

-- The device names.
select pg_temp.check(public.device_label(null) is null and public.device_label('') is null, 'no User-Agent, no device');
select pg_temp.check(public.device_label('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)') = 'iPhone', 'iPhone before Mac');
select pg_temp.check(public.device_label('Mozilla/5.0 (Windows NT 10.0; Win64; x64)') = 'Windows', 'Windows');
select pg_temp.check(public.device_label('node') = 'Other', 'anything else is Other');
select pg_temp.check(public.device_label(public.device_label('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)')) = 'Chromebook', 'a device name stays itself');

rollback;
