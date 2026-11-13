-- G Squad hub (V1.40), Supabase project zxhvchchfrkfqxuyorqo, its own account. NEVER the developer's vault project.
-- Zero knowledge: the hub stores only ciphertext (sealed with the squad key on members' devices), public keys,
-- hashes, ids and timestamps. No names, no task titles, no client names, no squad key.
-- Access: every table has RLS on and NO policy and no grant for anon or authenticated, so the Data API returns
-- nothing to anyone. Only the edge function `squad` reads and writes (service role), after it has checked the
-- member's ECDSA signature on the request (src/core/squadcrypto.ts signRequest).

create table public.squads (
  id uuid primary key default gen_random_uuid(),
  gen integer not null default 1 check (gen >= 1),                -- the squad key generation now in use
  rekey boolean not null default false,                           -- someone left: a member still in makes gen + 1
  meta_ct text check (length(meta_ct) <= 2000),                   -- the squad's name, sealed
  meta_gen integer,
  created_by uuid,                                                -- a member id (who may remove members)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.squad_members (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.squads(id) on delete cascade,
  sign_pub text not null check (sign_pub ~ '^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$'),   -- raw P-256 point, base64
  box_pub text not null check (box_pub ~ '^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$'),
  card_ct text check (length(card_ct) <= 2000),                   -- name and public keys, sealed
  card_gen integer,
  last_beat timestamptz,                                          -- "working": PS running, never "online"
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index squad_members_sign_pub on public.squad_members(sign_pub);
create index squad_members_squad on public.squad_members(squad_id, updated_at);

alter table public.squads add constraint squads_created_by_fk foreign key (created_by) references public.squad_members(id) on delete set null;
create index squads_created_by on public.squads(created_by);

create table public.squad_invites (
  id uuid primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  created_by uuid not null references public.squad_members(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),   -- sha256 of a token derived from the # secret
  wrapped_key text not null check (length(wrapped_key) <= 400),   -- the squad key under a key only the link opens
  gen integer not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.squad_members(id) on delete set null
);
create index squad_invites_squad on public.squad_invites(squad_id);
create index squad_invites_created_by on public.squad_invites(created_by);
create index squad_invites_used_by on public.squad_invites(used_by);

create table public.squad_keydrops (
  member_id uuid not null references public.squad_members(id) on delete cascade,
  gen integer not null,
  squad_id uuid not null references public.squads(id) on delete cascade,
  sealed text not null check (length(sealed) <= 600),              -- the new squad key sealed to that member's box key
  created_at timestamptz not null default now(),
  primary key (member_id, gen)
);
create index squad_keydrops_squad on public.squad_keydrops(squad_id);

create table public.squad_tasks (
  id uuid primary key,                                            -- HMAC of the vault task id, unlinkable
  squad_id uuid not null references public.squads(id) on delete cascade,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  ct text not null check (length(ct) <= 2000),                    -- title (or "Client task"), priority, date, done; sealed
  gen integer not null,
  fp text not null check (fp ~ '^[0-9a-f]{16,64}$'),              -- HMAC fingerprint: "changed", never "what"
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
create index squad_tasks_squad on public.squad_tasks(squad_id, updated_at);
create index squad_tasks_member on public.squad_tasks(member_id);

create table public.squad_handoffs (
  id uuid primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  from_member uuid not null references public.squad_members(id) on delete cascade,
  to_member uuid not null references public.squad_members(id) on delete cascade,
  ct text not null check (length(ct) <= 2000),                    -- the handed task, sealed
  gen integer not null,
  state text not null default 'open' check (state in ('open', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_member <> to_member)
);
create index squad_handoffs_squad on public.squad_handoffs(squad_id, updated_at);
create index squad_handoffs_from on public.squad_handoffs(from_member);
create index squad_handoffs_to on public.squad_handoffs(to_member);

-- Replay guard: each signed request's nonce is used once (kept 10 minutes; requests older than 2 minutes are refused).
create table public.squad_nonces (
  member_key text not null check (length(member_key) = 64),       -- sha256 of the signing public key
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{16,32}$'),
  at timestamptz not null default now(),
  primary key (member_key, nonce)
);
create index squad_nonces_at on public.squad_nonces(at);

-- Locked down: RLS on, no policies, nothing granted to the Data API roles.
do $$
declare t text;
begin
  foreach t in array array['squads', 'squad_members', 'squad_invites', 'squad_keydrops', 'squad_tasks', 'squad_handoffs', 'squad_nonces'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- ---------- the few steps that must happen at once (called only by the edge function, as service_role) ----------

create or replace function public.squad_create(p_sign_pub text, p_box_pub text, p_meta_ct text)
returns jsonb language plpgsql set search_path = '' as $$
declare s uuid; m uuid;
begin
  insert into public.squads (meta_ct, meta_gen) values (p_meta_ct, 1) returning id into s;
  insert into public.squad_members (squad_id, sign_pub, box_pub) values (s, p_sign_pub, p_box_pub) returning id into m;
  update public.squads set created_by = m where id = s;
  return jsonb_build_object('squad', s, 'member', m, 'gen', 1);
end $$;

create or replace function public.squad_join(p_invite uuid, p_token_hash text, p_sign_pub text, p_box_pub text)
returns jsonb language plpgsql set search_path = '' as $$
declare i public.squad_invites; sq public.squads; m uuid; n integer;
begin
  select * into i from public.squad_invites where id = p_invite for update;
  if not found or i.used_at is not null or i.expires_at < now() or i.token_hash <> p_token_hash then
    raise exception 'invite' using errcode = 'P0001';
  end if;
  select * into sq from public.squads where id = i.squad_id for update;
  if sq.rekey or sq.gen <> i.gen then raise exception 'invite' using errcode = 'P0001'; end if;
  select count(*) into n from public.squad_members where squad_id = sq.id and left_at is null;
  if n >= 30 then raise exception 'full' using errcode = 'P0001'; end if;
  insert into public.squad_members (squad_id, sign_pub, box_pub) values (sq.id, p_sign_pub, p_box_pub) returning id into m;
  update public.squad_invites set used_at = now(), used_by = m where id = i.id;
  return jsonb_build_object('squad', sq.id, 'member', m, 'gen', i.gen, 'wrapped', i.wrapped_key);
end $$;

-- A member leaves, or the squad's creator takes someone out. Their shared rows go, the rest re-key.
create or replace function public.squad_leave(p_member uuid, p_target uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; t public.squad_members; sq public.squads; left_now integer;
begin
  select * into me from public.squad_members where id = p_member and left_at is null;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = me.squad_id for update;
  select * into t from public.squad_members where id = p_target and squad_id = me.squad_id and left_at is null for update;
  if not found then raise exception 'target' using errcode = 'P0001'; end if;
  if p_target <> p_member and sq.created_by is distinct from p_member then raise exception 'creator' using errcode = 'P0001'; end if;
  update public.squad_members set left_at = now(), last_beat = null, card_ct = null, updated_at = now() where id = t.id;
  update public.squad_tasks set deleted = true, ct = '', updated_at = now() where member_id = t.id and not deleted;
  update public.squad_handoffs set state = 'cancelled', updated_at = now() where (from_member = t.id or to_member = t.id) and state = 'open';
  delete from public.squad_invites where squad_id = sq.id and used_at is null;
  select count(*) into left_now from public.squad_members where squad_id = sq.id and left_at is null;
  if left_now = 0 then
    delete from public.squads where id = sq.id;
    return jsonb_build_object('gone', true);
  end if;
  update public.squads set rekey = true,
    created_by = case when created_by = t.id then (select id from public.squad_members where squad_id = sq.id and left_at is null order by joined_at limit 1) else created_by end,
    updated_at = now()
    where id = sq.id;
  return jsonb_build_object('gone', false);
end $$;

-- The next squad key: one sealed drop for exactly every member still in, then gen + 1.
create or replace function public.squad_rekey(p_member uuid, p_from_gen integer, p_drops jsonb, p_meta_ct text)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; sq public.squads; want uuid[]; got uuid[];
begin
  select * into me from public.squad_members where id = p_member and left_at is null;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = me.squad_id for update;
  if not sq.rekey or sq.gen <> p_from_gen then return jsonb_build_object('done', false, 'gen', sq.gen); end if;
  select coalesce(array_agg(id order by id), '{}') into want from public.squad_members where squad_id = sq.id and left_at is null;
  select coalesce(array_agg((d->>'member')::uuid order by (d->>'member')::uuid), '{}') into got from jsonb_array_elements(p_drops) d;
  if want <> got then raise exception 'drops' using errcode = 'P0001'; end if;
  insert into public.squad_keydrops (member_id, gen, squad_id, sealed)
    select (d->>'member')::uuid, p_from_gen + 1, sq.id, d->>'sealed' from jsonb_array_elements(p_drops) d;
  update public.squads set gen = p_from_gen + 1, rekey = false, meta_ct = p_meta_ct, meta_gen = p_from_gen + 1, updated_at = now() where id = sq.id;
  delete from public.squad_invites where squad_id = sq.id and used_at is null;
  return jsonb_build_object('done', true, 'gen', p_from_gen + 1);
end $$;

-- Housekeeping (the edge function runs it now and then): old nonces, old tombstones, settled hand overs,
-- spent invites, members who left a month ago.
create or replace function public.squad_tidy()
returns void language sql set search_path = '' as $$
  delete from public.squad_nonces where at < now() - interval '10 minutes';
  delete from public.squad_tasks where deleted and updated_at < now() - interval '30 days';
  delete from public.squad_handoffs where state <> 'open' and updated_at < now() - interval '30 days';
  delete from public.squad_invites where (used_at is not null or expires_at < now()) and coalesce(used_at, expires_at) < now() - interval '7 days';
  delete from public.squad_members where left_at is not null and left_at < now() - interval '30 days';
$$;

revoke all on function public.squad_create(text, text, text) from public, anon, authenticated;
revoke all on function public.squad_join(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.squad_leave(uuid, uuid) from public, anon, authenticated;
revoke all on function public.squad_rekey(uuid, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.squad_tidy() from public, anon, authenticated;
grant execute on function public.squad_create(text, text, text) to service_role;
grant execute on function public.squad_join(uuid, text, text, text) to service_role;
grant execute on function public.squad_leave(uuid, uuid) to service_role;
grant execute on function public.squad_rekey(uuid, integer, jsonb, text) to service_role;
grant execute on function public.squad_tidy() to service_role;
