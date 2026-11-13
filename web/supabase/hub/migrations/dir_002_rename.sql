-- G Squad hub (V1.43): the admin renames the squad. Additive: one column, one step, the directory's name.
--
-- Every squad's name stays sealed with the squad key (squads.meta_ct), as before: renaming seals the new name under
-- the current key gen. The ONE exception is the listed squad's public name in See available squads, which everyone
-- who downloads PS sees, so it is plain text by nature: dir_config.listed_name (null = PS shows "The G Squad").
-- Only the admin of the listed squad can set it, only through dir_rename, and only for the squad already listed.
-- The listing lock is unchanged: no new way to list, swap or clear the listed squad, and no new claim.

alter table public.dir_config add column listed_name text
  check (listed_name is null or (char_length(listed_name) between 1 and 40 and listed_name !~ '[[:cntrl:]]' and btrim(listed_name) = listed_name and listed_name <> ''));

-- The guard again, with one more rule: the public name may change only while a squad is listed, and only for it.
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
  if new.listed_name is distinct from old.listed_name and (old.listed_squad is null or new.listed_squad is distinct from old.listed_squad) then
    raise exception 'locked' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Rename: the admin only, under the current key gen, never while a re-key is due. For the listed squad the public
-- name must come too (so the list and the members' sealed name never disagree); for any other squad a plain name is
-- refused, so it is never sent or stored.
create or replace function public.dir_rename(p_admin uuid, p_gen integer, p_meta_ct text, p_name text)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; sq public.squads; listed boolean;
begin
  select * into me from public.squad_members where id = p_admin and left_at is null;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  select * into sq from public.squads where id = me.squad_id for update;
  if sq.created_by is distinct from me.id then raise exception 'admin' using errcode = 'P0001'; end if;
  if sq.rekey or sq.gen <> p_gen then raise exception 'rekey' using errcode = 'P0001'; end if;
  select exists (select 1 from public.dir_config where id and listed_squad = sq.id) into listed;
  if listed and p_name is null then raise exception 'public' using errcode = 'P0001'; end if;
  if not listed and p_name is not null then raise exception 'unlisted' using errcode = 'P0001'; end if;
  update public.squads set meta_ct = p_meta_ct, meta_gen = p_gen, updated_at = now() where id = sq.id;
  if listed then update public.dir_config set listed_name = p_name where id and listed_squad = sq.id; end if;
  return jsonb_build_object('ok', true, 'listed', listed);
end $$;

-- The directory, now with the listed squad's public name (null: PS shows "The G Squad").
create or replace function public.dir_list()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'slot', 'gsquad', 'admin_box', m.box_pub, 'name', c.listed_name)), '[]'::jsonb)
  from public.dir_config c join public.squads s on s.id = c.listed_squad
  join public.squad_members m on m.id = s.created_by and m.left_at is null
  where c.id;
$$;

revoke all on function public.dir_rename(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.dir_list() from public, anon, authenticated;
revoke all on function public.dir_config_guard() from public, anon, authenticated;
grant execute on function public.dir_rename(uuid, integer, text, text) to service_role;
grant execute on function public.dir_list() to service_role;
