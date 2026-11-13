-- G Squad chat (V1.40), hub project zxhvchchfrkfqxuyorqo only. Additive: new chat_ tables and functions, nothing of
-- the core's tables changes (it only reads squads and squad_members, and uses squad_nonces for the replay guard).
--
-- Keys, so a new member can never open older messages without a yes:
--   The chat runs in periods ("epochs"). Each period has its own random chat key, made on a member's device and
--   sealed SEPARATELY to the box key of every member in at that moment (chat_keydrops, one row per member). A new
--   period starts whenever someone joins or leaves, so a newcomer is only ever sealed keys from their join on.
--   Older period keys are sealed to them (history = true) only after the history vote says yes. They are never
--   sealed with the squad key (which the invite link hands over), so the invite opens no old message.
--   The hub also never sends a member the rows of a period they hold no key for.
-- Access: same lock down as the core. RLS on and forced, a restrictive deny for anon and authenticated, no grants;
-- only the edge function `chat` (service role) reads and writes, after checking the member's signature.

create table public.chat_epochs (
  squad_id uuid not null references public.squads(id) on delete cascade,
  epoch integer not null check (epoch >= 1),
  members uuid[] not null,                                         -- sorted ids of who got this period's key
  created_at timestamptz not null default now(),
  primary key (squad_id, epoch)
);

create table public.chat_keydrops (
  squad_id uuid not null,
  epoch integer not null,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  sealed text not null check (length(sealed) <= 600),              -- the period key sealed to that member's box key
  history boolean not null default false,                          -- handed over after a yes vote
  created_at timestamptz not null default now(),
  primary key (member_id, epoch),
  foreign key (squad_id, epoch) references public.chat_epochs(squad_id, epoch) on delete cascade
);
create index chat_keydrops_epoch on public.chat_keydrops(squad_id, epoch);

create table public.chat_messages (
  id uuid primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  epoch integer not null,
  ct text not null check (length(ct) <= 6000),                     -- the message, sealed with the period key ('' once deleted)
  edited boolean not null default false,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (squad_id, epoch) references public.chat_epochs(squad_id, epoch) on delete cascade
);
create index chat_messages_squad_upd on public.chat_messages(squad_id, updated_at);
create index chat_messages_squad_created on public.chat_messages(squad_id, created_at);
create index chat_messages_member on public.chat_messages(member_id, created_at);

create table public.chat_reads (
  member_id uuid primary key references public.squad_members(id) on delete cascade,
  read_at timestamptz not null                                     -- read up to here (the badge counts after it)
);

create table public.chat_votes (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.squads(id) on delete cascade,
  joiner uuid not null unique references public.squad_members(id) on delete cascade,
  before_epoch integer not null,                                   -- the joiner's first period: history is every period below it
  voters uuid[] not null,                                          -- who was in before the joiner
  created_at timestamptz not null default now(),
  again_at timestamptz,                                            -- 24 hours without every answer: the pop-up came back
  result text check (result in ('yes', 'no')),
  decided_at timestamptz,
  given_at timestamptz                                             -- the older keys were sealed to the joiner
);
create index chat_votes_squad on public.chat_votes(squad_id);

create table public.chat_ballots (
  vote_id uuid not null references public.chat_votes(id) on delete cascade,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  yes boolean not null,
  at timestamptz not null default now(),
  primary key (vote_id, member_id)
);
create index chat_ballots_member on public.chat_ballots(member_id);

do $$
declare t text;
begin
  foreach t in array array['chat_epochs', 'chat_keydrops', 'chat_messages', 'chat_reads', 'chat_votes', 'chat_ballots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy "no client access" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

-- ---------- helpers ----------

create or replace function public.chat_me(p_member uuid)
returns public.squad_members language plpgsql set search_path = '' as $$
declare me public.squad_members;
begin
  select * into me from public.squad_members where id = p_member and left_at is null;
  if not found then raise exception 'member' using errcode = 'P0001'; end if;
  return me;
end $$;

create or replace function public.chat_lock(p_squad uuid)
returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('gsquad-chat:' || p_squad::text, 0));
$$;

create or replace function public.chat_in(p_squad uuid)
returns uuid[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(id order by id), '{}') from public.squad_members where squad_id = p_squad and left_at is null;
$$;

-- The history votes' clock. One No decides No at once; every member still asked saying Yes decides Yes; 24 hours
-- without every answer brings the pop-up back (again_at); 12 hours after that, anyone still silent counts as Yes.
create or replace function public.chat_settle(p_squad uuid)
returns void language plpgsql set search_path = '' as $$
declare v public.chat_votes; live uuid[]; yes_n integer;
begin
  for v in select * from public.chat_votes where squad_id = p_squad and result is null for update loop
    if not exists (select 1 from public.squad_members where id = v.joiner and left_at is null) then
      delete from public.chat_votes where id = v.id;
      continue;
    end if;
    select coalesce(array_agg(m.id), '{}') into live from public.squad_members m where m.id = any(v.voters) and m.left_at is null;
    if exists (select 1 from public.chat_ballots b where b.vote_id = v.id and not b.yes and b.member_id = any(live)) then
      update public.chat_votes set result = 'no', decided_at = now() where id = v.id;
      continue;
    end if;
    select count(*) into yes_n from public.chat_ballots b where b.vote_id = v.id and b.yes and b.member_id = any(live);
    if yes_n >= coalesce(array_length(live, 1), 0) then
      update public.chat_votes set result = 'yes', decided_at = now() where id = v.id;
    elsif v.again_at is not null and now() >= v.again_at + interval '12 hours' then
      update public.chat_votes set result = 'yes', decided_at = now() where id = v.id;
    elsif v.again_at is null and now() >= v.created_at + interval '24 hours' then
      update public.chat_votes set again_at = now() where id = v.id;
    end if;
  end loop;
end $$;

-- What one member's PS needs to know, small: the period now, whether a new one is due, unread count, the newest
-- change, the history votes that concern them, and history they can hand over after a yes.
create or replace function public.chat_status(p_member uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; mine integer[]; cur public.chat_epochs; want uuid[]; rd timestamptz; votes jsonb; give jsonb;
  unread integer; last timestamptz;
begin
  me := public.chat_me(p_member);
  perform public.chat_settle(me.squad_id);
  select coalesce(array_agg(epoch), '{}') into mine from public.chat_keydrops where member_id = me.id;
  select * into cur from public.chat_epochs where squad_id = me.squad_id order by epoch desc limit 1;
  want := public.chat_in(me.squad_id);
  select read_at into rd from public.chat_reads where member_id = me.id;
  rd := coalesce(rd, me.joined_at);
  select count(*) into unread from public.chat_messages
    where squad_id = me.squad_id and epoch = any(mine) and member_id <> me.id and not deleted and created_at > rd;
  select max(updated_at) into last from public.chat_messages where squad_id = me.squad_id and epoch = any(mine);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'j', v.joiner, 'at', v.created_at, 'again', v.again_at, 'res', v.result,
      'voter', me.id = any(v.voters),
      'mine', (select b.yes from public.chat_ballots b where b.vote_id = v.id and b.member_id = me.id),
      'n', (select count(*) from public.squad_members m where m.id = any(v.voters) and m.left_at is null),
      'k', (select count(*) from public.chat_ballots b join public.squad_members m on m.id = b.member_id
              where b.vote_id = v.id and m.left_at is null and m.id = any(v.voters)),
      'msgs', (select count(*) from public.chat_messages c where c.squad_id = v.squad_id and c.epoch < v.before_epoch and not c.deleted),
      'from', (select count(distinct c.member_id) from public.chat_messages c where c.squad_id = v.squad_id and c.epoch < v.before_epoch and not c.deleted),
      'first', (select min(c.created_at) from public.chat_messages c where c.squad_id = v.squad_id and c.epoch < v.before_epoch and not c.deleted)
    )), '[]') into votes
    from public.chat_votes v
    where v.squad_id = me.squad_id and ((v.result is null and me.id = any(v.voters)) or (v.joiner = me.id and coalesce(v.decided_at, now()) > now() - interval '3 days'));
  select coalesce(jsonb_agg(jsonb_build_object('vote', g.id, 'j', g.joiner, 'e', g.eps)), '[]') into give from (
    select v.id, v.joiner, array_agg(d.epoch order by d.epoch) as eps
      from public.chat_votes v join public.chat_keydrops d on d.member_id = me.id and d.squad_id = v.squad_id and d.epoch < v.before_epoch
      where v.squad_id = me.squad_id and v.result = 'yes' and v.given_at is null and v.joiner <> me.id
        and not exists (select 1 from public.chat_keydrops x where x.member_id = v.joiner and x.epoch = d.epoch)
      group by v.id, v.joiner) g;
  return jsonb_build_object(
    'epoch', coalesce(cur.epoch, 0),
    'rot', cur.epoch is null or cur.members <> want,
    'u', unread, 'last', last, 'read', rd, 'votes', votes, 'give', give);
end $$;

-- ---------- the steps the edge function calls ----------

-- A new period: one sealed key for exactly every member still in. Starts a history vote for anyone new when the
-- chat already has messages and someone from before is still in to ask.
create or replace function public.chat_rotate(p_member uuid, p_from integer, p_drops jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; cur public.chat_epochs; want uuid[]; got uuid[]; newm uuid[]; olds uuid[]; n uuid; nxt integer;
begin
  me := public.chat_me(p_member);
  perform public.chat_lock(me.squad_id);
  select * into cur from public.chat_epochs where squad_id = me.squad_id order by epoch desc limit 1;
  if coalesce(cur.epoch, 0) <> p_from then return jsonb_build_object('done', false, 'epoch', coalesce(cur.epoch, 0)); end if;
  want := public.chat_in(me.squad_id);
  if cur.epoch is not null and cur.members = want then return jsonb_build_object('done', false, 'epoch', cur.epoch); end if;
  select coalesce(array_agg((d->>'member')::uuid order by (d->>'member')::uuid), '{}') into got from jsonb_array_elements(p_drops) d;
  if want <> got then raise exception 'drops' using errcode = 'P0001'; end if;
  if exists (select 1 from jsonb_array_elements(p_drops) d where length(d->>'sealed') > 600 or coalesce(d->>'sealed', '') = '') then
    raise exception 'drops' using errcode = 'P0001';
  end if;
  nxt := coalesce(cur.epoch, 0) + 1;
  insert into public.chat_epochs (squad_id, epoch, members) values (me.squad_id, nxt, want);
  insert into public.chat_keydrops (squad_id, epoch, member_id, sealed)
    select me.squad_id, nxt, (d->>'member')::uuid, d->>'sealed' from jsonb_array_elements(p_drops) d;
  if cur.epoch is not null then
    newm := array(select x from unnest(want) x where not (x = any(cur.members)));
    olds := array(select x from unnest(want) x where x = any(cur.members));
    if coalesce(array_length(newm, 1), 0) > 0 and coalesce(array_length(olds, 1), 0) > 0
       and exists (select 1 from public.chat_messages where squad_id = me.squad_id and not deleted) then
      foreach n in array newm loop
        insert into public.chat_votes (squad_id, joiner, before_epoch, voters) values (me.squad_id, n, nxt, olds) on conflict (joiner) do nothing;
      end loop;
    end if;
  end if;
  return jsonb_build_object('done', true, 'epoch', nxt);
end $$;

-- A message, only into the period now, and only while that period covers exactly the members still in (so after
-- a join or a leave nobody writes until the new period exists). At most 30 a minute per member.
create or replace function public.chat_post(p_member uuid, p_id uuid, p_epoch integer, p_ct text)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; cur public.chat_epochs; at timestamptz;
begin
  me := public.chat_me(p_member);
  perform public.chat_lock(me.squad_id);
  select * into cur from public.chat_epochs where squad_id = me.squad_id order by epoch desc limit 1;
  if cur.epoch is null or cur.epoch <> p_epoch or cur.members <> public.chat_in(me.squad_id) then raise exception 'epoch' using errcode = 'P0001'; end if;
  if (select count(*) from public.chat_messages where member_id = me.id and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'slow' using errcode = 'P0001';
  end if;
  insert into public.chat_messages (id, squad_id, member_id, epoch, ct) values (p_id, me.squad_id, me.id, p_epoch, p_ct) returning created_at into at;
  insert into public.chat_reads (member_id, read_at) values (me.id, at)
    on conflict (member_id) do update set read_at = greatest(public.chat_reads.read_at, excluded.read_at);
  return jsonb_build_object('at', at);
end $$;

-- A Yes or No on someone's history. Only those asked (in before the joiner, still in), only while undecided.
create or replace function public.chat_ballot(p_member uuid, p_vote uuid, p_yes boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; v public.chat_votes;
begin
  me := public.chat_me(p_member);
  perform public.chat_lock(me.squad_id);
  select * into v from public.chat_votes where id = p_vote and squad_id = me.squad_id;
  if not found or not (me.id = any(v.voters)) then raise exception 'vote' using errcode = 'P0001'; end if;
  if v.result is null then
    insert into public.chat_ballots (vote_id, member_id, yes) values (v.id, me.id, p_yes)
      on conflict (vote_id, member_id) do update set yes = excluded.yes, at = now();
    perform public.chat_settle(me.squad_id);
  end if;
  select * into v from public.chat_votes where id = p_vote;
  return jsonb_build_object('res', v.result);
end $$;

-- After a yes: older period keys sealed to the joiner by a member who holds them. Only periods before the joiner's
-- first, only ones the giver holds and the joiner does not. given_at once nothing anyone still in holds is missing.
create or replace function public.chat_give(p_member uuid, p_vote uuid, p_drops jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare me public.squad_members; v public.chat_votes; d jsonb; e integer; added integer := 0;
begin
  me := public.chat_me(p_member);
  perform public.chat_lock(me.squad_id);
  select * into v from public.chat_votes where id = p_vote and squad_id = me.squad_id;
  if not found or v.result is distinct from 'yes' or v.joiner = me.id then raise exception 'vote' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.squad_members where id = v.joiner and left_at is null) then raise exception 'vote' using errcode = 'P0001'; end if;
  for d in select * from jsonb_array_elements(p_drops) loop
    e := (d->>'epoch')::integer;
    if e is null or e >= v.before_epoch or coalesce(d->>'sealed', '') = '' or length(d->>'sealed') > 600 then raise exception 'drops' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.chat_keydrops where member_id = me.id and epoch = e) then raise exception 'drops' using errcode = 'P0001'; end if;
    insert into public.chat_keydrops (squad_id, epoch, member_id, sealed, history) values (me.squad_id, e, v.joiner, d->>'sealed', true)
      on conflict (member_id, epoch) do nothing;
    added := added + 1;
  end loop;
  if not exists (
    select 1 from public.chat_keydrops h join public.squad_members m on m.id = h.member_id and m.left_at is null
      where h.squad_id = v.squad_id and h.epoch < v.before_epoch and h.member_id <> v.joiner
        and not exists (select 1 from public.chat_keydrops x where x.member_id = v.joiner and x.epoch = h.epoch)) then
    update public.chat_votes set given_at = now() where id = v.id;
  end if;
  return jsonb_build_object('added', added);
end $$;

-- Housekeeping (the edge function runs it now and then): deleted messages after 30 days, the keys of members who
-- left, settled votes after 30 days.
create or replace function public.chat_tidy()
returns void language sql set search_path = '' as $$
  delete from public.chat_messages where deleted and updated_at < now() - interval '30 days';
  delete from public.chat_keydrops d using public.squad_members m where m.id = d.member_id and m.left_at is not null;
  delete from public.chat_reads r using public.squad_members m where m.id = r.member_id and m.left_at is not null;
  delete from public.chat_votes where result is not null and decided_at < now() - interval '30 days';
$$;

do $$
declare f text;
begin
  foreach f in array array['chat_me(uuid)', 'chat_lock(uuid)', 'chat_in(uuid)', 'chat_settle(uuid)', 'chat_status(uuid)',
    'chat_rotate(uuid, integer, jsonb)', 'chat_post(uuid, uuid, integer, text)', 'chat_ballot(uuid, uuid, boolean)',
    'chat_give(uuid, uuid, jsonb)', 'chat_tidy()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
