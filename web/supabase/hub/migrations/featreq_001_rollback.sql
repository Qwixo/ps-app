-- Rollback of featreq_001_requests.sql: removes only the featreq_ tables and function. Requests already sent are lost (each person's
-- own PS still lists theirs on their device).
begin;
drop function if exists public.featreq_tidy();
drop table if exists public.featreq_nonces;
drop table if exists public.featreq_items;
commit;
