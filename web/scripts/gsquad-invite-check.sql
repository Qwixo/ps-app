-- G Squad invite only (invite_001_invite_only.sql): the join rules, checked in a real Postgres.
-- Run with scripts/gsquad-invite-check.sh (a throwaway local container; never the live hub). The script first builds
-- the hub from every migration up to auto_002, seeds a state like the live one (3 people in, all holding the key and
-- with a card, the developer the admin), then applies invite_001 and runs this file. Every check raises on failure.
\set ON_ERROR_STOP on

create or replace function pg_temp.pub(s text) returns text language sql as $$
  select replace(encode(sha256(convert_to(s, 'UTF8')) || sha256(convert_to(s || '!', 'UTF8')), 'base64'), E'\n', '');
$$;
create or replace function pg_temp.who(s text) returns text language sql as $$ select encode(sha256(convert_to('who:' || s, 'UTF8')), 'hex'); $$;
-- Runs a statement and returns the error text ('' when it worked).
create or replace function pg_temp.err(q text) returns text language plpgsql as $$
begin
  execute q;
  return '';
exception when others then
  return sqlerrm;
end $$;
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise notice 'ok  %', what;
end $$;

-- ---------- the seeded people (before the migration) stay exactly as they were ----------
select pg_temp.check((select count(*) = 3 from squad_members where left_at is null and admitted and has_key and card_ct is not null),
  'everyone in before stays in: admitted, key and card untouched');
select pg_temp.check((select count(*) = 3 from squad_keydrops), 'their key drops untouched');
select pg_temp.check((select created_by = (select id from squad_members where who = pg_temp.who('red')) from squads), 'The developer still the admin');

-- ---------- a stranger with PS app: a waiting row, nothing more ----------
select pg_temp.check((select (auto_join(pg_temp.pub('s1'), pg_temp.pub('s1b'), pg_temp.who('s1')) ->> 'admitted') = 'false'), 'stranger joins: waiting, not admitted');
select pg_temp.check((select auto_join(pg_temp.pub('s1'), pg_temp.pub('s1b'), pg_temp.who('s1')) ->> 'start' = 'false'), 'stranger is never told to make a key');
select pg_temp.check((select not has_key and not admitted and card_ct is null from squad_members where who = pg_temp.who('s1')), 'stranger row: no key, no card');
select pg_temp.check((select jsonb_array_length(auto_waiting((select id from squad_members where who = pg_temp.who('red')))) = 0),
  'members are not told anyone is waiting for the key');
select pg_temp.check((select (auto_drop((select id from squad_members where who = pg_temp.who('red')), (select gen from squads),
  jsonb_build_array(jsonb_build_object('member', (select id from squad_members where who = pg_temp.who('s1')), 'sealed', 'xx')))) ->> 'added') = '0',
  'a member PS handing the key to the stranger anyway: nothing added');
select pg_temp.check(pg_temp.err(format('insert into squad_keydrops (member_id, gen, squad_id, sealed) values (%L, (select gen from squads), (select id from squads), %L)',
  (select id from squad_members where who = pg_temp.who('s1')), 'xx')) like '%admitted%', 'database refuses a key drop for the stranger');
select pg_temp.check(pg_temp.err(format('update squad_members set has_key = true where id = %L', (select id from squad_members where who = pg_temp.who('s1'))))
  like '%squad_members_admitted%', 'database refuses the key flag for the stranger');
select pg_temp.check(pg_temp.err(format('update squad_members set card_ct = %L where id = %L', 'abc', (select id from squad_members where who = pg_temp.who('s1'))))
  like '%squad_members_admitted%', 'database refuses a card for the stranger');
select pg_temp.check(pg_temp.err(format('select auto_start(%L, (select gen from squads), %L)', (select id from squad_members where who = pg_temp.who('s1')), 'meta'))
  like '%member%', 'stranger cannot make a key');
select pg_temp.check(pg_temp.err(format('select auto_admin(%L)', (select id from squad_members where who = pg_temp.who('s1')))) like '%member%',
  'stranger cannot become admin');
select pg_temp.check(pg_temp.err(format('select invite_admit(%L, %L)', (select id from squad_members where who = pg_temp.who('s1')), (select id from squad_members where who = pg_temp.who('s1'))))
  like '%member%', 'stranger cannot let themselves in');

-- ---------- the same person again ----------
select pg_temp.check(pg_temp.err(format('select auto_join(%L, %L, %L)', pg_temp.pub('s1x'), pg_temp.pub('s1xb'), pg_temp.who('s1'))) like '%member%',
  'their other device a moment later: already asked, wait');
update squad_members set joined_at = now() - interval '11 minutes' where who = pg_temp.who('s1');
select pg_temp.check((select auto_join(pg_temp.pub('s1y'), pg_temp.pub('s1yb'), pg_temp.who('s1')) ->> 'admitted') = 'false', 'asking again later: still waiting');
select pg_temp.check((select count(*) = 1 and bool_and(sign_pub = pg_temp.pub('s1y')) from squad_members where who = pg_temp.who('s1')), 'the new ask replaces the old one');
select pg_temp.check(pg_temp.err(format('select auto_join(%L, %L, %L)', pg_temp.pub('fake'), pg_temp.pub('fakeb'), pg_temp.who('amy'))) like '%member%', 'a key claiming a member''s join id: refused');
select pg_temp.check((select count(*) = 1 and bool_and(left_at is null and admitted and has_key and card_ct is not null) from squad_members where who = pg_temp.who('amy')), 'the member untouched');
update squad_members set last_beat = now() - interval '3 days', joined_at = now() - interval '9 days' where who = pg_temp.who('amy');
select pg_temp.check(pg_temp.err(format('select auto_join(%L, %L, %L)', pg_temp.pub('fake2'), pg_temp.pub('fake2b'), pg_temp.who('amy'))) like '%member%', 'even when that member has been away for days: refused');
select pg_temp.check((select count(*) = 1 and bool_and(left_at is null and has_key) from squad_members where who = pg_temp.who('amy')) and not (select rekey from squads), 'never thrown out, no re-key');
select pg_temp.check(pg_temp.err(format('select auto_join(%L, %L, null)', pg_temp.pub('nowho'), pg_temp.pub('nowhob'))) like '%removed%', 'no join id: refused');

-- ---------- the admin lets one in, turns one away ----------
select from auto_join(pg_temp.pub('s2'), pg_temp.pub('s2b'), pg_temp.who('s2'));
select pg_temp.check(pg_temp.err(format('select invite_admit(%L, %L)', (select id from squad_members where who = pg_temp.who('amy')), (select id from squad_members where who = pg_temp.who('s1'))))
  like '%admin%', 'a member who is not the admin cannot let anyone in');
select pg_temp.check((select invite_admit((select id from squad_members where who = pg_temp.who('red')), (select id from squad_members where who = pg_temp.who('s1'))) ->> 'ok') = 'true',
  'The developer lets the first one in');
select pg_temp.check((select admitted and not has_key and ask_ct is null from squad_members where who = pg_temp.who('s1')), 'let in: admitted, still waiting for the key');
select pg_temp.check((select jsonb_array_length(auto_waiting((select id from squad_members where who = pg_temp.who('amy')))) = 1),
  'members now see exactly one person waiting for the key (not the second asker)');
select pg_temp.check((select (auto_drop((select id from squad_members where who = pg_temp.who('amy')), (select gen from squads),
  jsonb_build_array(jsonb_build_object('member', (select id from squad_members where who = pg_temp.who('s1')), 'sealed', 'xx'),
                    jsonb_build_object('member', (select id from squad_members where who = pg_temp.who('s2')), 'sealed', 'xx')))) ->> 'added') = '1',
  'a member hands it over: only the one let in gets it');
select pg_temp.check((select has_key from squad_members where who = pg_temp.who('s1')), 'the one let in now holds the key');
select pg_temp.check(pg_temp.err(format('select invite_admit(%L, %L)', (select id from squad_members where who = pg_temp.who('red')), (select id from squad_members where who = pg_temp.who('s1'))))
  like '%request%', 'letting in someone already in: refused');
select pg_temp.check(pg_temp.err(format('select invite_turn_away(%L, %L)', (select id from squad_members where who = pg_temp.who('red')), (select id from squad_members where who = pg_temp.who('amy'))))
  like '%request%', 'turn away cannot touch a member');
select pg_temp.check((select invite_turn_away((select id from squad_members where who = pg_temp.who('red')), (select id from squad_members where who = pg_temp.who('s2'))) ->> 'ok') = 'true',
  'The developer turns the second one away');
select pg_temp.check(not exists (select 1 from squad_members where who = pg_temp.who('s2')), 'turned away: their row goes');
select pg_temp.check(pg_temp.err(format('select auto_join(%L, %L, %L)', pg_temp.pub('s2z'), pg_temp.pub('s2zb'), pg_temp.who('s2'))) like '%removed%',
  'turned away: cannot ask again by itself');
select pg_temp.check((select squads.rekey = false from squads), 'none of this started a re-key');

-- ---------- invite (Add friend): straight in ----------
insert into squad_invites (id, squad_id, created_by, token_hash, wrapped_key, gen, expires_at)
  values ('00000000-0000-4000-8000-000000000001', (select id from squads), (select id from squad_members where who = pg_temp.who('amy')), repeat('a', 64), 'd3JhcA==', (select gen from squads), now() + interval '1 day');
select pg_temp.check(pg_temp.err(format('select squad_join(%L, %L, %L, %L)', '00000000-0000-4000-8000-000000000001', repeat('b', 64), pg_temp.pub('inv'), pg_temp.pub('invb'))) like '%invite%',
  'a wrong invite token: refused');
select pg_temp.check((select squad_join('00000000-0000-4000-8000-000000000001', repeat('a', 64), pg_temp.pub('inv'), pg_temp.pub('invb')) ->> 'wrapped') = 'd3JhcA==',
  'a member''s invite: joins with the key in the link');
select pg_temp.check((select admitted and has_key from squad_members where sign_pub = pg_temp.pub('inv')), 'invited: admitted');
select pg_temp.check(pg_temp.err(format('select squad_join(%L, %L, %L, %L)', '00000000-0000-4000-8000-000000000001', repeat('a', 64), pg_temp.pub('inv2'), pg_temp.pub('inv2b'))) like '%invite%',
  'an invite works once');
insert into squad_invites (id, squad_id, created_by, token_hash, wrapped_key, gen, expires_at)
  values ('00000000-0000-4000-8000-000000000002', (select id from squads), (select id from squad_members where who = pg_temp.who('s1')), repeat('c', 64), 'd3JhcA==', (select gen from squads), now() + interval '1 day');
update squad_members set admitted = false, has_key = false where who = pg_temp.who('s1');
select pg_temp.check(pg_temp.err(format('select squad_join(%L, %L, %L, %L)', '00000000-0000-4000-8000-000000000002', repeat('c', 64), pg_temp.pub('inv3'), pg_temp.pub('inv3b'))) like '%invite%',
  'an invite made by someone not let in: refused');
update squad_members set admitted = true where who = pg_temp.who('s1');

-- ---------- the old Ask to join is closed ----------
select pg_temp.check(pg_temp.err(format('select dir_ask(gen_random_uuid(), (select id from squads), %L, %L, %L, %L)', pg_temp.pub('old'), pg_temp.pub('oldb'),
  (select box_pub from squad_members where who = pg_temp.who('red')), 'x')) like '%unlisted%', 'old Ask to join: refused');
select pg_temp.check(pg_temp.err(format('select dir_approve(%L, gen_random_uuid(), gen_random_uuid(), 1, %L, %L)', (select id from squad_members where who = pg_temp.who('red')), 'x', 'eA=='))
  like '%admin%', 'old Approve (V1.49+ admin PS did it by itself): refused');

-- ---------- asking: the sealed name, giving up, limits ----------
select from auto_join(pg_temp.pub('s3'), pg_temp.pub('s3b'), pg_temp.who('s3'));
select pg_temp.check((select invite_ask((select id from squad_members where who = pg_temp.who('s3')), 'c2VhbGVk') ->> 'ok') = 'true', 'the asker leaves a sealed name');
select pg_temp.check((select ask_ct = 'c2VhbGVk' from squad_members where who = pg_temp.who('s3')), 'kept on their row, opaque to the hub');
select pg_temp.check(pg_temp.err(format('select invite_ask(%L, %L)', (select id from squad_members where who = pg_temp.who('amy')), 'eA==')) like '%member%',
  'a member cannot set an ask');
select pg_temp.check((select invite_withdraw((select id from squad_members where who = pg_temp.who('s3'))) ->> 'gone') = 'false', 'the asker gives up');
select pg_temp.check(not exists (select 1 from squad_members where who = pg_temp.who('s3')) and not (select rekey from squads), 'their row goes, no re-key');
select pg_temp.check(pg_temp.err(format('select invite_withdraw(%L)', (select id from squad_members where who = pg_temp.who('amy')))) like '%member%',
  'withdraw cannot remove a member');
do $$ begin for i in 1..20 loop perform auto_join(pg_temp.pub('w' || i), pg_temp.pub('wb' || i), pg_temp.who('w' || i)); end loop; end $$;
select pg_temp.check(pg_temp.err(format('select auto_join(%L, %L, %L)', pg_temp.pub('w21'), pg_temp.pub('wb21'), pg_temp.who('w21'))) like '%busy%',
  '20 people waiting: the next one is told to wait (the squad itself is not full)');
delete from squad_members where not admitted;

-- ---------- start over (V1.55 heal) with someone waiting ----------
select from auto_join(pg_temp.pub('s4'), pg_temp.pub('s4b'), pg_temp.who('s4'));
update squad_members set has_key = false where admitted;
delete from squad_keydrops;
update squads set meta_ct = null, meta_gen = null, gen = gen + 1;
select pg_temp.check(pg_temp.err(format('select auto_start(%L, (select gen from squads), %L)', (select id from squad_members where who = pg_temp.who('s4')), 'meta')) like '%member%',
  'a fresh start: the stranger cannot make the new key');
select pg_temp.check((select auto_start((select id from squad_members where who = pg_temp.who('amy')), (select gen from squads), 'bWV0YQ==') ->> 'ok') = 'true',
  'a member makes the new key');
select pg_temp.check((select jsonb_agg(x ->> 'id') from jsonb_array_elements(auto_waiting((select id from squad_members where who = pg_temp.who('amy')))) x)
  ::text not like '%' || (select id from squad_members where who = pg_temp.who('s4'))::text || '%', 'after a start over, the stranger is still not listed');

-- ---------- The developer's place gone: his join id alone makes nobody admin ----------
select from squad_leave((select id from squad_members where who = pg_temp.who('red')), (select id from squad_members where who = pg_temp.who('red')));
select pg_temp.check((select auto_join(pg_temp.pub('redx'), pg_temp.pub('redxb'), pg_temp.who('red')) ->> 'admitted') = 'false', 'a key bringing the developer''s join id: waiting like anyone');
select from auto_heal((select id from squads));
select pg_temp.check((select created_by is distinct from (select id from squad_members where sign_pub = pg_temp.pub('redx')) from squads),
  'and the heal does not make it admin');

\echo ALL CHECKS PASSED
