-- 1.60: reminders on the iPhone while the web app is closed (Web Push, iOS 16.4 and later), on EACH person's own project.
-- Numbers 031 to 036 are taken by the client email work, so this one is 040.
-- What the server keeps, and nothing else:
--   push_subs   one row per phone that tapped "Allow reminders on this iPhone": the push address the phone's own browser
--               made (endpoint) and the two public keys the sender needs to reach it (p256dh, auth).
--   push_queue  the reminder ID and the moment it should buzz. NEVER the reminder's words, title or colours: those stay in
--               the vault (encrypted) and in a small copy on the phone itself. The push itself carries only the id.
--   push_config one row, written once at deploy by the owner of the project (service role only): the public VAPID key.
-- Everything is the signed in person's own rows (row level security). Nothing here reads the vault.
create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) <= 1000 and endpoint like 'https://%'),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  created_at timestamptz not null default now()
);
create table if not exists public.push_queue (
  id bigint generated always as identity primary key,
  sub_id uuid not null references public.push_subs(id) on delete cascade,
  rem_id text not null check (rem_id ~ '^[a-z0-9]{1,16}$'),
  fire_at timestamptz not null,
  sent_at timestamptz
);
create index if not exists push_queue_due on public.push_queue (fire_at) where sent_at is null;
create table if not exists public.push_config (
  id int primary key check (id = 1),
  vapid_public text not null default '',
  functions_url text not null default '',
  sender_key text not null default encode(extensions.gen_random_bytes(24), 'hex')
);
alter table public.push_subs enable row level security;
alter table public.push_queue enable row level security;
alter table public.push_config enable row level security;   -- no policy: only the service role (the sender) reads it

create policy push_subs_own on public.push_subs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_queue_own on public.push_queue for all to authenticated
  using (exists (select 1 from public.push_subs s where s.id = sub_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.push_subs s where s.id = sub_id and s.user_id = (select auth.uid())));

-- The public key the phone needs to subscribe (it is public by design).
create or replace function public.push_vapid() returns text
language sql stable security definer set search_path = '' as $$
  select vapid_public from public.push_config where id = 1;
$$;
revoke all on function public.push_vapid() from public, anon;
grant execute on function public.push_vapid() to authenticated;

-- This phone's push address, kept (or refreshed).
create or replace function public.push_register(p_endpoint text, p_p256dh text, p_auth text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v uuid;
begin
  insert into public.push_subs (endpoint, p256dh, auth) values (p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_id = (select auth.uid())
  returning id into v;
  return v;
end $$;
revoke all on function public.push_register(text, text, text) from public, anon;
grant execute on function public.push_register(text, text, text) to authenticated;

create or replace function public.push_unregister(p_endpoint text) returns void
language sql security invoker set search_path = '' as $$
  delete from public.push_subs where endpoint = p_endpoint;
$$;
revoke all on function public.push_unregister(text) from public, anon;
grant execute on function public.push_unregister(text) to authenticated;

-- This phone's schedule, replaced as a whole: [{"id":"<reminder id>","at":<epoch ms>}], at most 200, future only.
create or replace function public.push_set_schedule(p_endpoint text, p_times jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare s uuid; n integer;
begin
  select id into s from public.push_subs where endpoint = p_endpoint;
  if s is null then return 0; end if;
  delete from public.push_queue where sub_id = s and sent_at is null;
  insert into public.push_queue (sub_id, rem_id, fire_at)
  select s, t->>'id', to_timestamp(((t->>'at')::bigint) / 1000.0)
  from (select value as t from jsonb_array_elements(p_times) limit 200) x
  where (t->>'id') ~ '^[a-z0-9]{1,16}$' and to_timestamp(((t->>'at')::bigint) / 1000.0) > now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.push_set_schedule(text, jsonb) from public, anon;
grant execute on function public.push_set_schedule(text, jsonb) to authenticated;

-- Done on any device: every push still waiting for that reminder, up to the end of that window, is dropped.
create or replace function public.push_clear(p_rem_id text, p_until bigint) returns void
language sql security invoker set search_path = '' as $$
  delete from public.push_queue where rem_id = p_rem_id and sent_at is null and fire_at <= to_timestamp(p_until / 1000.0);
$$;
revoke all on function public.push_clear(text, bigint) from public, anon;
grant execute on function public.push_clear(text, bigint) to authenticated;
