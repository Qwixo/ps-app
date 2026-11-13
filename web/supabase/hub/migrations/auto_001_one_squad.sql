-- G Squad hub (V1.49): The G Squad exists by itself and every PS joins it by itself. No claim code, no Ask to join,
-- no approval. Supabase project zxhvchchfrkfqxuyorqo only. NOT RUN: the manager runs it on the developer's word, then deploys
-- the `squad` edge function that goes with it (supabase/hub/functions/squad/index.ts). Run it BEFORE that deploy.
--
-- Zero knowledge stays as it was: the hub still holds only ciphertext, public keys, hashes, ids and timestamps. The
-- squad key is never made or seen here. What changes is WHO hands it out:
--   * The hub makes The G Squad's row (no key yet) and lists it, spending the old one time claim code for good.
--   * A PS that joins gets a member row at once. If the squad has no key yet, that PS makes the first one
--     (auto_start). Otherwise it waits a moment: the next PS in the squad that is running sees someone waiting
--     (the pulse's k) and seals the squad key to the newcomer's box key (auto_drop), as a re-key does.
--   * the developer becomes the admin when his PS proves to the edge function that it is his vault account (vault_role() on
--     his vault project says 'red'). The hub only stores which member is admin, as before (squads.created_by).
--   * A member without a card yet (card_ct null: they joined but their PS has not posted their name) is not counted
--     for re-keys or chat periods, so a PS that joined once and never came back can never hold the squad up.
--   * Remove (the admin's Take out) also blocks that person's join id (a hash only their own vault can make), so
--     their PS does not just join again by itself.
-- Additive. Every older step (invite links, Ask to join, Approve) keeps working for PS versions that still use them.

-- ---------- the new columns and table ----------
alter table public.squad_members add column if not exists has_key boolean not null default true;   -- holds the squad key (false: waiting for it)
alter table public.squad_members add column if not exists who text check (who ~ '^[0-9a-f]{64}$');   -- sha256 of a secret in the member's own vault
create index if not exists squad_members_who on public.squad_members(squad_id, who);
create index if not exists squad_members_waiting on public.squad_members(squad_id) where not has_key and left_at is null;

create table if not exists public.squad_blocked (
  squad_id uuid not null references public.squads(id) on delete cascade,
  who text not null check (who ~ '^[0-9a-f]{64}$'),
  at timestamptz not null default now(),
  primary key (squad_id, who)
);
alter table public.squad_blocked enable row level security;
alter table public.squad_blocked force row level security;
revoke all on table public.squad_blocked from anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'squad_blocked' and policyname = 'deny_all') then
    create policy deny_all on public.squad_blocked as restrictive for all to anon, authenticated using (false) with check (false);
  end if;
end $$;

-- Any key drop (a re-key, an Approve, auto_drop) means that member now holds a squad key.
create or replace function public.auto_drop_has_key() returns trigger language plpgsql set search_path = '' as $$
begin
  update public.squad_members set has_key = true, updated_at = now() where id = new.member_id and not has_key;
  return new;
end $$;
drop trigger if exists squad_keydrops_has_key on public.squad_keydrops;
create trigger squad_keydrops_has_key after insert on public.squad_keydrops for each row execute function public.auto_drop_has_key();

-- ---------- The G Squad itself, once ----------
-- Makes the row and lists it, spending the claim (the existing guard allows exactly this: listed_squad goes from null
-- to the new id in the same update that sets claim_hash to null). Does nothing once a squad is listed.
create or replace function public.auto_squad() returns uuid language plpgsql set search_path = '' as $$
declare c public.dir_config; sid uuid;
begin
  select * into c from public.dir_config where id for update;
  if c.listed_squad is not null and exists (select 1 from public.squads where id = c.listed_squad) then return c.listed_squad; end if;
  if c.listed_squad is not null then
    -- The listed row was deleted somehow (it never is after this migration): make it again under the same id.
    insert into public.squads (id) values (c.listed_squad) on conflict (id) do nothing;
    return c.listed_squad;
  end if;
  sid := gen_random_uuid();
  insert into public.squads (id) values (sid);
  -- The guard lists a squad only in the same step that spends a claim. With no claim set (nothing listed yet), set a
  -- throwaway one first (the guard allows a claim while nothing is listed); it is spent at once below.
  if c.claim_hash is null then
    update public.dir_config set claim_hash = encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex') where id;
  end if;
  update public.dir_config set claim_hash = null, listed_squad = sid, listed_at = now() where id;
  return sid;
end $$;
-- If dir_config has no row yet (a fresh hub), make it with a throwaway claim so the guard lets the listing through.
do $$ begin
  if not exists (select 1 from public.dir_config) then
    alter table public.dir_config disable trigger user;
    insert into public.dir_config (id, claim_hash) values (true, encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'));
    alter table public.dir_config enable trigger user;
  end if;
end $$;
select public.auto_squad();

-- ---------- joining by itself ----------
-- One step, signed with the new member's own new key (like Ask to join). Gives back the member id at once.
--   start: true when the squad has no key yet, so this PS makes the first one (auto_start).
-- Refused: 'removed' (the admin took this person out), 'member' (their other device joined a moment ago: wait for
-- that record to arrive through the vault), 'full' (30 members), 'busy' (over 60 joins in a day).
create or replace function public.auto_join(p_sign_pub text, p_box_pub text, p_who text)
returns jsonb language plpgsql set search_path = '' as $$
declare sid uuid; sq public.squads; old public.squad_members; n integer; mid uuid;
begin
  sid := public.auto_squad();
  select * into sq from public.squads where id = sid for update;
  -- The same key again (a retry after a dropped connection): the same member, nothing new.
  select * into old from public.squad_members where sign_pub = p_sign_pub and squad_id = sid and left_at is null;
  if found then
    return jsonb_build_object('squad', sid, 'member', old.id, 'gen', sq.gen, 'start', sq.meta_ct is null and not old.has_key, 'key', old.has_key);
  end if;
  if p_who is not null and exists (select 1 from public.squad_blocked where squad_id = sid and who = p_who) then
    raise exception 'removed' using errcode = 'P0001';
  end if;
  if p_who is not null then
    select * into old from public.squad_members where squad_id = sid and who = p_who and left_at is null order by joined_at desc limit 1;
    if found then
      if old.joined_at > now() - interval '10 minutes' then raise exception 'member' using errcode = 'P0001'; end if;
      if old.card_ct is null then
        delete from public.squad_members where id = old.id;   -- joined long ago and never got in: start over
      else
        perform public.squad_leave(old.id, old.id);           -- their old place (a vault that lost its record): out, re-key
      end if;
    end if;
  end if;
  select count(*) into n from public.squad_members where squad_id = sid and left_at is null;
  if n >= 30 then raise exception 'full' using errcode = 'P0001'; end if;
  select count(*) into n from public.squad_members where squad_id = sid and joined_at > now() - interval '1 day';
  if n >= 60 then raise exception 'busy' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = sid;
  insert into public.squad_members (squad_id, sign_pub, box_pub, who, has_key) values (sid, p_sign_pub, p_box_pub, p_who, false) returning id into mid;
  return jsonb_build_object('squad', sid, 'member', mid, 'gen', sq.gen, 'start', sq.meta_ct is null, 'key', false);
end $$;

-- The first key: only while the squad has none. The squad's name sealed under it comes along (so every member's PS
-- can check it). Refused with 'started' when someone else got there first (then wait for a drop).
create or replace function public.auto_start(p_member uuid, p_gen integer, p_meta_ct text)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; sq public.squads;
begin
  select * into me from public.squad_members where id = p_member and left_at is null;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = me.squad_id for update;
  if sq.meta_ct is not null or sq.gen <> p_gen or exists (select 1 from public.squad_members where squad_id = sq.id and left_at is null and has_key and id <> me.id) then
    raise exception 'started' using errcode = 'P0001';
  end if;
  update public.squads set meta_ct = p_meta_ct, meta_gen = p_gen, rekey = false, updated_at = now() where id = sq.id;
  update public.squad_members set has_key = true, updated_at = now() where id = me.id;
  return jsonb_build_object('ok', true, 'gen', p_gen);
end $$;

-- Who is waiting for the squad key (for a member who holds it). Their public keys only.
create or replace function public.auto_waiting(p_member uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'box', w.box_pub, 'sign', w.sign_pub) order by w.joined_at), '[]'::jsonb)
  from public.squad_members me
  join public.squads s on s.id = me.squad_id and not s.rekey and s.meta_ct is not null
  join lateral (select * from public.squad_members x where x.squad_id = me.squad_id and x.left_at is null and not x.has_key order by x.joined_at limit 30) w on true
  where me.id = p_member and me.left_at is null and me.has_key;
$$;

-- A member who holds the key hands it to people waiting: one sealed drop each, at the gen in use now. A drop that is
-- already there stays (two members doing it at once is fine). Never during a re-key.
create or replace function public.auto_drop(p_member uuid, p_gen integer, p_drops jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; sq public.squads; n integer := 0; d jsonb; t uuid;
begin
  select * into me from public.squad_members where id = p_member and left_at is null and has_key;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = me.squad_id for update;
  if sq.rekey or sq.gen <> p_gen then raise exception 'rekey' using errcode = 'P0001'; end if;
  for d in select * from jsonb_array_elements(p_drops) loop
    t := (d->>'member')::uuid;
    if coalesce(d->>'sealed', '') = '' or length(d->>'sealed') > 600 then raise exception 'drops' using errcode = 'P0001'; end if;
    if exists (select 1 from public.squad_members where id = t and squad_id = sq.id and left_at is null and not has_key) then
      insert into public.squad_keydrops (member_id, gen, squad_id, sealed) values (t, p_gen, sq.id, d->>'sealed') on conflict (member_id, gen) do nothing;
      if found then n := n + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('added', n);
end $$;

-- The developer's PS, after the edge function checked with his vault that it is his account: he is the admin.
create or replace function public.auto_admin(p_member uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members;
begin
  select * into me from public.squad_members where id = p_member and left_at is null;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.dir_config where id and listed_squad = me.squad_id) then raise exception 'unlisted' using errcode = 'P0001'; end if;
  update public.squads set created_by = me.id, updated_at = now() where id = me.squad_id and created_by is distinct from me.id;
  return jsonb_build_object('ok', true);
end $$;

-- The admin takes someone out of The G Squad: out (as before), and their join id is blocked so their PS does not
-- just join again by itself.
create or replace function public.auto_remove(p_admin uuid, p_target uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare t public.squad_members; out jsonb;
begin
  select * into t from public.squad_members where id = p_target and left_at is null;
  out := public.squad_leave(p_admin, p_target);
  if t.who is not null and p_target <> p_admin then
    insert into public.squad_blocked (squad_id, who) values (t.squad_id, t.who) on conflict do nothing;
  end if;
  return out;
end $$;

-- ---------- older steps, made safe for one squad that everyone is in ----------
-- Leaving: as before, except The G Squad itself is never deleted. When its last member leaves it goes back to no key
-- (the next PS to join makes a new one under a new gen, so an old key opens nothing new).
create or replace function public.squad_leave(p_member uuid, p_target uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; t public.squad_members; sq public.squads; left_now integer; listed boolean;
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
  listed := exists (select 1 from public.dir_config where id and listed_squad = sq.id);
  select count(*) into left_now from public.squad_members where squad_id = sq.id and left_at is null;
  if left_now = 0 and not listed then
    delete from public.squads where id = sq.id;
    return jsonb_build_object('gone', true);
  end if;
  if left_now = 0 then
    update public.squads set gen = sq.gen + 1, rekey = false, meta_ct = null, meta_gen = null, created_by = null, updated_at = now() where id = sq.id;
    return jsonb_build_object('gone', false);
  end if;
  -- Nobody still in holds the key (only people waiting for it): back to no key, the next one in makes a new one.
  if not exists (select 1 from public.squad_members where squad_id = sq.id and left_at is null and has_key) then
    update public.squads set gen = sq.gen + 1, rekey = false, meta_ct = null, meta_gen = null,
      created_by = case when created_by = t.id then null else created_by end, updated_at = now() where id = sq.id;
    return jsonb_build_object('gone', false);
  end if;
  update public.squads set rekey = true,
    -- The admin of The G Squad is the developer's member alone (auto_admin); when he leaves nobody else becomes admin.
    created_by = case when created_by = t.id then (case when listed then null else (select id from public.squad_members where squad_id = sq.id and left_at is null order by joined_at limit 1) end) else created_by end,
    updated_at = now()
    where id = sq.id;
  return jsonb_build_object('gone', false);
end $$;

-- The next squad key: a drop for every member still in WHO HAS A CARD (anyone without one has not got in yet and is
-- handed the new key by auto_drop instead). Members without a card lose has_key, so they show as waiting again.
create or replace function public.squad_rekey(p_member uuid, p_from_gen integer, p_drops jsonb, p_meta_ct text)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; sq public.squads; want uuid[]; got uuid[];
begin
  select * into me from public.squad_members where id = p_member and left_at is null;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = me.squad_id for update;
  if not sq.rekey or sq.gen <> p_from_gen then return jsonb_build_object('done', false, 'gen', sq.gen); end if;
  select coalesce(array_agg(id order by id), '{}') into want from public.squad_members where squad_id = sq.id and left_at is null and card_ct is not null;
  select coalesce(array_agg((d->>'member')::uuid order by (d->>'member')::uuid), '{}') into got from jsonb_array_elements(p_drops) d;
  if want <> got then raise exception 'drops' using errcode = 'P0001'; end if;
  insert into public.squad_keydrops (member_id, gen, squad_id, sealed)
    select (d->>'member')::uuid, p_from_gen + 1, sq.id, d->>'sealed' from jsonb_array_elements(p_drops) d;
  update public.squad_members set has_key = false, updated_at = now() where squad_id = sq.id and left_at is null and card_ct is null and not (id = any(got));
  update public.squads set gen = p_from_gen + 1, rekey = false, meta_ct = p_meta_ct, meta_gen = p_from_gen + 1, updated_at = now() where id = sq.id;
  delete from public.squad_invites where squad_id = sq.id and used_at is null;
  return jsonb_build_object('done', true, 'gen', p_from_gen + 1);
end $$;

-- Chat periods count only members with a card (the same rule as the re-key). When a newcomer's card arrives the
-- members change, a new period starts, and the history vote ("X just joined...") starts as before.
create or replace function public.chat_in(p_squad uuid)
returns uuid[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(id order by id), '{}') from public.squad_members where squad_id = p_squad and left_at is null and card_ct is not null;
$$;

-- The directory still answers older PS versions (Ask to join). With no admin yet it lists nothing for them, as
-- before; newer PS versions do not use it to join.
-- (dir_list is unchanged.)

-- Housekeeping: someone who joined a week ago and never got their name in (PS opened once, never again) goes.
create or replace function public.auto_tidy()
returns void language sql set search_path = '' as $$
  delete from public.squad_members where left_at is null and card_ct is null and joined_at < now() - interval '7 days';
$$;

revoke all on function public.auto_squad() from public, anon, authenticated;
revoke all on function public.auto_join(text, text, text) from public, anon, authenticated;
revoke all on function public.auto_start(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.auto_waiting(uuid) from public, anon, authenticated;
revoke all on function public.auto_drop(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.auto_admin(uuid) from public, anon, authenticated;
revoke all on function public.auto_remove(uuid, uuid) from public, anon, authenticated;
revoke all on function public.auto_tidy() from public, anon, authenticated;
revoke all on function public.auto_drop_has_key() from public, anon, authenticated;
revoke all on function public.squad_leave(uuid, uuid) from public, anon, authenticated;
revoke all on function public.squad_rekey(uuid, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.chat_in(uuid) from public, anon, authenticated;
grant execute on function public.auto_squad() to service_role;
grant execute on function public.auto_join(text, text, text) to service_role;
grant execute on function public.auto_start(uuid, integer, text) to service_role;
grant execute on function public.auto_waiting(uuid) to service_role;
grant execute on function public.auto_drop(uuid, integer, jsonb) to service_role;
grant execute on function public.auto_admin(uuid) to service_role;
grant execute on function public.auto_remove(uuid, uuid) to service_role;
grant execute on function public.auto_tidy() to service_role;
grant execute on function public.squad_leave(uuid, uuid) to service_role;
grant execute on function public.squad_rekey(uuid, integer, jsonb, text) to service_role;
grant execute on function public.chat_in(uuid) to service_role;
