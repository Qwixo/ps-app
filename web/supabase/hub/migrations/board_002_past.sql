-- G Squad Past boards (PS 1.64), Supabase project zxhvchchfrkfqxuyorqo only. NOT APPLIED: the manager applies it on
-- The developer's word, then deploys the `board` function (board_past, board_pastput). Additive: one new table, and board_tidy
-- learns to clear its old tombstones. Nothing in the existing tables changes.
-- The monthly leaderboards the squad posted before PS: one row per month, sealed with the squad key on the owner's
-- device. The hub never sees a name or an amount. Only the squad's owner (squads.created_by) writes, the function checks.
create table if not exists public.board_past (
  squad_id uuid not null references public.squads(id) on delete cascade,
  month text not null check (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  ct text not null check (length(ct) <= 8000),                    -- the month, sealed ('' once taken back)
  gen integer not null check (gen >= 1),
  fp text not null check (fp ~ '^[0-9a-f]{16,64}$' or fp = ''),   -- HMAC fingerprint: "changed", never "what"
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (squad_id, month)
);
create index if not exists board_past_squad on public.board_past(squad_id, updated_at);

alter table public.board_past enable row level security;
alter table public.board_past force row level security;
revoke all on table public.board_past from anon, authenticated, public;
grant all on table public.board_past to service_role;
drop policy if exists "no client access" on public.board_past;
create policy "no client access" on public.board_past as restrictive for all to anon, authenticated using (false) with check (false);

create or replace function public.board_tidy()
returns void language sql set search_path = '' as $$
  delete from public.board_nonces where at < now() - interval '10 minutes';
  delete from public.board_cards where deleted and updated_at < now() - interval '30 days';
  delete from public.board_cards c using public.squad_members m where m.id = c.member_id and m.left_at is not null;
  delete from public.board_past where deleted and updated_at < now() - interval '30 days';
$$;
revoke all on function public.board_tidy() from public, anon, authenticated;
grant execute on function public.board_tidy() to service_role;
