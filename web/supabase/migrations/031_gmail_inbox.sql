-- Gmail replies -> sealed inbox (source 'gmail' and 'gmail-sent').
-- The edge function gmail-inbox runs every 2 minutes (pg_cron + pg_net). It holds your
-- read-only Gmail logins in Supabase Vault (encrypted at rest), reads message headers and
-- snippets, and seals them to the owner's public key. Plaintext lives only in function memory.
-- Nothing here is readable through the API: no policies, service role only.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Per account: where the last poll got to, and whether it worked (no mail content here).
create table if not exists public.gmail_state (
  account text primary key,
  cursor_ms bigint,
  last_ok timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.gmail_state enable row level security;

-- Messages already sealed, as sha256(account|message id) only. Pruned after 30 days.
create table if not exists public.gmail_seen (
  h text primary key,
  at timestamptz not null default now()
);
alter table public.gmail_seen enable row level security;

-- One-time enroll codes (sha256 only) for the local connect script.
create table if not exists public.gmail_enroll (
  code_hash text primary key,
  expires_at timestamptz not null
);
alter table public.gmail_enroll enable row level security;

revoke all on public.gmail_state, public.gmail_seen, public.gmail_enroll from anon, authenticated;

-- Secrets live in Supabase Vault. These wrappers are callable by the service role only.
create or replace function public.gmail_get_config() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'accounts', (select decrypted_secret from vault.decrypted_secrets where name = 'gmail_accounts'),
    'cron_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gmail_cron_secret')
  );
$$;

create or replace function public.gmail_set_accounts(p text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'gmail_accounts';
  if sid is null then
    perform vault.create_secret(p, 'gmail_accounts', 'Read-only Gmail logins for gmail-inbox');
  else
    perform vault.update_secret(sid, p);
  end if;
end $$;

revoke all on function public.gmail_get_config() from public, anon, authenticated;
revoke all on function public.gmail_set_accounts(text) from public, anon, authenticated;
grant execute on function public.gmail_get_config() to service_role;
grant execute on function public.gmail_set_accounts(text) to service_role;

-- Owner-only health view for Settings: which accounts are connected and when they last worked.
create or replace function public.gmail_status() returns table (account text, last_ok timestamptz, last_error text)
language sql security definer set search_path = '' as $$
  select s.account, s.last_ok, s.last_error from public.gmail_state s
  where public.is_owner() order by s.account;
$$;
revoke all on function public.gmail_status() from public, anon;
grant execute on function public.gmail_status() to authenticated;

-- The cron secret proves a poll request came from this database's scheduler.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'gmail_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'gmail_cron_secret', 'gmail-inbox poll auth');
  end if;
end $$;

-- Where the cron calls the functions: your own project's address, kept in Vault by mail_set_project(ref).
-- PS's Settings, Client emails, shows the one line to run with your project's ref already filled in.
-- Until it is run the cron calls nothing (no address, no call).
create or replace function public.mail_set_project(ref text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if ref !~ '^[a-z0-9]{20}$' then raise exception 'A project ref is 20 lowercase letters and numbers'; end if;
  select id into sid from vault.secrets where name = 'ps_functions_url';
  if sid is null then
    perform vault.create_secret('https://' || ref || '.supabase.co/functions/v1', 'ps_functions_url', 'Where the mail crons call your functions');
  else
    perform vault.update_secret(sid, 'https://' || ref || '.supabase.co/functions/v1');
  end if;
end $$;
revoke all on function public.mail_set_project(text) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'gmail-inbox';
select cron.schedule('gmail-inbox', '*/2 * * * *', $job$
  select net.http_post(
    url := u.v || '/gmail-inbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gmail_cron_secret')
    ),
    body := '{"op":"poll"}'::jsonb,
    timeout_milliseconds := 120000
  ) from (select decrypted_secret as v from vault.decrypted_secrets where name = 'ps_functions_url') u;
$job$);
