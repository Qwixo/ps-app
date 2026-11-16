-- G Squad Feature requests (PS 1.65, the Settings assistant): when no setting does what a person asked, their PS sends what they
-- typed and which part of Settings they were in, sealed with the squad key on their own device. Additive: new tables named
-- featreq_*, nothing in the core's tables changes. Read and written only by the edge function `featreq` (service role), after it has
-- checked the member's ECDSA signature exactly like the `board` function. The hub never sees the words.
-- Until this and the function are deployed the app keeps each request on the person's device ("waiting") and shows no squad list.
-- Load: no timer, no poll. One small write per request (people type one now and then), a read only when someone opens the
-- Feature requests row in Settings and clicks to see the squad's list, then only what changed since (index featreq_items_squad).
-- Growth: at most 50 live requests per member (the function refuses more), taken back ones gone after 30 days (featreq_tidy).
-- Rollback: featreq_001_rollback.sql.

create table public.featreq_items (
  id uuid primary key,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  squad_id uuid not null references public.squads(id) on delete cascade,
  ct text not null check (length(ct) <= 4000),                    -- the request, sealed ('' once taken back)
  gen integer not null check (gen >= 1),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index featreq_items_squad on public.featreq_items(squad_id, updated_at);
create index featreq_items_member on public.featreq_items(member_id) where not deleted;

-- Replay guard for the `featreq` function (its own, so the other tables are untouched).
create table public.featreq_nonces (
  member_key text not null check (length(member_key) = 64),       -- sha256 of the signing public key
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{16,32}$'),
  at timestamptz not null default now(),
  primary key (member_key, nonce)
);
create index featreq_nonces_at on public.featreq_nonces(at);

-- Locked down like the core: RLS on and forced, a restrictive deny for the Data API roles, no grants.
do $$
declare t text;
begin
  foreach t in array array['featreq_items', 'featreq_nonces'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy "no client access" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

-- Housekeeping (the function runs it now and then): old nonces, old tombstones, requests of members who left.
create or replace function public.featreq_tidy()
returns void language sql set search_path = '' as $$
  delete from public.featreq_nonces where at < now() - interval '10 minutes';
  delete from public.featreq_items where deleted and updated_at < now() - interval '30 days';
  delete from public.featreq_items c using public.squad_members m where m.id = c.member_id and m.left_at is not null;
$$;
revoke all on function public.featreq_tidy() from public, anon, authenticated;
