-- Soundboard sharing (V1.47): a member shares a small audio file with the squad. Additive only, every name starts
-- with sb_. The core's tables are never changed; sb rows point at them.
-- Zero knowledge like the rest of the hub: the file and its name and note are sealed with the squad key on the
-- member's device (AES-256-GCM). The hub holds ciphertext, ids, piece counts, the sealed size and timestamps.
-- Only the edge function `sb` (service role) reads or writes, after it checked the member's signature like `gym`.
-- Free plan care (500 MB database, 5 GB egress a month): at most 10 MB a file, 15 files and 80 MB per squad at once,
-- 5 shares per member a day, and every file leaves the hub 14 days after it was shared.
create table public.sb_files (
  id uuid primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  meta_ct text not null check (length(meta_ct) <= 2000),
  gen integer not null,
  parts integer not null check (parts between 1 and 24),
  size integer not null check (size between 1 and 14000000),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);
create index sb_files_squad on public.sb_files(squad_id, created_at);
create index sb_files_member on public.sb_files(member_id, created_at);

create table public.sb_parts (
  file_id uuid not null references public.sb_files(id) on delete cascade,
  n integer not null check (n between 0 and 23),
  ct text not null check (length(ct) <= 720000),
  primary key (file_id, n)
);

-- Replay guard for the sb function (its own, so no other table is touched).
create table public.sb_nonces (
  member_key text not null check (length(member_key) = 64),
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{16,32}$'),
  at timestamptz not null default now(),
  primary key (member_key, nonce)
);
create index sb_nonces_at on public.sb_nonces(at);

do $$
declare t text;
begin
  foreach t in array array['sb_files', 'sb_parts', 'sb_nonces'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy "no client access" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

-- Housekeeping (the sb function runs it on every share and now and then): old nonces, expired files, uploads that
-- never finished, files of members who left.
create or replace function public.sb_tidy()
returns void language sql set search_path = '' as $$
  delete from public.sb_nonces where at < now() - interval '10 minutes';
  delete from public.sb_files where expires_at < now();
  delete from public.sb_files where not done and created_at < now() - interval '1 hour';
  delete from public.sb_files f using public.squad_members m where f.member_id = m.id and m.left_at is not null;
$$;
revoke all on function public.sb_tidy() from public, anon, authenticated;
grant execute on function public.sb_tidy() to service_role;
