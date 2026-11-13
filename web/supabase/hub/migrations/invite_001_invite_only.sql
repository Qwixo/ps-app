-- G Squad hub (V1.57): The G Squad is invite only again. Supabase project zxhvchchfrkfqxuyorqo only.
-- The developer, 13 Nov 2026: "Yes, lock it." NOT RUN: the manager applies it, THEN deploys the `squad` function that goes with
-- it (and the one line changes in chat, board, gym and sb). Applying this migration alone already closes the leak:
-- the live squad function v8 keeps working on top of it.
--
-- What was wrong (V1.49 to V1.56): auto_join gave ANY new key a member row at once, and every member's running PS
-- sealed the squad key to everyone waiting (auto_waiting, auto_drop). So anyone with PS app (or a script with a new
-- key pair) was handed the squad key within minutes and could read everything members share. On top of that, the
-- admin's PS (V1.49+) let every old style Ask to join in by itself, with no button.
--
-- What this does, all on the hub:
--   * Every member row gets `admitted`. Everyone in today is admitted (nothing about them changes). A one time invite
--     (Add friend QR code or link, squad_join) admits. Anything else is NOT admitted.
--   * auto_join still answers V1.49+ apps the same way, but a brand new person gets a WAITING row (admitted false):
--     that is their Ask to join. Nobody hands them the squad key: auto_waiting lists only admitted people, auto_drop
--     and auto_start refuse anyone else, and the database itself refuses a key drop, the key flag or a card for a row
--     that is not admitted (trigger and check below), so no PS version and no bug in the function can hand it over.
--   * Only the admin (the developer) lets a waiting person in (invite_admit) or turns them away (invite_turn_away, which also
--     keeps that join id from asking again by itself). After invite_admit, members' PS hand the key over as before.
--   * auto_join never throws out a person who is in any more (it used to replace a member's old place when a second
--     device brought the same join id; that id is only a hash of an account id, so it must not decide anything).
--     A second device of someone who is in gets "already in" and waits for its record through the vault, as before.
--   * The admin is never picked by join id alone any more: only admitted rows can become admin.
--   * Old style Ask to join (dir_ask) and its Approve (dir_approve) are closed: V1.49+ admin PS approved those by
--     itself, with no button.
--   * Waiting rows are limited (20 at once) and do not count towards the 200 people.
-- Zero knowledge unchanged: the hub still never sees a squad key, a name or a task title. RLS and grants unchanged
-- (every new function: service role only).

-- ---------- who is let in ----------
alter table public.squad_members add column if not exists admitted boolean not null default true;   -- everyone in today
alter table public.squad_members alter column admitted set default false;                            -- nobody new by default
-- An Ask to join from V1.57+: the asker's name and keys sealed to the admin's box key (the hub cannot open it).
alter table public.squad_members add column if not exists ask_ct text check (ask_ct is null or length(ask_ct) <= 2000);
create index if not exists squad_members_asking on public.squad_members(squad_id) where not admitted and left_at is null;
-- A row that is not admitted never holds the key and never has a card.
alter table public.squad_members drop constraint if exists squad_members_admitted;
alter table public.squad_members add constraint squad_members_admitted check (admitted or (not has_key and card_ct is null));

-- A key drop only ever goes to someone admitted and still in. Runs before the has_key trigger.
create or replace function public.invite_drop_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.squad_members where id = new.member_id and admitted and left_at is null) then
    raise exception 'admitted' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists squad_keydrops_admitted on public.squad_keydrops;
create trigger squad_keydrops_admitted before insert on public.squad_keydrops for each row execute function public.invite_drop_guard();

-- ---------- joining with a one time invite (Add friend): admits ----------
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
  -- The one who made the invite must still be in and admitted.
  if not exists (select 1 from public.squad_members where id = i.created_by and left_at is null and admitted) then
    raise exception 'invite' using errcode = 'P0001';
  end if;
  select count(*) into n from public.squad_members where squad_id = sq.id and left_at is null and admitted;
  if n >= 200 then raise exception 'full' using errcode = 'P0001'; end if;
  insert into public.squad_members (squad_id, sign_pub, box_pub, admitted) values (sq.id, p_sign_pub, p_box_pub, true) returning id into m;
  update public.squad_invites set used_at = now(), used_by = m where id = i.id;
  return jsonb_build_object('squad', sq.id, 'member', m, 'gen', i.gen, 'wrapped', i.wrapped_key);
end $$;

-- ---------- joining by itself (V1.49+ apps): now an Ask to join ----------
-- Same answer shape as before, plus `admitted`. A new person gets a waiting row; nothing is handed to them.
-- Refused: 'removed' (turned away or taken out), 'member' (already in, or asked a moment ago), 'full' (200 people
-- in), 'busy' (20 people already waiting).
create or replace function public.auto_join(p_sign_pub text, p_box_pub text, p_who text)
returns jsonb language plpgsql set search_path = '' as $$
declare sid uuid; sq public.squads; old public.squad_members; n integer; mid uuid;
begin
  if p_who is null or p_who !~ '^[0-9a-f]{64}$' then raise exception 'removed' using errcode = 'P0001'; end if;
  sid := public.auto_squad();
  perform public.auto_heal(sid);
  select * into sq from public.squads where id = sid for update;
  -- The same key again (a retry after a dropped connection): the same row, nothing new.
  select * into old from public.squad_members where sign_pub = p_sign_pub and squad_id = sid and left_at is null;
  if found then
    return jsonb_build_object('squad', sid, 'member', old.id, 'gen', sq.gen, 'start', old.admitted and sq.meta_ct is null and not old.has_key,
      'key', old.has_key, 'admitted', old.admitted);
  end if;
  if exists (select 1 from public.squad_blocked where squad_id = sid and who = p_who) then
    raise exception 'removed' using errcode = 'P0001';
  end if;
  select * into old from public.squad_members where squad_id = sid and who = p_who and left_at is null order by joined_at desc limit 1;
  if found then
    -- In (or let in): never touched from here. Asked a moment ago (their other device): wait.
    if old.admitted or old.joined_at > now() - interval '10 minutes' then raise exception 'member' using errcode = 'P0001'; end if;
    delete from public.squad_members where id = old.id;   -- an older ask from the same person: this one replaces it
  end if;
  select count(*) into n from public.squad_members where squad_id = sid and left_at is null and admitted;
  if n >= 200 then raise exception 'full' using errcode = 'P0001'; end if;
  select count(*) into n from public.squad_members where squad_id = sid and left_at is null and not admitted;
  if n >= 20 then raise exception 'busy' using errcode = 'P0001'; end if;
  insert into public.squad_members (squad_id, sign_pub, box_pub, who, has_key, admitted) values (sid, p_sign_pub, p_box_pub, p_who, false, false)
    returning id into mid;
  return jsonb_build_object('squad', sid, 'member', mid, 'gen', sq.gen, 'start', false, 'key', false, 'admitted', false);
end $$;

-- The first key (a squad with none): admitted members only.
create or replace function public.auto_start(p_member uuid, p_gen integer, p_meta_ct text)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; sq public.squads;
begin
  select * into me from public.squad_members where id = p_member and left_at is null and admitted;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = me.squad_id for update;
  if sq.meta_ct is not null or sq.gen <> p_gen or exists (select 1 from public.squad_members where squad_id = sq.id and left_at is null and has_key and id <> me.id) then
    raise exception 'started' using errcode = 'P0001';
  end if;
  update public.squads set meta_ct = p_meta_ct, meta_gen = p_gen, rekey = false, updated_at = now() where id = sq.id;
  update public.squad_members set has_key = true, updated_at = now() where id = me.id;
  return jsonb_build_object('ok', true, 'gen', p_gen);
end $$;

-- Who is waiting for the squad key: admitted people only (let in by invite or by the admin, or after a start over).
create or replace function public.auto_waiting(p_member uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'box', w.box_pub, 'sign', w.sign_pub) order by w.joined_at), '[]'::jsonb)
  from public.squad_members me
  join public.squads s on s.id = me.squad_id and not s.rekey and s.meta_ct is not null
  join lateral (select * from public.squad_members x where x.squad_id = me.squad_id and x.left_at is null and not x.has_key and x.admitted
                order by x.joined_at limit 30) w on true
  where me.id = p_member and me.left_at is null and me.has_key and me.admitted;
$$;

-- A member who holds the key hands it to admitted people waiting for it. Anyone else in the list is skipped.
create or replace function public.auto_drop(p_member uuid, p_gen integer, p_drops jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; sq public.squads; n integer := 0; d jsonb; t uuid;
begin
  select * into me from public.squad_members where id = p_member and left_at is null and has_key and admitted;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = me.squad_id for update;
  if sq.rekey or sq.gen <> p_gen then raise exception 'rekey' using errcode = 'P0001'; end if;
  for d in select * from jsonb_array_elements(p_drops) loop
    t := (d->>'member')::uuid;
    if coalesce(d->>'sealed', '') = '' or length(d->>'sealed') > 600 then raise exception 'drops' using errcode = 'P0001'; end if;
    if exists (select 1 from public.squad_members where id = t and squad_id = sq.id and left_at is null and not has_key and admitted) then
      insert into public.squad_keydrops (member_id, gen, squad_id, sealed) values (t, p_gen, sq.id, d->>'sealed') on conflict (member_id, gen) do nothing;
      if found then n := n + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('added', n);
end $$;

-- The developer's PS proved his account to the edge function: admin (admitted rows only).
create or replace function public.auto_admin(p_member uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members;
begin
  select * into me from public.squad_members where id = p_member and left_at is null and admitted;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.dir_config where id and listed_squad = me.squad_id) then raise exception 'unlisted' using errcode = 'P0001'; end if;
  update public.squads set created_by = me.id, updated_at = now() where id = me.squad_id and created_by is distinct from me.id;
  if me.who is not null then update public.dir_config set admin_who = me.who where id and admin_who is distinct from me.who; end if;
  return jsonb_build_object('ok', true);
end $$;

-- The heal (V1.55), with one change: the admin it picks back by join id must be admitted.
create or replace function public.auto_heal(p_squad uuid) returns text language plpgsql set search_path = '' as $$
declare sq public.squads; aw text; adm uuid;
begin
  select * into sq from public.squads where id = p_squad;
  if not found then return 'none'; end if;
  select admin_who into aw from public.dir_config where id and listed_squad = sq.id;
  if aw is not null and (sq.created_by is null or not exists (select 1 from public.squad_members where id = sq.created_by and left_at is null and admitted)) then
    select id into adm from public.squad_members where squad_id = sq.id and left_at is null and admitted and who = aw
      order by (card_ct is not null) desc, joined_at desc limit 1;
    if adm is not null then update public.squads set created_by = adm, updated_at = now() where id = sq.id; end if;
  end if;
  if exists (select 1 from public.squad_members where squad_id = sq.id and left_at is null and has_key and card_ct is not null) then return 'ok'; end if;
  if exists (select 1 from public.squad_members where squad_id = sq.id and left_at is null and has_key and card_ct is null
             and updated_at > now() - interval '10 minutes') then return 'wait'; end if;
  if sq.meta_ct is null and not sq.rekey and not exists (select 1 from public.squad_members where squad_id = sq.id and left_at is null and has_key) then
    return 'fresh';
  end if;
  select * into sq from public.squads where id = p_squad for update;
  if exists (select 1 from public.squad_members where squad_id = sq.id and left_at is null and has_key
             and (card_ct is not null or updated_at > now() - interval '10 minutes')) then return 'ok'; end if;
  if sq.meta_ct is null and not sq.rekey and not exists (select 1 from public.squad_members where squad_id = sq.id and left_at is null and has_key) then
    return 'fresh';
  end if;
  delete from public.squad_keydrops where squad_id = sq.id;
  update public.squad_members set has_key = false, updated_at = now() where squad_id = sq.id and left_at is null and has_key;
  update public.squads set gen = sq.gen + 1, rekey = false, meta_ct = null, meta_gen = null, updated_at = now() where id = sq.id;
  return 'reset';
end $$;

-- ---------- the admin's answer to an Ask to join ----------
-- Let in: the row becomes admitted; members' PS then hand them the squad key (auto_waiting, auto_drop) as before.
create or replace function public.invite_admit(p_admin uuid, p_target uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; sq public.squads; t public.squad_members; n integer;
begin
  select * into me from public.squad_members where id = p_admin and left_at is null and admitted;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = me.squad_id for update;
  if sq.created_by is distinct from me.id then raise exception 'admin' using errcode = 'P0001'; end if;
  select * into t from public.squad_members where id = p_target and squad_id = sq.id and left_at is null for update;
  if not found or t.admitted then raise exception 'request' using errcode = 'P0001'; end if;
  select count(*) into n from public.squad_members where squad_id = sq.id and left_at is null and admitted;
  if n >= 200 then raise exception 'full' using errcode = 'P0001'; end if;
  update public.squad_members set admitted = true, ask_ct = null, updated_at = now() where id = t.id;
  return jsonb_build_object('ok', true);
end $$;

-- Turn away: the waiting row goes, and that join id cannot ask again by itself (a new invite still works).
create or replace function public.invite_turn_away(p_admin uuid, p_target uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; sq public.squads; t public.squad_members;
begin
  select * into me from public.squad_members where id = p_admin and left_at is null and admitted;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = me.squad_id for update;
  if sq.created_by is distinct from me.id then raise exception 'admin' using errcode = 'P0001'; end if;
  select * into t from public.squad_members where id = p_target and squad_id = sq.id and left_at is null for update;
  if not found or t.admitted then raise exception 'request' using errcode = 'P0001'; end if;
  delete from public.squad_members where id = t.id;
  if t.who is not null then insert into public.squad_blocked (squad_id, who) values (sq.id, t.who) on conflict do nothing; end if;
  return jsonb_build_object('ok', true);
end $$;

-- The asker (V1.57+) leaves their name for the admin: sealed to the admin's box key, opaque to the hub.
create or replace function public.invite_ask(p_member uuid, p_sealed text)
returns jsonb language plpgsql set search_path = '' as $$
begin
  if p_sealed is null or p_sealed = '' or length(p_sealed) > 2000 then raise exception 'drops' using errcode = 'P0001'; end if;
  update public.squad_members set ask_ct = p_sealed, updated_at = now() where id = p_member and left_at is null and not admitted;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- The asker gives up (or a waiting PS leaves): the row just goes. No re-key: they never held the key.
create or replace function public.invite_withdraw(p_member uuid)
returns jsonb language plpgsql set search_path = '' as $$
begin
  delete from public.squad_members where id = p_member and left_at is null and not admitted;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  return jsonb_build_object('gone', false);
end $$;

-- ---------- the old Ask to join (V1.42 directory) is closed ----------
-- V1.49+ admin PS approved these by itself, with no button. Older PS apps that still ask are told the squad is not
-- open (their screen says "That squad is not open to join right now.").
create or replace function public.dir_ask(p_id uuid, p_squad uuid, p_sign_pub text, p_box_pub text, p_admin_box text, p_sealed text)
returns jsonb language plpgsql set search_path = '' as $$
begin
  raise exception 'unlisted' using errcode = 'P0001';
end $$;
create or replace function public.dir_approve(p_admin uuid, p_request uuid, p_member uuid, p_gen integer, p_drop text, p_card text)
returns jsonb language plpgsql set search_path = '' as $$
begin
  raise exception 'admin' using errcode = 'P0001';
end $$;
update public.dir_requests set state = 'cancelled', sealed = '', updated_at = now() where state = 'open';

revoke all on function public.invite_drop_guard() from public, anon, authenticated;
revoke all on function public.squad_join(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.auto_join(text, text, text) from public, anon, authenticated;
revoke all on function public.auto_start(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.auto_waiting(uuid) from public, anon, authenticated;
revoke all on function public.auto_drop(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.auto_admin(uuid) from public, anon, authenticated;
revoke all on function public.auto_heal(uuid) from public, anon, authenticated;
revoke all on function public.invite_admit(uuid, uuid) from public, anon, authenticated;
revoke all on function public.invite_turn_away(uuid, uuid) from public, anon, authenticated;
revoke all on function public.invite_ask(uuid, text) from public, anon, authenticated;
revoke all on function public.invite_withdraw(uuid) from public, anon, authenticated;
revoke all on function public.dir_ask(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.dir_approve(uuid, uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.squad_join(uuid, text, text, text) to service_role;
grant execute on function public.auto_join(text, text, text) to service_role;
grant execute on function public.auto_start(uuid, integer, text) to service_role;
grant execute on function public.auto_waiting(uuid) to service_role;
grant execute on function public.auto_drop(uuid, integer, jsonb) to service_role;
grant execute on function public.auto_admin(uuid) to service_role;
grant execute on function public.auto_heal(uuid) to service_role;
grant execute on function public.invite_admit(uuid, uuid) to service_role;
grant execute on function public.invite_turn_away(uuid, uuid) to service_role;
grant execute on function public.invite_ask(uuid, text) to service_role;
grant execute on function public.invite_withdraw(uuid) to service_role;
grant execute on function public.dir_ask(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.dir_approve(uuid, uuid, uuid, integer, text, text) to service_role;
