-- V1.57 (the developer, 13 Nov 2026: "Remove the IP address part so I can't see their IP address"): the owner of this
-- project stops holding the IP addresses of the people who sign in, and keeps only a rough device name.
--
--  1. auth.sessions: Supabase Auth writes each session's IP address and full User-Agent and writes them again at every
--     token refresh. A trigger before each write leaves the IP empty and turns the User-Agent into a rough device
--     name ("Mac", "iPhone", "Android" ...), so neither is ever stored.
--  2. access_log (003_access_log.sql), the Sign-in log in Settings: when and who, plus that device name. Its "ip"
--     column stays so older pages that still ask for it keep working, but it can only ever be empty (a check).
--  3. auth.audit_log_entries.ip_address: left empty the same way (Supabase leaves it empty for most events already).
--  4. What is already stored is cleared: every IP in auth.sessions, access_log and auth.audit_log_entries, and every
--     full User-Agent becomes its device name. THIS DELETES DATA and cannot be undone: apply only after the developer's yes.
--
-- Not covered (Supabase's own, outside this database): the API, Auth and edge function logs in Supabase's dashboard
-- keep each request's IP for a short time (1 day on the Free plan, 7 on Pro). PRIVACY.md says so.
-- Safe to run twice. Everything in one transaction: if any step is refused, nothing changes.

begin;

-- A rough device name from a User-Agent. A name it already made comes back unchanged, so it can run on its own output.
create or replace function public.device_label(ua text) returns text
language sql immutable set search_path = '' as $$
  select case
    when ua is null or btrim(ua) = '' then null
    when ua in ('Mac', 'iPhone', 'iPad', 'Android', 'Windows', 'Chromebook', 'Linux', 'Other') then ua
    when ua ~ 'iPhone' then 'iPhone'
    when ua ~ 'iPad' then 'iPad'
    when ua ~ 'Android' then 'Android'
    when ua ~ '(Mac OS X|Macintosh)' then 'Mac'
    when ua ~ 'Windows' then 'Windows'
    when ua ~ 'CrOS' then 'Chromebook'
    when ua ~ 'Linux' then 'Linux'
    else 'Other'
  end
$$;
revoke all on function public.device_label(text) from public, anon, authenticated;

-- 1. Sessions: no IP, only the device name, on every insert and every update (token refreshes rewrite both).
create or replace function public.session_no_ip() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.ip := null;
  new.user_agent := public.device_label(new.user_agent);
  return new;
end $$;
revoke all on function public.session_no_ip() from public, anon, authenticated;
drop trigger if exists vault_session_no_ip on auth.sessions;
create trigger vault_session_no_ip before insert or update on auth.sessions
  for each row execute function public.session_no_ip();

-- 2. The Sign-in log: the device name only. (The trigger above has already run, so new.ip is empty anyway.)
create or replace function public.log_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.access_log(user_id, created_at, user_agent, ip)
    values (new.user_id, now(), public.device_label(new.user_agent), null);
  exception when others then
    null; -- never block a login because of logging
  end;
  return new;
end $$;
revoke all on function public.log_session() from public, anon, authenticated;
comment on column public.access_log.user_agent is 'A rough device name (public.device_label), never the full User-Agent (030_no_ip.sql).';
comment on column public.access_log.ip is 'Always empty since 030_no_ip.sql; kept so older pages that select it still work.';

-- 3. Audit log entries: no IP.
create or replace function public.audit_no_ip() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.ip_address := '';
  return new;
end $$;
revoke all on function public.audit_no_ip() from public, anon, authenticated;
drop trigger if exists vault_audit_no_ip on auth.audit_log_entries;
create trigger vault_audit_no_ip before insert or update on auth.audit_log_entries
  for each row execute function public.audit_no_ip();

-- 4. What is already stored (deletes data). The session update goes through the trigger above as well.
update public.access_log set ip = null, user_agent = public.device_label(user_agent)
  where ip is not null or user_agent is distinct from public.device_label(user_agent);
update auth.sessions set ip = null, user_agent = public.device_label(user_agent)
  where ip is not null or user_agent is distinct from public.device_label(user_agent);
update auth.audit_log_entries set ip_address = '' where coalesce(ip_address, '') <> '';

-- And it stays that way: the Sign-in log can never hold an IP again.
alter table public.access_log drop constraint if exists access_log_no_ip;
alter table public.access_log add constraint access_log_no_ip check (ip is null);

commit;
