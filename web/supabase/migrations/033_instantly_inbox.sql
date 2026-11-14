-- Instantly: last 20 conversations as full threads -> sealed inbox (source 'instantly2').
-- Only keyed hashes are kept here (to spot changes), never email text or addresses.
-- (Applied 15th Oct 2026; see the edge function instantly-inbox.)
create table if not exists public.instantly_threads (h text primary key, latest text, fetched_at timestamptz not null default now());
create table if not exists public.instantly_meta (key text primary key, value text, updated_at timestamptz not null default now());
alter table public.instantly_threads enable row level security;
alter table public.instantly_meta enable row level security;
revoke all on public.instantly_threads, public.instantly_meta from anon, authenticated;
create or replace function public.instantly_status() returns table (last_ok text, last_error text)
language sql security definer set search_path = '' as $$
  select (select value from public.instantly_meta where key = 'last_ok'), (select value from public.instantly_meta where key = 'last_error') where public.is_owner();
$$;
revoke all on function public.instantly_status() from public, anon;
grant execute on function public.instantly_status() to authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'instantly-inbox';
select cron.schedule('instantly-inbox', '*/5 * * * *', $job$
  select net.http_post(url := u.v || '/instantly-inbox',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gmail_cron_secret')),
    body := '{"op":"poll"}'::jsonb, timeout_milliseconds := 120000)
  from (select decrypted_secret as v from vault.decrypted_secrets where name = 'ps_functions_url') u;
$job$);
