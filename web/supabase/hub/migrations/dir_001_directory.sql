-- G Squad hub (V1.42): the squad directory ("See available squads") and Ask to join. Additive: no core table changes.
--
-- The listing lock. Exactly ONE squad may ever be listed for now ("The G Squad", made by the developer):
--   * dir_config can hold one row only (its key is the constant true).
--   * That row holds the sha256 of a one-time claim code. Only the developer has the code (kept off every build and every
--     repo). Listing a squad needs that code, spends it (claim_hash set to null) and fills listed_squad, all in the
--     same step that makes the squad (dir_create_listed).
--   * A trigger refuses any other change: once listed_squad is set it can never change or be cleared, a new claim
--     can never be set while a squad is listed, nothing may list without spending the claim, and the row can never
--     be deleted. No client role can touch the table at all (RLS forced, restrictive deny, no grants).
-- So a modified PS cannot list anything: without the code the hub refuses, and after the developer uses it there is nothing
-- left to claim. Future listed squads need a new migration (on purpose).
--
-- Ask to join. A request carries the asker's two public keys and a blob sealed to the squad admin's box key (their
-- name in the squad and the same two public keys). The hub never sees the name. The admin's device checks the blob
-- names the same keys as the hub row before it seals the squad key to that box key (the keydrop, as for a re-key).

create table public.dir_config (
  id boolean primary key default true check (id),                  -- one row, ever
  claim_hash text check (claim_hash ~ '^[0-9a-f]{64}$'),            -- sha256 of the developer's one-time code; null once spent
  listed_squad uuid,                                                 -- no foreign key: a deleted squad never frees the slot
  listed_at timestamptz
);
insert into public.dir_config (id) values (true);

create or replace function public.dir_config_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'locked' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' then raise exception 'locked' using errcode = 'P0001'; end if;
  if old.listed_squad is not null and new.listed_squad is distinct from old.listed_squad then raise exception 'locked' using errcode = 'P0001'; end if;
  if old.listed_squad is not null and new.claim_hash is not null then raise exception 'locked' using errcode = 'P0001'; end if;
  if old.listed_squad is null and new.listed_squad is not null and (old.claim_hash is null or new.claim_hash is not null) then
    raise exception 'locked' using errcode = 'P0001';
  end if;
  if new.listed_at is distinct from old.listed_at and (old.listed_squad is not null or new.listed_squad is null) then raise exception 'locked' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger dir_config_guard before insert or update or delete on public.dir_config for each row execute function public.dir_config_guard();
create or replace function public.dir_config_no_truncate()
returns trigger language plpgsql set search_path = '' as $$ begin raise exception 'locked' using errcode = 'P0001'; end $$;
create trigger dir_config_no_truncate before truncate on public.dir_config for each statement execute function public.dir_config_no_truncate();

create table public.dir_requests (
  id uuid primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  sign_pub text not null check (sign_pub ~ '^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$'),
  box_pub text not null check (box_pub ~ '^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$'),
  admin_box text not null check (admin_box ~ '^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$'),   -- the key the blob is sealed to
  sealed text not null check (length(sealed) <= 2000),               -- name and keys, sealed to the admin; '' once settled
  state text not null default 'open' check (state in ('open', 'approved', 'declined', 'cancelled')),
  member_id uuid references public.squad_members(id) on delete set null,   -- the new member, once approved
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index dir_requests_sign on public.dir_requests(sign_pub);
create index dir_requests_squad on public.dir_requests(squad_id, state);
create index dir_requests_member on public.dir_requests(member_id);

alter table public.dir_config enable row level security;
alter table public.dir_config force row level security;
alter table public.dir_requests enable row level security;
alter table public.dir_requests force row level security;
revoke all on table public.dir_config from anon, authenticated, public;
revoke all on table public.dir_requests from anon, authenticated, public;
grant select, update on table public.dir_config to service_role;
grant all on table public.dir_requests to service_role;
create policy "no client access" on public.dir_config as restrictive for all to anon, authenticated using (false) with check (false);
create policy "no client access" on public.dir_requests as restrictive for all to anon, authenticated using (false) with check (false);

-- ---------- steps (called only by the edge function, as service_role) ----------

-- Make a squad AND list it, in one go, spending the one-time claim. Wrong code, or already spent: nothing happens.
create or replace function public.dir_create_listed(p_id uuid, p_sign_pub text, p_box_pub text, p_meta_ct text, p_code_hash text)
returns jsonb language plpgsql set search_path = '' as $$
declare c public.dir_config; m uuid;
begin
  select * into c from public.dir_config where id for update;
  if not found or c.listed_squad is not null or c.claim_hash is null or c.claim_hash <> p_code_hash then
    raise exception 'claim' using errcode = 'P0001';
  end if;
  insert into public.squads (id, meta_ct, meta_gen) values (p_id, p_meta_ct, 1);
  insert into public.squad_members (squad_id, sign_pub, box_pub) values (p_id, p_sign_pub, p_box_pub) returning id into m;
  update public.squads set created_by = m where id = p_id;
  update public.dir_config set claim_hash = null, listed_squad = p_id, listed_at = now() where id;
  return jsonb_build_object('squad', p_id, 'member', m, 'gen', 1);
end $$;

-- The directory: listed squads that still exist, with the admin's box key (asks are sealed to it).
create or replace function public.dir_list()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'slot', 'gsquad', 'admin_box', m.box_pub)), '[]'::jsonb)
  from public.dir_config c join public.squads s on s.id = c.listed_squad
  join public.squad_members m on m.id = s.created_by and m.left_at is null
  where c.id;
$$;

-- Ask to join a listed squad. Limits: one request per key; a declined or cancelled key waits an hour before asking
-- again; at most 20 open requests and 60 asks a day per squad (so nobody can flood the admin).
create or replace function public.dir_ask(p_id uuid, p_squad uuid, p_sign_pub text, p_box_pub text, p_admin_box text, p_sealed text)
returns jsonb language plpgsql set search_path = '' as $$
declare sq public.squads; adm text; old public.dir_requests; n integer;
begin
  if not exists (select 1 from public.dir_config where id and listed_squad = p_squad) then raise exception 'unlisted' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = p_squad for update;
  if not found then raise exception 'unlisted' using errcode = 'P0001'; end if;
  select box_pub into adm from public.squad_members where id = sq.created_by and left_at is null;
  if adm is null or adm <> p_admin_box then raise exception 'admin' using errcode = 'P0001'; end if;
  if exists (select 1 from public.squad_members where sign_pub = p_sign_pub) then raise exception 'member' using errcode = 'P0001'; end if;
  select * into old from public.dir_requests where sign_pub = p_sign_pub for update;
  if found then
    if old.state = 'open' then raise exception 'open' using errcode = 'P0001'; end if;
    if old.state = 'approved' then raise exception 'member' using errcode = 'P0001'; end if;
    if old.updated_at > now() - interval '1 hour' then raise exception 'slow' using errcode = 'P0001'; end if;
    delete from public.dir_requests where id = old.id;
  end if;
  select count(*) into n from public.dir_requests where squad_id = p_squad and state = 'open';
  if n >= 20 then raise exception 'busy' using errcode = 'P0001'; end if;
  select count(*) into n from public.dir_requests where squad_id = p_squad and created_at > now() - interval '1 day';
  if n >= 60 then raise exception 'busy' using errcode = 'P0001'; end if;
  insert into public.dir_requests (id, squad_id, sign_pub, box_pub, admin_box, sealed) values (p_id, p_squad, p_sign_pub, p_box_pub, p_admin_box, p_sealed);
  return jsonb_build_object('ok', true);
end $$;

-- The admin lets someone in: the new member (id picked by the admin's device, so the key drop's aad can name it),
-- their card sealed by the admin from the checked request, and the squad key sealed to their box key. Refused while
-- a re-key is due or when the key gen moved on.
create or replace function public.dir_approve(p_admin uuid, p_request uuid, p_member uuid, p_gen integer, p_drop text, p_card text)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; sq public.squads; r public.dir_requests; n integer;
begin
  select * into me from public.squad_members where id = p_admin and left_at is null;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = me.squad_id for update;
  if sq.created_by is distinct from me.id then raise exception 'admin' using errcode = 'P0001'; end if;
  if sq.rekey or sq.gen <> p_gen then raise exception 'rekey' using errcode = 'P0001'; end if;
  select * into r from public.dir_requests where id = p_request and squad_id = sq.id for update;
  if not found or r.state <> 'open' then raise exception 'request' using errcode = 'P0001'; end if;
  select count(*) into n from public.squad_members where squad_id = sq.id and left_at is null;
  if n >= 30 then raise exception 'full' using errcode = 'P0001'; end if;
  insert into public.squad_members (id, squad_id, sign_pub, box_pub, card_ct, card_gen) values (p_member, sq.id, r.sign_pub, r.box_pub, p_card, p_gen);
  insert into public.squad_keydrops (member_id, gen, squad_id, sealed) values (p_member, p_gen, sq.id, p_drop);
  update public.dir_requests set state = 'approved', member_id = p_member, sealed = '', updated_at = now() where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

-- Housekeeping: settled requests after 30 days, open ones nobody answered after 30 days.
create or replace function public.dir_tidy()
returns void language sql set search_path = '' as $$
  delete from public.dir_requests where updated_at < now() - interval '30 days';
$$;

revoke all on function public.dir_create_listed(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.dir_list() from public, anon, authenticated;
revoke all on function public.dir_ask(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.dir_approve(uuid, uuid, uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.dir_tidy() from public, anon, authenticated;
revoke all on function public.dir_config_guard() from public, anon, authenticated;
revoke all on function public.dir_config_no_truncate() from public, anon, authenticated;
grant execute on function public.dir_create_listed(uuid, text, text, text, text) to service_role;
grant execute on function public.dir_list() to service_role;
grant execute on function public.dir_ask(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.dir_approve(uuid, uuid, uuid, integer, text, text) to service_role;
grant execute on function public.dir_tidy() to service_role;
