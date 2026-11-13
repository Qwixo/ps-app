-- G Squad hub (V1.55): The G Squad can never get stuck again. Supabase project zxhvchchfrkfqxuyorqo only.
-- Applied live on 12 Nov 2026 on the developer's word ("just make a squad and then just have everyone automatically join it").
--
-- What was wrong (live state before this, 12 Nov 2026): one squad, The G Squad, 3 people in it, and NOBODY holding
-- the squad key. The squad still said "re-key in progress" (rekey = true) from an earlier leave, but the only member
-- who held the key had been deleted by auto_join's "joined long ago and never got in" step, which deletes a row
-- directly and never looks at the squad. A re-key needs someone with the key, and the key is only ever handed out
-- when no re-key is going on, so all 3 waited for ever and the developer's PS showed "Getting you into The G Squad" for ever.
--
-- What this does, all on the hub, so no PS update is needed:
--   * auto_heal(squad): if nobody who is properly in (has the key AND has posted their card) holds the key, and
--     nobody got the key in the last 10 minutes (their card is on its way), the squad starts over with no key: a new
--     gen, no sealed name, no re-key, old key drops gone. The next PS that checks (every 3 minutes, every 20 s while
--     G Squad is open) makes the new key and hands it to everyone else, as on day one.
--   * It runs at the end of every change to who is in or who holds the key (a deferred trigger, so it sees the whole
--     change, including direct deletes and the 7 day tidy), on every join, and on every "is my key here yet" check.
--   * A drop is only handed out for the key in use now (gen = the squad's gen), never an old one.
--   * A second device of the same person (same who) no longer throws out a first device that is in and working:
--     it is told "already in" and waits for the squad record to arrive through its own vault, as designed.
--   * Room for 200 people (was 30) and 200 joins a day (was 60). The edge function takes up to 201 re-key drops.
--   * the developer stays the admin: the first time his PS proves it is his account (vault_role() = 'red', unchanged), the hub
--     remembers his join id (who, a hash only his own vault can make). From then on any of his devices that is in
--     becomes the admin by itself, also after a start over.
-- Zero knowledge unchanged: the hub still never sees a squad key, a name or a task title. RLS unchanged.

-- ---------- The developer's join id, remembered ----------
alter table public.dir_config add column if not exists admin_who text check (admin_who ~ '^[0-9a-f]{64}$');

-- ---------- the heal ----------
create or replace function public.auto_heal(p_squad uuid) returns text language plpgsql set search_path = '' as $$
declare sq public.squads; aw text; adm uuid;
begin
  select * into sq from public.squads where id = p_squad;
  if not found then return 'none'; end if;

  -- The developer's member (any of his devices that is in) is the admin of The G Squad.
  select admin_who into aw from public.dir_config where id and listed_squad = sq.id;
  if aw is not null and (sq.created_by is null or not exists (select 1 from public.squad_members where id = sq.created_by and left_at is null)) then
    select id into adm from public.squad_members where squad_id = sq.id and left_at is null and who = aw
      order by (card_ct is not null) desc, joined_at desc limit 1;
    if adm is not null then update public.squads set created_by = adm, updated_at = now() where id = sq.id; end if;
  end if;

  -- Someone who is properly in holds the key: all good (they hand it out, or re-key).
  if exists (select 1 from public.squad_members where squad_id = sq.id and left_at is null and has_key and card_ct is not null) then return 'ok'; end if;
  -- Someone got the key a moment ago and their card is on its way.
  if exists (select 1 from public.squad_members where squad_id = sq.id and left_at is null and has_key and card_ct is null
             and updated_at > now() - interval '10 minutes') then return 'wait'; end if;
  -- No key yet and nothing half done: the next PS to check makes it.
  if sq.meta_ct is null and not sq.rekey and not exists (select 1 from public.squad_members where squad_id = sq.id and left_at is null and has_key) then
    return 'fresh';
  end if;

  -- Stuck: nobody who is in holds the key. Start over (lock, then look again: two heals at once do it once).
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

-- At the end of any change to who is in or who holds the key (not on heartbeats: those touch last_beat only).
create or replace function public.auto_heal_trg() returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.auto_heal(old.squad_id);
  return null;
end $$;
drop trigger if exists squad_members_heal on public.squad_members;
create constraint trigger squad_members_heal after update of has_key, left_at, card_ct or delete on public.squad_members
  deferrable initially deferred for each row execute function public.auto_heal_trg();

-- ---------- joining, kinder to a second device, more room ----------
create or replace function public.auto_join(p_sign_pub text, p_box_pub text, p_who text)
returns jsonb language plpgsql set search_path = '' as $$
declare sid uuid; sq public.squads; old public.squad_members; n integer; mid uuid; aw text;
begin
  sid := public.auto_squad();
  perform public.auto_heal(sid);
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
        delete from public.squad_members where id = old.id;   -- joined long ago and never got in: start over (the heal tidies the key)
      elsif old.last_beat is not null and old.last_beat > now() - interval '1 day' then
        -- Their other device is in and working: its record comes through their own vault. Never throw it out.
        raise exception 'member' using errcode = 'P0001';
      else
        perform public.squad_leave(old.id, old.id);           -- their old place (a vault that lost its record): out, re-key
      end if;
    end if;
  end if;
  select count(*) into n from public.squad_members where squad_id = sid and left_at is null;
  if n >= 200 then raise exception 'full' using errcode = 'P0001'; end if;
  select count(*) into n from public.squad_members where squad_id = sid and joined_at > now() - interval '1 day';
  if n >= 200 then raise exception 'busy' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = sid;
  insert into public.squad_members (squad_id, sign_pub, box_pub, who, has_key) values (sid, p_sign_pub, p_box_pub, p_who, false) returning id into mid;
  -- The developer's other device joining: the admin straight away (his account was proven once before).
  select admin_who into aw from public.dir_config where id and listed_squad = sid;
  if aw is not null and p_who = aw and (sq.created_by is null or not exists (select 1 from public.squad_members where id = sq.created_by and left_at is null)) then
    update public.squads set created_by = mid, updated_at = now() where id = sid;
  end if;
  return jsonb_build_object('squad', sid, 'member', mid, 'gen', sq.gen, 'start', sq.meta_ct is null, 'key', false);
end $$;

-- ---------- The developer's admin, remembered ----------
create or replace function public.auto_admin(p_member uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members;
begin
  select * into me from public.squad_members where id = p_member and left_at is null;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.dir_config where id and listed_squad = me.squad_id) then raise exception 'unlisted' using errcode = 'P0001'; end if;
  update public.squads set created_by = me.id, updated_at = now() where id = me.squad_id and created_by is distinct from me.id;
  if me.who is not null then update public.dir_config set admin_who = me.who where id and admin_who is distinct from me.who; end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.auto_heal(uuid) from public, anon, authenticated;
revoke all on function public.auto_heal_trg() from public, anon, authenticated;
revoke all on function public.auto_join(text, text, text) from public, anon, authenticated;
revoke all on function public.auto_admin(uuid) from public, anon, authenticated;
grant execute on function public.auto_heal(uuid) to service_role;
grant execute on function public.auto_join(text, text, text) to service_role;
grant execute on function public.auto_admin(uuid) to service_role;

-- ---------- unstick The G Squad now ----------
select public.auto_heal(listed_squad) from public.dir_config where id and listed_squad is not null;
