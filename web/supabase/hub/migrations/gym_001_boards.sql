-- G Squad Fitness (V1.40): gym boards, per exercise compare, challenges, reactions and comments.
-- Additive only, every name starts with gym_. The core's tables are never changed; gym rows point at them.
-- Zero knowledge like the core: ciphertext sealed with the squad key on members' devices, ids, a short tag,
-- timestamps. No names, no exercise names, no numbers. Only the edge function `gym` (service role) reads or
-- writes, after it has checked the member's signature exactly like the core's `squad` function.

-- One row per member per shared part:
--   sum    the board card: gym and activity days with each day's volume and distance (last 9 weeks), recent
--          personal bests, percent better. Piece "fitness".
--   sleep  hours slept and the streak. Piece "sleep".
--   ex     one exercise (or one activity kind): the best set and the last 10 sessions' sets. Piece "fitness".
-- id is an HMAC under the member's own secret (unlinkable). tag (ex rows only) is an HMAC of the matched exercise
-- name under the squad key, so a compare screen pulls one exercise for everyone instead of every exercise.
create table public.gym_rows (
  id uuid primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  part text not null check (part in ('sum', 'sleep', 'ex')),
  tag text check (tag is null or tag ~ '^[0-9a-f]{16}$'),
  ct text not null check (length(ct) <= 8000),
  gen integer not null,
  fp text not null check (fp ~ '^[0-9a-f]{16,64}$'),
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
create index gym_rows_squad on public.gym_rows(squad_id, part, updated_at);
create index gym_rows_tag on public.gym_rows(squad_id, tag) where tag is not null;
create index gym_rows_member on public.gym_rows(member_id);

-- Challenges, joins, reactions and comments. What kind of post it is lives inside the ciphertext.
create table public.gym_posts (
  id uuid primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  ct text not null check (length(ct) <= 1500),
  gen integer not null,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gym_posts_squad on public.gym_posts(squad_id, updated_at);
create index gym_posts_member on public.gym_posts(member_id);

-- Replay guard for the gym function (its own, so the core's table is never touched).
create table public.gym_nonces (
  member_key text not null check (length(member_key) = 64),
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{16,32}$'),
  at timestamptz not null default now(),
  primary key (member_key, nonce)
);
create index gym_nonces_at on public.gym_nonces(at);

do $$
declare t text;
begin
  foreach t in array array['gym_rows', 'gym_posts', 'gym_nonces'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy "no client access" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

-- Housekeeping (the gym function runs it now and then): old nonces, old tombstones, rows of members who left.
create or replace function public.gym_tidy()
returns void language sql set search_path = '' as $$
  delete from public.gym_nonces where at < now() - interval '10 minutes';
  delete from public.gym_rows where deleted and updated_at < now() - interval '30 days';
  delete from public.gym_posts where deleted and updated_at < now() - interval '30 days';
  delete from public.gym_posts where created_at < now() - interval '120 days';
  delete from public.gym_rows r using public.squad_members m where r.member_id = m.id and m.left_at is not null;
  delete from public.gym_posts p using public.squad_members m where p.member_id = m.id and m.left_at is not null;
$$;
revoke all on function public.gym_tidy() from public, anon, authenticated;
grant execute on function public.gym_tidy() to service_role;
