-- G Squad Leaderboard and Screen time (V1.40), Supabase project zxhvchchfrkfqxuyorqo only. Additive: new tables
-- named board_*, nothing in the core's tables changes. Read and written only by the edge function `board`
-- (service role), after it has checked the member's ECDSA signature exactly like the core's `squad` function.
-- Zero knowledge: each member has at most three cards (money, tasks, screen), each a small ciphertext sealed with
-- the squad key on that member's own device. The hub never sees an amount, a count, a time or a name.
-- A piece switched off in What you share is never sealed or sent; its card is taken away (a tombstone, ct '').

create table public.board_cards (
  member_id uuid not null references public.squad_members(id) on delete cascade,
  kind text not null check (kind in ('money', 'tasks', 'screen')),
  squad_id uuid not null references public.squads(id) on delete cascade,
  ct text not null check (length(ct) <= 4000),                    -- the card, sealed ('' once taken away)
  gen integer not null check (gen >= 1),
  fp text not null check (fp ~ '^[0-9a-f]{16,64}$' or fp = ''),   -- HMAC fingerprint: "changed", never "what"
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (member_id, kind)
);
create index board_cards_squad on public.board_cards(squad_id, updated_at);

-- Replay guard for the `board` function (its own, so the core's table is untouched).
create table public.board_nonces (
  member_key text not null check (length(member_key) = 64),       -- sha256 of the signing public key
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{16,32}$'),
  at timestamptz not null default now(),
  primary key (member_key, nonce)
);
create index board_nonces_at on public.board_nonces(at);

-- Locked down like the core: RLS on and forced, a restrictive deny for the Data API roles, no grants.
do $$
declare t text;
begin
  foreach t in array array['board_cards', 'board_nonces'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy "no client access" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

-- Housekeeping (the function runs it now and then): old nonces, old tombstones, cards of members who left.
create or replace function public.board_tidy()
returns void language sql set search_path = '' as $$
  delete from public.board_nonces where at < now() - interval '10 minutes';
  delete from public.board_cards where deleted and updated_at < now() - interval '30 days';
  delete from public.board_cards c using public.squad_members m where m.id = c.member_id and m.left_at is not null;
$$;
revoke all on function public.board_tidy() from public, anon, authenticated;
grant execute on function public.board_tidy() to service_role;
