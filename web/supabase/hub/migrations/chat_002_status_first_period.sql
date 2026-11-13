-- G Squad chat (V1.40): the status also says each vote's first period of the newcomer ('be'), so the newcomer's PS
-- knows whether the older periods' keys have reached it. Replaces chat_status only; nothing else changes.
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
      'id', v.id, 'j', v.joiner, 'be', v.before_epoch, 'at', v.created_at, 'again', v.again_at, 'res', v.result,
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
revoke all on function public.chat_status(uuid) from public, anon, authenticated;
grant execute on function public.chat_status(uuid) to service_role;
