-- G Squad v3 (PS 1.65): direct messages, group chats and profile pictures. Hub project zxhvchchfrkfqxuyorqo only.
-- NOT APPLIED: the manager applies it BEFORE deploying the new `dm` function. Additive: new dm_ tables and functions,
-- nothing existing changes (it reads squads and squad_members, and uses squad_nonces for the replay guard).
-- Rollback: dm_001_rollback.sql (drops only what this file made).
-- DB PROOF (not run on the live hub, this repo has no database; read it as a plan):
--   every read is by a key that has an index: dm_members(member_id) where active, dm_messages(conv_id, created_at) and
--   (conv_id, updated_at), dm_keydrops pk (conv_id, member_id, epoch), dm_avatars(squad_id, updated_at).
--   One conversation list per member is bounded by 100 rows; a pull is bounded by 200 or 500 rows.
--   Housekeeping (dm_tidy) runs at most once a day (a one row gate table), every delete is bounded (limit) and reached by an
--   index: dm_messages(updated_at) where deleted, dm_keydrops(member_id), dm_reads(member_id), dm_convs(updated_at),
--   squad_members(left_at desc) where left_at is not null (one small partial index on an existing table, additive).
--   No cron: the edge function calls dm_tidy now and then, the gate makes all but one call a day return at once. No recurring DDL.
--   Retention: dm_epochs rows go with their conversation (cascade); deleted messages after 30 days (dm_tidy).
-- Privacy: the hub stores ciphertext, public keys, ids, counts and times. It does see WHO is in each conversation and when
-- messages are sent (it has to, to deliver them). It never sees a key, a name, a title, a message or a picture.
-- Rate limits (in the functions): 30 messages a minute per member (shared by DMs and groups), 10 new conversations a
-- minute, one picture change per 10 seconds; the edge function adds 120 calls a minute per member.
begin;

create table public.dm_convs (
  id uuid primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  kind text not null check (kind in ('dm', 'group')),
  created_by uuid not null references public.squad_members(id) on delete cascade,
  epoch integer not null default 1 check (epoch >= 1),                -- group: the key period; dm: the derivation epoch
  key_members uuid[] not null default '{}',                           -- group: sorted ids the current epoch key was sealed to
  title_ct text check (title_ct is null or length(title_ct) <= 400),  -- group: the name, sealed with the group key
  last_at timestamptz,                                                -- newest message time (the cheap look reads this)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dm_convs_squad on public.dm_convs(squad_id);
create index dm_convs_creator_new on public.dm_convs(created_by, created_at);

create table public.dm_members (
  conv_id uuid not null references public.dm_convs(id) on delete cascade,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  since_epoch integer not null default 1,                             -- group: the first epoch this member holds a key for
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (conv_id, member_id)
);
create index dm_members_active on public.dm_members(member_id) where removed_at is null;
create index dm_convs_updated on public.dm_convs(updated_at);

create table public.dm_keydrops (
  conv_id uuid not null references public.dm_convs(id) on delete cascade,
  epoch integer not null,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  sealed text not null check (length(sealed) <= 600),
  sig text not null check (length(sig) between 1 and 200),            -- the maker's signature over this copy (checked on the devices, never here)
  created_at timestamptz not null default now(),
  primary key (conv_id, member_id, epoch)
);
create index dm_keydrops_member on public.dm_keydrops(member_id);

-- The signed envelope of each group epoch: who made it, who created the group, the exact member list and the sealed name.
-- The hub only stores it; every device checks the signature against the maker's signed card.
create table public.dm_epochs (
  conv_id uuid not null references public.dm_convs(id) on delete cascade,
  epoch integer not null,
  signer uuid not null references public.squad_members(id) on delete cascade,
  creator uuid not null,
  members uuid[] not null,
  title_ct text not null check (length(title_ct) <= 400),
  primary key (conv_id, epoch)
);

-- One row: when housekeeping last ran (so it runs once a day, never inside every request).
create table public.dm_meta (k text primary key, at timestamptz not null);
insert into public.dm_meta (k, at) values ('tidy', 'epoch');
create index squad_members_left on public.squad_members(left_at desc) where left_at is not null;

create table public.dm_messages (
  id uuid primary key,
  conv_id uuid not null references public.dm_convs(id) on delete cascade,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  epoch integer not null,
  ct text not null check (length(ct) <= 6000),
  edited boolean not null default false,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dm_messages_conv_created on public.dm_messages(conv_id, created_at);
create index dm_messages_conv_updated on public.dm_messages(conv_id, updated_at);
create index dm_messages_member_recent on public.dm_messages(member_id, created_at);
create index dm_messages_deleted on public.dm_messages(updated_at) where deleted;

create table public.dm_reads (
  conv_id uuid not null references public.dm_convs(id) on delete cascade,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  read_at timestamptz not null,
  primary key (conv_id, member_id)
);
create index dm_reads_member on public.dm_reads(member_id);

create table public.dm_avatars (
  member_id uuid primary key references public.squad_members(id) on delete cascade,
  squad_id uuid not null references public.squads(id) on delete cascade,
  ct text not null check (length(ct) <= 70000),                       -- '' = no picture (kept so the others hear the change)
  gen integer not null default 1,
  updated_at timestamptz not null default now()
);
create index dm_avatars_squad on public.dm_avatars(squad_id, updated_at);

do $$
declare t text;
begin
  foreach t in array array['dm_convs', 'dm_members', 'dm_keydrops', 'dm_epochs', 'dm_meta', 'dm_messages', 'dm_reads', 'dm_avatars'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy "no client access" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

-- ---------- helpers ----------
-- Who is in a conversation now: not removed from it, and still in the squad.
create or replace function public.dm_in(p_conv uuid)
returns uuid[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(m.member_id order by m.member_id), '{}')
    from public.dm_members m join public.squad_members s on s.id = m.member_id
    where m.conv_id = p_conv and m.removed_at is null and s.left_at is null and s.admitted;
$$;

create or replace function public.dm_lock(p_conv uuid)
returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('gsquad-dm:' || p_conv::text, 0));
$$;

-- The member, in a conversation of their own squad and not removed from it. Raises 'member' otherwise.
create or replace function public.dm_access(p_member uuid, p_conv uuid)
returns public.dm_convs language plpgsql set search_path = '' as $$
declare c public.dm_convs;
begin
  select c0.* into c from public.dm_convs c0
    join public.squad_members s on s.id = p_member and s.squad_id = c0.squad_id and s.left_at is null and s.admitted
    join public.dm_members m on m.conv_id = c0.id and m.member_id = p_member and m.removed_at is null
    where c0.id = p_conv;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  return c;
end $$;

-- ---------- the cheap look: one small answer for every conversation of one member ----------
create or replace function public.dm_status(p_member uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare sq uuid; convs jsonb; av timestamptz; total integer;
begin
  select squad_id into sq from public.squad_members where id = p_member and left_at is null and admitted;
  if sq is null then raise exception 'member' using errcode = 'P0001'; end if;
  select coalesce(jsonb_agg(x.o order by x.last_at desc nulls last), '[]') into convs from (
    select c.last_at, jsonb_build_object(
      'id', c.id, 'k', c.kind, 'e', c.epoch, 'last', c.last_at, 'upd', c.updated_at,
      'rot', c.kind = 'group' and c.key_members <> public.dm_in(c.id),
      'closed', cardinality(public.dm_in(c.id)) < 2,
      'u', (select count(*) from public.dm_messages x where x.conv_id = c.id and x.member_id <> p_member and not x.deleted
              and x.created_at > coalesce((select r.read_at from public.dm_reads r where r.conv_id = c.id and r.member_id = p_member), m.joined_at))
    ) as o
    from public.dm_members m join public.dm_convs c on c.id = m.conv_id
    where m.member_id = p_member and m.removed_at is null and c.squad_id = sq
    order by c.last_at desc nulls last limit 100) x;
  select max(updated_at) into av from public.dm_avatars where squad_id = sq;
  select count(*) into total from public.dm_members where member_id = p_member and removed_at is null;   -- dm_members_active
  return jsonb_build_object('convs', convs, 'av', av, 'more', total > 100);
end $$;

-- ---------- make a conversation ----------
-- A DM (one other member, the id is the same on both devices so a second call finds the first) or a group (2 to 23 others,
-- named, with one sealed key per member). Groups: the drops must be exactly the members.
create or replace function public.dm_new(p_member uuid, p_id uuid, p_kind text, p_others uuid[], p_title text, p_drops jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; ids uuid[]; got uuid[]; n integer; c public.dm_convs;
begin
  select * into me from public.squad_members where id = p_member and left_at is null and admitted;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  perform public.dm_lock(p_id);
  select * into c from public.dm_convs where id = p_id;
  if found then
    if c.squad_id <> me.squad_id or not exists (select 1 from public.dm_members where conv_id = p_id and member_id = me.id) then raise exception 'member' using errcode = 'P0001'; end if;
    update public.dm_members set removed_at = null where conv_id = p_id and member_id = me.id and removed_at is not null and c.kind = 'dm';
    return jsonb_build_object('created', false, 'epoch', c.epoch);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gsquad-dm-new:' || me.id::text, 0));   -- one at a time per member, so parallel calls cannot slip past the limit
  if (select count(*) from public.dm_convs where created_by = me.id and created_at > now() - interval '1 minute') >= 10 then raise exception 'slow' using errcode = 'P0001'; end if;
  ids := (select coalesce(array_agg(distinct x order by x), '{}') from unnest(p_others || array[me.id]) x);
  n := cardinality(ids);
  if (p_kind = 'dm' and n <> 2) or (p_kind = 'group' and (n < 3 or n > 24)) or p_kind not in ('dm', 'group') then raise exception 'drops' using errcode = 'P0001'; end if;
  if (select count(*) from public.squad_members s where s.id = any(ids) and s.squad_id = me.squad_id and s.left_at is null and s.admitted) <> n then
    raise exception 'member' using errcode = 'P0001';
  end if;
  if p_kind = 'group' then
    select coalesce(array_agg((d->>'member')::uuid order by (d->>'member')::uuid), '{}') into got from jsonb_array_elements(p_drops) d;
    if got <> ids or coalesce(p_title, '') = '' or exists (select 1 from jsonb_array_elements(p_drops) d where coalesce(d->>'sealed', '') = '' or length(d->>'sealed') > 600 or coalesce(d->>'sig', '') = '' or length(d->>'sig') > 200) then
      raise exception 'drops' using errcode = 'P0001';
    end if;
  end if;
  insert into public.dm_convs (id, squad_id, kind, created_by, epoch, key_members, title_ct)
    values (p_id, me.squad_id, p_kind, me.id, 1, case when p_kind = 'group' then ids else '{}' end, case when p_kind = 'group' then p_title end);
  insert into public.dm_members (conv_id, member_id) select p_id, x from unnest(ids) x;
  if p_kind = 'group' then
    insert into public.dm_keydrops (conv_id, epoch, member_id, sealed, sig) select p_id, 1, (d->>'member')::uuid, d->>'sealed', d->>'sig' from jsonb_array_elements(p_drops) d;
    insert into public.dm_epochs (conv_id, epoch, signer, creator, members, title_ct) values (p_id, 1, me.id, me.id, ids, p_title);
  end if;
  return jsonb_build_object('created', true, 'epoch', 1);
end $$;

-- ---------- who is in a group ----------
-- Add (the creator only) or remove (the creator removes anyone, anyone removes themselves). Either one leaves the key
-- out of date for the new member list, so nobody writes until a member still in makes the next epoch (dm_rotate).
create or replace function public.dm_change(p_member uuid, p_conv uuid, p_add uuid[], p_remove uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare c public.dm_convs; a uuid;
begin
  perform public.dm_lock(p_conv);
  c := public.dm_access(p_member, p_conv);
  if c.kind <> 'group' then raise exception 'member' using errcode = 'P0001'; end if;
  if p_remove is not null then
    if p_remove <> p_member and c.created_by <> p_member then raise exception 'member' using errcode = 'P0001'; end if;
    update public.dm_members set removed_at = now() where conv_id = p_conv and member_id = p_remove and removed_at is null;
  end if;
  if coalesce(cardinality(p_add), 0) > 0 then
    if c.created_by <> p_member then raise exception 'member' using errcode = 'P0001'; end if;
    if cardinality(public.dm_in(p_conv)) + cardinality(p_add) > 24 then raise exception 'drops' using errcode = 'P0001'; end if;
    foreach a in array p_add loop
      if not exists (select 1 from public.squad_members s where s.id = a and s.squad_id = c.squad_id and s.left_at is null and s.admitted) then raise exception 'member' using errcode = 'P0001'; end if;
      insert into public.dm_members (conv_id, member_id, since_epoch) values (p_conv, a, c.epoch + 1)
        on conflict (conv_id, member_id) do update set removed_at = null, since_epoch = c.epoch + 1, joined_at = now();
    end loop;
  end if;
  update public.dm_convs set updated_at = now() where id = p_conv;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- the next epoch ----------
-- Group: a new key sealed to exactly the members still in (the drops must match), with the name sealed under it again.
-- DM: just a higher epoch, no key on the hub (both devices derive it).
create or replace function public.dm_rotate(p_member uuid, p_conv uuid, p_from integer, p_drops jsonb, p_title text)
returns jsonb language plpgsql set search_path = '' as $$
declare c public.dm_convs; want uuid[]; got uuid[]; nxt integer;
begin
  perform public.dm_lock(p_conv);
  c := public.dm_access(p_member, p_conv);
  if c.epoch <> p_from then return jsonb_build_object('done', false, 'epoch', c.epoch); end if;
  nxt := c.epoch + 1;
  if c.kind = 'dm' then
    update public.dm_convs set epoch = nxt, updated_at = now() where id = p_conv;
    return jsonb_build_object('done', true, 'epoch', nxt);
  end if;
  want := public.dm_in(p_conv);
  if c.key_members = want then return jsonb_build_object('done', false, 'epoch', c.epoch); end if;
  select coalesce(array_agg((d->>'member')::uuid order by (d->>'member')::uuid), '{}') into got from jsonb_array_elements(p_drops) d;
  if got <> want or coalesce(p_title, '') = '' or exists (select 1 from jsonb_array_elements(p_drops) d where coalesce(d->>'sealed', '') = '' or length(d->>'sealed') > 600 or coalesce(d->>'sig', '') = '' or length(d->>'sig') > 200) then
    raise exception 'drops' using errcode = 'P0001';
  end if;
  insert into public.dm_keydrops (conv_id, epoch, member_id, sealed, sig) select p_conv, nxt, (d->>'member')::uuid, d->>'sealed', d->>'sig' from jsonb_array_elements(p_drops) d;
  insert into public.dm_epochs (conv_id, epoch, signer, creator, members, title_ct) values (p_conv, nxt, p_member, c.created_by, want, p_title);
  update public.dm_members set since_epoch = nxt where conv_id = p_conv and member_id = any(want) and since_epoch > c.epoch;
  update public.dm_convs set epoch = nxt, key_members = want, title_ct = p_title, updated_at = now() where id = p_conv;
  return jsonb_build_object('done', true, 'epoch', nxt);
end $$;

-- ---------- a message ----------
-- Only into the epoch now; a group only while its key covers exactly the members still in; a DM only while both are in.
-- At most 30 a minute per member across all conversations.
create or replace function public.dm_post(p_member uuid, p_conv uuid, p_id uuid, p_epoch integer, p_ct text)
returns jsonb language plpgsql set search_path = '' as $$
declare c public.dm_convs; at timestamptz;
begin
  perform public.dm_lock(p_conv);
  c := public.dm_access(p_member, p_conv);
  if c.epoch <> p_epoch then raise exception 'epoch' using errcode = 'P0001'; end if;
  if c.kind = 'group' and c.key_members <> public.dm_in(p_conv) then raise exception 'epoch' using errcode = 'P0001'; end if;
  if c.kind = 'dm' and cardinality(public.dm_in(p_conv)) < 2 then raise exception 'closed' using errcode = 'P0001'; end if;
  if (select count(*) from public.dm_messages where member_id = p_member and created_at > now() - interval '1 minute') >= 30 then raise exception 'slow' using errcode = 'P0001'; end if;
  insert into public.dm_messages (id, conv_id, member_id, epoch, ct) values (p_id, p_conv, p_member, p_epoch, p_ct) returning created_at into at;
  update public.dm_convs set last_at = at where id = p_conv;
  insert into public.dm_reads (conv_id, member_id, read_at) values (p_conv, p_member, at)
    on conflict (conv_id, member_id) do update set read_at = greatest(public.dm_reads.read_at, excluded.read_at);
  return jsonb_build_object('at', at);
end $$;

-- ---------- an edit ----------
-- Only into the epoch now (the client seals the new text under the CURRENT key and the row moves to it), so text written after a
-- removal is never under a key the removed member holds. A group only while its key covers exactly the members still in.
create or replace function public.dm_edit(p_member uuid, p_conv uuid, p_id uuid, p_epoch integer, p_ct text)
returns jsonb language plpgsql set search_path = '' as $$
declare c public.dm_convs; n integer;
begin
  perform public.dm_lock(p_conv);
  c := public.dm_access(p_member, p_conv);
  if c.epoch <> p_epoch then raise exception 'epoch' using errcode = 'P0001'; end if;
  if c.kind = 'group' and c.key_members <> public.dm_in(p_conv) then raise exception 'epoch' using errcode = 'P0001'; end if;
  update public.dm_messages set ct = p_ct, epoch = p_epoch, edited = true, updated_at = now()
    where id = p_id and conv_id = p_conv and member_id = p_member and not deleted;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;

-- ---------- pictures ----------
create or replace function public.dm_avatar_set(p_member uuid, p_ct text, p_gen integer)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; prev timestamptz;
begin
  select * into me from public.squad_members where id = p_member and left_at is null and admitted;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  select updated_at into prev from public.dm_avatars where member_id = me.id;
  if prev is not null and prev > now() - interval '10 seconds' then raise exception 'slow' using errcode = 'P0001'; end if;
  insert into public.dm_avatars (member_id, squad_id, ct, gen, updated_at) values (me.id, me.squad_id, p_ct, p_gen, now())
    on conflict (member_id) do update set ct = excluded.ct, gen = excluded.gen, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Housekeeping: deleted messages after 30 days, the key copies and read marks of members who left the squad, conversations
-- nobody is in any more. At most once a day (the gate row), every delete bounded and reached by an index, so a call is cheap
-- whatever the table sizes. The edge function may call it often: all but one call a day return 0 at once.
create or replace function public.dm_tidy()
returns integer language plpgsql set search_path = '' as $$
declare n integer := 0; cnt integer; gone uuid[];
begin
  update public.dm_meta set at = now() where k = 'tidy' and at < now() - interval '1 day';   -- pk lookup
  if not found then return 0; end if;
  delete from public.dm_messages where id in (select id from public.dm_messages where deleted and updated_at < now() - interval '30 days' order by updated_at limit 500);   -- dm_messages_deleted
  get diagnostics cnt = row_count; n := n + cnt;
  select coalesce(array_agg(id), '{}') into gone from (select id from public.squad_members where left_at is not null order by left_at desc limit 100) x;   -- squad_members_left
  delete from public.dm_keydrops where (conv_id, member_id, epoch) in (select conv_id, member_id, epoch from public.dm_keydrops where member_id = any(gone) limit 500);   -- dm_keydrops_member
  get diagnostics cnt = row_count; n := n + cnt;
  delete from public.dm_reads where (conv_id, member_id) in (select conv_id, member_id from public.dm_reads where member_id = any(gone) limit 500);   -- dm_reads_member
  get diagnostics cnt = row_count; n := n + cnt;
  delete from public.dm_avatars where member_id = any(gone);   -- pk, at most 100
  get diagnostics cnt = row_count; n := n + cnt;
  delete from public.dm_convs where id in (
    select c.id from public.dm_convs c where c.updated_at < now() - interval '30 days'   -- dm_convs_updated
      and not exists (select 1 from public.dm_members x join public.squad_members s on s.id = x.member_id
                      where x.conv_id = c.id and x.removed_at is null and s.left_at is null)
    order by c.updated_at limit 200);
  get diagnostics cnt = row_count; n := n + cnt;
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array['dm_in(uuid)', 'dm_lock(uuid)', 'dm_access(uuid, uuid)', 'dm_status(uuid)',
    'dm_new(uuid, uuid, text, uuid[], text, jsonb)', 'dm_change(uuid, uuid, uuid[], uuid)', 'dm_rotate(uuid, uuid, integer, jsonb, text)',
    'dm_post(uuid, uuid, uuid, integer, text)', 'dm_edit(uuid, uuid, uuid, integer, text)', 'dm_avatar_set(uuid, text, integer)', 'dm_tidy()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
