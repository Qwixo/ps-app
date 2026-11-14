-- WhatsApp replies (PS 1.60, pull request 9). Meta's WhatsApp Cloud API calls whatsapp-webhook; the function checks
-- the X-Hub-Signature-256 signature with your app secret, seals each message to the owner's public key and puts it in
-- the sealed inbox (source 'whatsapp'). whatsapp-send sends a reply from your number when you press Send.
-- Secrets live only in Supabase Vault (never in the browser, the repo or a log), read through service-role-only functions:
--   wa_access_token, wa_app_secret, wa_phone_number_id, wa_waba_id   you hand these over once with scripts/whatsapp-connect.mjs
--   wa_verify_token                                                  made here, inside the database; you paste it into Meta
-- No cron job and no recurring query: everything is event driven (Meta calls the webhook; you press Send).
-- DB PROOF: five tiny state tables read and written by primary key only, a few rows per message | no scheduled calls |
-- retention in the webhook: whatsapp_seen 30 days, whatsapp_window 8 days, both pruned by an indexed time column |
-- rollback: supabase/rollback/041_whatsapp_down.sql
-- Nothing here is readable through the API except the two owner-only helper functions at the end.

-- Messages already sealed, as sha256 only (no number, no text). Pruned after 30 days (Meta retries for up to 7 days).
create table if not exists public.whatsapp_seen (
  h text primary key,
  at timestamptz not null default now()
);
create index if not exists whatsapp_seen_at on public.whatsapp_seen (at);

-- The 24 hour customer service window, per sender: sha256 of the number only, and when they last wrote.
create table if not exists public.whatsapp_window (
  h text primary key,
  last_in_at timestamptz not null,
  at timestamptz not null default now()
);
create index if not exists whatsapp_window_at on public.whatsapp_window (at);

-- Non secret facts for Settings and the guide: verified_at, last_in_at, last_error, number (your own display number).
create table if not exists public.whatsapp_state (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- One time enroll codes (sha256 only) for the local connect script.
create table if not exists public.whatsapp_enroll (
  code_hash text primary key,
  expires_at timestamptz not null
);

alter table public.whatsapp_seen enable row level security;
alter table public.whatsapp_window enable row level security;
alter table public.whatsapp_state enable row level security;
alter table public.whatsapp_enroll enable row level security;
revoke all on public.whatsapp_seen, public.whatsapp_window, public.whatsapp_state, public.whatsapp_enroll from anon, authenticated;

create or replace function public.whatsapp_get_config() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'access_token', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_access_token'),
    'app_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_app_secret'),
    'verify_token', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_verify_token'),
    'phone_number_id', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_phone_number_id'),
    'waba_id', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_waba_id')
  );
$$;

-- Store (or replace) the four secrets you hand over. Service role only; the function that calls it checks your one time code.
create or replace function public.whatsapp_set_config(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare k text; sid uuid;
begin
  foreach k in array array['access_token', 'app_secret', 'phone_number_id', 'waba_id'] loop
    if coalesce(p->>k, '') <> '' then
      select id into sid from vault.secrets where name = 'wa_' || k;
      if sid is null then perform vault.create_secret(p->>k, 'wa_' || k, 'WhatsApp Cloud API ' || k);
      else perform vault.update_secret(sid, p->>k); end if;
    end if;
  end loop;
end $$;

-- Forget everything (Unlink in Settings runs the script's unlink, which calls this): secrets, state, window, seen.
create or replace function public.whatsapp_unlink() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where name in ('wa_access_token', 'wa_app_secret', 'wa_phone_number_id', 'wa_waba_id');
  delete from public.whatsapp_state;
  delete from public.whatsapp_window;
end $$;

revoke all on function public.whatsapp_get_config() from public, anon, authenticated;
revoke all on function public.whatsapp_set_config(jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_unlink() from public, anon, authenticated;
grant execute on function public.whatsapp_get_config() to service_role;
grant execute on function public.whatsapp_set_config(jsonb) to service_role;
grant execute on function public.whatsapp_unlink() to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'wa_verify_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'wa_verify_token', 'WhatsApp webhook verify token (you paste it into Meta)');
  end if;
end $$;

-- Owner only, for Settings and the guide: is it linked, is the webhook verified, when did the last message land.
-- Never returns a secret and never a message.
create or replace function public.whatsapp_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not public.is_owner() then null else jsonb_build_object(
    'linked', exists (select 1 from vault.secrets where name = 'wa_access_token')
      and exists (select 1 from vault.secrets where name = 'wa_phone_number_id'),
    'number', (select value from public.whatsapp_state where key = 'number'),
    'verified_at', (select value from public.whatsapp_state where key = 'verified_at'),
    'last_in_at', (select value from public.whatsapp_state where key = 'last_in_at'),
    'last_error', (select value from public.whatsapp_state where key = 'last_error')
  ) end;
$$;

-- Owner only: the verify token the guide shows (you paste it into Meta's webhook page). It is not an access token.
create or replace function public.whatsapp_webhook_info() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not public.is_owner() then null else jsonb_build_object(
    'verify_token', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_verify_token')
  ) end;
$$;
revoke all on function public.whatsapp_status() from public, anon;
revoke all on function public.whatsapp_webhook_info() from public, anon;
grant execute on function public.whatsapp_status() to authenticated;
grant execute on function public.whatsapp_webhook_info() to authenticated;
