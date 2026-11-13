-- V1.55 (12 Nov 2026): passphrase only sign in for every account, and a phone that signs itself in by scanning the Mac.
-- Additive: no existing table, rule or function changes. Part of the personal project kit (supabase/ps-core.json), so
-- PS puts it on a person's own project when it updates. The app works without it (both features then quietly fall
-- back to typing), so it may deploy before or after the app.
--
-- 1. ps_account_hints: an account made with a username (before V1.49) keeps its keys; new devices find its username
--    from the passphrase alone. Each row: sha256 of a token only the passphrase gives, and the username sealed with a
--    key only the passphrase gives (AES-256-GCM, src/core/crypto.ts sealHint). The server never holds the username,
--    the token or the passphrase. Rows are written by the account itself and read only through ps_hint_get, which
--    answers only the exact token, at most 30 times in 10 minutes for the whole project (an online guess costs as much
--    as a sign in attempt; there is nothing to copy away and guess at offline without the database itself).
-- 2. ps_link_offers: the one time relay for "Link your iPhone" (src/core/phonepair.ts). The Mac makes an offer (its
--    own rows only), a phone claims it ONCE within 60 seconds with its public key, the Mac reveals its nonce, and after
--    Allow writes the sign in sealed to that phone. Only public keys, a random nonce and ciphertext ever sit here.
-- 3. ps_devices: phones signed in this way, so the Mac can list them and Remove one (the phone forgets its keys the
--    next time it opens).

-- ---------- 1. account hints ----------
create table if not exists public.ps_account_hints (
  user_id uuid primary key references auth.users(id) on delete cascade,
  check_hash text not null check (check_hash ~ '^[0-9a-f]{64}$'),
  sealed text not null check (length(sealed) between 40 and 400),
  updated_at timestamptz not null default now()
);
create index if not exists ps_account_hints_check on public.ps_account_hints (check_hash);
alter table public.ps_account_hints enable row level security;
revoke all on public.ps_account_hints from anon, authenticated;

create table if not exists public.ps_hint_tries (at timestamptz not null default now());
alter table public.ps_hint_tries enable row level security;
revoke all on public.ps_hint_tries from anon, authenticated;

create or replace function public.ps_hint_set(p_check text, p_sealed text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in first'; end if;
  if p_check !~ '^[0-9a-f]{64}$' or length(coalesce(p_sealed, '')) not between 40 and 400 then raise exception 'bad hint'; end if;
  insert into public.ps_account_hints (user_id, check_hash, sealed, updated_at) values (uid, p_check, p_sealed, now())
  on conflict (user_id) do update set check_hash = excluded.check_hash, sealed = excluded.sealed, updated_at = now();
end $$;

create or replace function public.ps_hint_clear() returns void
language sql security definer set search_path = '' as $$
  delete from public.ps_account_hints where user_id = auth.uid();
$$;

create or replace function public.ps_hint_get(p_token text) returns text
language plpgsql security definer set search_path = '' as $$
declare n int; s text;
begin
  if p_token !~ '^[A-Za-z0-9_-]{43}$' then return null; end if;
  delete from public.ps_hint_tries where at < now() - interval '1 day';
  select count(*) into n from public.ps_hint_tries where at > now() - interval '10 minutes';
  if n >= 30 then raise exception 'Too many tries. Wait a few minutes and try again.'; end if;
  insert into public.ps_hint_tries default values;
  select h.sealed into s from public.ps_account_hints h
    where h.check_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') order by h.updated_at desc limit 1;
  return s;
end $$;

revoke all on function public.ps_hint_set(text, text) from public, anon;
revoke all on function public.ps_hint_clear() from public, anon;
revoke all on function public.ps_hint_get(text) from public;
grant execute on function public.ps_hint_set(text, text) to authenticated;
grant execute on function public.ps_hint_clear() to authenticated;
grant execute on function public.ps_hint_get(text) to anon, authenticated;

-- ---------- 2. the pairing relay ----------
create table if not exists public.ps_link_offers (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{22}$'),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 seconds',
  phone_pub text check (phone_pub ~ '^[A-Za-z0-9_-]{87}$'),
  claimed_at timestamptz,
  reveal text check (reveal ~ '^[A-Za-z0-9_-]{22}$'),
  sealed text check (length(sealed) <= 2200)
);
alter table public.ps_link_offers enable row level security;
revoke all on public.ps_link_offers from anon, authenticated;
grant select, insert, update, delete on public.ps_link_offers to authenticated;
drop policy if exists "own link offers" on public.ps_link_offers;
create policy "own link offers" on public.ps_link_offers for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()) and expires_at <= now() + interval '2 minutes');

-- The phone (not signed in) claims an offer once, before it runs out.
create or replace function public.ps_link_claim(p_id text, p_pub text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.ps_link_offers where created_at < now() - interval '15 minutes';
  if p_id !~ '^[A-Za-z0-9_-]{22}$' or p_pub !~ '^[A-Za-z0-9_-]{87}$' then return false; end if;
  update public.ps_link_offers set phone_pub = p_pub, claimed_at = now()
    where id = p_id and phone_pub is null and expires_at > now();
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- The phone that claimed it (same key) reads the Mac's nonce and, after Allow, the sealed sign in. Reading the sealed
-- sign in deletes the offer: it works once. Null: the offer is gone (refused, run out, or already used).
create or replace function public.ps_link_poll(p_id text, p_pub text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.ps_link_offers%rowtype;
begin
  if p_id !~ '^[A-Za-z0-9_-]{22}$' or p_pub !~ '^[A-Za-z0-9_-]{87}$' then return null; end if;
  select * into r from public.ps_link_offers where id = p_id and phone_pub = p_pub;
  if not found or r.claimed_at < now() - interval '3 minutes' then return null; end if;
  if r.sealed is not null then delete from public.ps_link_offers where id = p_id; end if;
  return jsonb_build_object('reveal', r.reveal, 'sealed', r.sealed);
end $$;

revoke all on function public.ps_link_claim(text, text) from public;
revoke all on function public.ps_link_poll(text, text) from public;
grant execute on function public.ps_link_claim(text, text) to anon, authenticated;
grant execute on function public.ps_link_poll(text, text) to anon, authenticated;

-- ---------- 3. linked phones ----------
create table if not exists public.ps_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('iphone', 'phone')),
  created_at timestamptz not null default now()
);
alter table public.ps_devices enable row level security;
revoke all on public.ps_devices from anon, authenticated;
grant select, insert, delete on public.ps_devices to authenticated;
drop policy if exists "own devices" on public.ps_devices;
create policy "own devices" on public.ps_devices for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
