-- Isolation checks for migration 025 (multi-owner). LOCAL TEST DATABASE ONLY, never the live vault.
-- Run as the postgres user after applying migrations 001 to 025 on an empty local Supabase:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/025_multi_owner_isolation.sql
-- Everything runs in one transaction and is rolled back at the end. Any failed check raises and stops.
begin;

-- ---------- fixtures: the developer (primary), Olga (invited owner), Cat (the developer's client), Dan (Olga's client) ----------
insert into public.signup_allowances (email, expires_at) values
  ('red@t.test', now() + interval '1 minute'), ('olga@t.test', now() + interval '1 minute'),
  ('cat@t.test', now() + interval '1 minute'), ('dan@t.test', now() + interval '1 minute'),
  ('eve@t.test', now() + interval '1 minute');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'red@t.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'olga@t.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'cat@t.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@t.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000e', 'eve@t.test', 'authenticated', 'authenticated');
insert into public.app_owner (id, user_id) values (true, '00000000-0000-0000-0000-00000000000a');
insert into public.owners (user_id, invited_by) values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a');

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', what; end if; raise notice 'ok - %', what; end $$;
create function pg_temp.fails(q text, what text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'ok - % (refused: %)', what, sqlerrm; return; end;
  raise exception 'FAIL: % (was allowed)', what;
end $$;

-- The developer: a workspace, a private record, a shared record, a client.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.workspaces (id) values ('10000000-0000-0000-0000-00000000000a');
insert into public.workspace_keys (workspace_id, wrapped_key) values ('10000000-0000-0000-0000-00000000000a', 'k');
insert into public.records (id, workspace_id, ct) values ('20000000-0000-0000-0000-0000000000a1', null, 'red-private');
insert into public.records (id, workspace_id, ct) values ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'red-shared');
select pg_temp.as_admin();
insert into public.members (workspace_id, user_id) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c');
insert into public.inbox (source, sealed) values ('gmail', 'sealed-to-red');

-- Olga: the same.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.workspaces (id) values ('10000000-0000-0000-0000-00000000000b');
insert into public.records (id, workspace_id, ct) values ('20000000-0000-0000-0000-0000000000b1', null, 'olga-private');
insert into public.records (id, workspace_id, ct) values ('20000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-00000000000b', 'olga-shared');
select pg_temp.as_admin();
insert into public.members (workspace_id, user_id) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000d');

-- ---------- roles ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.vault_role() = 'red', 'The developer is red');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(public.vault_role() = 'owner', 'Olga is an owner, not red');
select pg_temp.check(not public.is_owner(), 'is_owner() is false for Olga');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check(public.vault_role() = 'client', 'Cat is a client');

-- ---------- Olga sees none of the developer's things ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.records where ct like 'red-%') = 0, 'Olga reads no the developer record');
select pg_temp.check((select count(*) from public.records) = 2, 'Olga reads exactly her own 2 records');
select pg_temp.check((select count(*) from public.workspaces) = 1, 'Olga sees only her workspace');
select pg_temp.check((select count(*) from public.members) = 1, 'Olga sees only her client');
select pg_temp.check((select count(*) from public.inbox) = 0, 'Olga sees none of the developer''s sealed inbox');
select pg_temp.check((select count(*) from public.access_log where user_id = '00000000-0000-0000-0000-00000000000a') = 0, 'Olga sees no the developer sign-ins');
select pg_temp.check((select count(*) from public.gmail_status()) = 0, 'Olga gets no Gmail status');
select pg_temp.check((select count(*) from public.calendar_status()) = 0, 'Olga gets no calendar status');
select pg_temp.check((select count(*) from public.list_owner_invites()) = 0, 'Olga cannot list owner invites');
select pg_temp.check((public.vault_probe() ->> 'i') = md5(''), 'Olga''s probe fingerprints no inbox rows');
select pg_temp.check(not public.is_member('10000000-0000-0000-0000-00000000000a'), 'Olga is not a member of the developer''s workspace');
select pg_temp.fails($q$insert into public.records (id, workspace_id, ct) values (gen_random_uuid(), '10000000-0000-0000-0000-00000000000a', 'x')$q$, 'Olga cannot write into the developer''s workspace');
select pg_temp.fails($q$insert into public.workspace_keys (workspace_id, wrapped_key) values ('10000000-0000-0000-0000-00000000000a', 'k')$q$, 'Olga cannot add herself a key to the developer''s workspace');
select pg_temp.fails($q$insert into public.invites (workspace_id, token_hash, wrapped_key, expires_at) values ('10000000-0000-0000-0000-00000000000a', 'h', 'k', now() + interval '1 day')$q$, 'Olga cannot make an invite to the developer''s workspace');
select pg_temp.fails($q$insert into public.workspaces (id, owner_id) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a') returning case when owner_id <> '00000000-0000-0000-0000-00000000000b' then 1/0 end$q$, 'Olga cannot create a workspace in the developer''s name');
select pg_temp.fails($q$select public.create_owner_invite(repeat('a', 64))$q$, 'Olga cannot mint owner invites');
select pg_temp.fails($q$select public.claim_owner_invite(gen_random_uuid(), repeat('a', 64))$q$, 'Olga cannot call the claim function');
select pg_temp.fails($q$select * from public.owners$q$, 'Olga cannot read the owners table');
select pg_temp.fails($q$select * from public.owner_invites$q$, 'Olga cannot read owner invites');
delete from public.records where ct like 'red-%';
delete from public.workspaces where id = '10000000-0000-0000-0000-00000000000a';
delete from public.members where workspace_id = '10000000-0000-0000-0000-00000000000a';
update public.records set ct = 'pwned' where ct like 'red-%';
select pg_temp.as_admin();
select pg_temp.check((select count(*) from public.records where ct like 'red-%') = 2, 'Olga''s delete and update of the developer''s records did nothing');
select pg_temp.check((select count(*) from public.workspaces where id = '10000000-0000-0000-0000-00000000000a') = 1, 'The developer''s workspace survives Olga');
select pg_temp.check((select count(*) from public.members where workspace_id = '10000000-0000-0000-0000-00000000000a') = 1, 'The developer''s client survives Olga');

-- ---------- The developer sees none of Olga's things ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.records where ct like 'olga-%') = 0, 'The developer reads no Olga record');
select pg_temp.check((select count(*) from public.workspaces where id = '10000000-0000-0000-0000-00000000000b') = 0, 'The developer does not see Olga''s workspace');
select pg_temp.check((select count(*) from public.members where workspace_id = '10000000-0000-0000-0000-00000000000b') = 0, 'The developer does not see Olga''s client');
select pg_temp.check((select count(*) from public.inbox) = 1, 'The developer still reads his own sealed inbox');
delete from public.records where ct like 'olga-%';
select pg_temp.fails($q$insert into public.records (id, workspace_id, ct) values (gen_random_uuid(), '10000000-0000-0000-0000-00000000000b', 'x')$q$, 'The developer cannot write into Olga''s workspace');
select pg_temp.as_admin();
select pg_temp.check((select count(*) from public.records where ct like 'olga-%') = 2, 'The developer''s delete of Olga''s records did nothing');

-- ---------- clients stay in their sandbox ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.records) = 1 and (select ct from public.records) = 'red-shared', 'Cat reads only the developer''s shared record for her');
select pg_temp.fails($q$insert into public.records (id, workspace_id, ct) values (gen_random_uuid(), null, 'x')$q$, 'Cat cannot write a private (owner) record');
select pg_temp.fails($q$insert into public.workspaces default values$q$, 'Cat cannot create a workspace');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.records) = 1 and (select ct from public.records) = 'olga-shared', 'Dan reads only Olga''s shared record for him');

-- ---------- owner invites: the developer only, single use, capped ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.create_owner_invite(encode(extensions.digest('secret-1', 'sha256'), 'hex')) as inv1 \gset
select pg_temp.check((select count(*) from public.list_owner_invites()) = 1, 'The developer lists his invite');
select pg_temp.as_admin();
select pg_temp.check(public.claim_owner_invite(:'inv1', encode(extensions.digest('wrong', 'sha256'), 'hex')) = false, 'a wrong secret does not claim');
select pg_temp.check(public.claim_owner_invite(:'inv1', encode(extensions.digest('secret-1', 'sha256'), 'hex')) = true, 'the right secret claims');
select pg_temp.check(public.claim_owner_invite(:'inv1', encode(extensions.digest('secret-1', 'sha256'), 'hex')) = false, 'a second claim while in flight fails');
select pg_temp.check(public.finish_owner_invite(:'inv1', '00000000-0000-0000-0000-00000000000e') = true, 'finish makes Eve an owner');
select pg_temp.check(public.finish_owner_invite(:'inv1', '00000000-0000-0000-0000-00000000000c') = false, 'a used invite never finishes twice');
select pg_temp.check(public.claim_owner_invite(:'inv1', encode(extensions.digest('secret-1', 'sha256'), 'hex')) = false, 'a used invite never claims again (replay)');
select pg_temp.check(exists (select 1 from public.owners where user_id = '00000000-0000-0000-0000-00000000000e'), 'Eve is in owners');
select pg_temp.check(not exists (select 1 from public.owners where user_id = '00000000-0000-0000-0000-00000000000c'), 'Cat did not become an owner');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.create_owner_invite(encode(extensions.digest('secret-2', 'sha256'), 'hex')) as inv2 \gset
select pg_temp.check(public.revoke_owner_invite(:'inv2'), 'The developer revokes an open invite');
select pg_temp.as_admin();
select pg_temp.check(public.claim_owner_invite(:'inv2', encode(extensions.digest('secret-2', 'sha256'), 'hex')) = false, 'a revoked invite never claims');
update public.owner_invites set expires_at = now() - interval '1 second' where id = :'inv2';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.fails($q$select public.create_owner_invite('not-a-hash')$q$, 'a malformed hash is refused');

-- ---------- review fixes ----------
-- Owners never join a client workspace (theirs or anyone's), even with a valid client invite.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.invites (id, workspace_id, token_hash, wrapped_key, expires_at)
  values ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', encode(extensions.digest('tok', 'sha256'), 'hex'), 'wk', now() + interval '1 day');
select pg_temp.fails($q$update public.invites set used_by = '00000000-0000-0000-0000-00000000000e' where id = '30000000-0000-0000-0000-00000000000a' returning 1/0$q$, 'The developer cannot edit an invite''s used_by (no update rights)');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.fails($q$select public.redeem_invite('30000000-0000-0000-0000-00000000000a', 'tok')$q$, 'Olga cannot redeem the developer''s client invite');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check(public.redeem_invite('30000000-0000-0000-0000-00000000000a', 'wrong') is null, 'a wrong client invite secret gets nothing');
select pg_temp.as_admin();
select pg_temp.check((select fail_count from public.invites where id = '30000000-0000-0000-0000-00000000000a') = 1, 'the wrong secret was counted');
update public.invites set fail_count = 10 where id = '30000000-0000-0000-0000-00000000000a';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.fails($q$select public.redeem_invite('30000000-0000-0000-0000-00000000000a', 'tok')$q$, 'after 10 wrong secrets even the right one is refused');
select pg_temp.as_admin();
select pg_temp.check(not exists (select 1 from public.members where user_id = '00000000-0000-0000-0000-00000000000b' and workspace_id = '10000000-0000-0000-0000-00000000000a'), 'Olga is not in the developer''s workspace');
-- Client invites: claim is single use.
update public.invites set fail_count = 0 where id = '30000000-0000-0000-0000-00000000000a';
select pg_temp.check(public.claim_client_invite('30000000-0000-0000-0000-00000000000a', encode(extensions.digest('tok', 'sha256'), 'hex')), 'a client invite claims once');
select pg_temp.check(not public.claim_client_invite('30000000-0000-0000-0000-00000000000a', encode(extensions.digest('tok', 'sha256'), 'hex')), 'and never twice');
-- Storage limit: Olga is capped, the developer is not.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.fails($q$insert into public.records (id, workspace_id, ct) values (gen_random_uuid(), null, repeat('x', 2 * 1024 * 1024))$q$, 'Olga cannot store a 2 MB record');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.records (id, workspace_id, ct) values ('20000000-0000-0000-0000-0000000000a9', null, repeat('x', 2 * 1024 * 1024));
select pg_temp.check(exists (select 1 from public.records where id = '20000000-0000-0000-0000-0000000000a9'), 'The developer can (no limit for the developer)');
-- The assistant: never an owner, and never edits outside the developer's workspaces.
select pg_temp.fails($q$insert into public.agents (user_id) values ('00000000-0000-0000-0000-00000000000b')$q$, 'The developer cannot make Olga the assistant');
select pg_temp.as_admin();
insert into public.agents (user_id) values ('00000000-0000-0000-0000-00000000000d');   -- pretend Dan were the assistant
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
update public.records set ct = 'agent-edit' where id = '20000000-0000-0000-0000-0000000000b2';
select pg_temp.as_admin();
select pg_temp.check((select ct from public.records where id = '20000000-0000-0000-0000-0000000000b2') = 'olga-shared', 'an assistant cannot edit Olga''s records');
delete from public.agents where user_id = '00000000-0000-0000-0000-00000000000d';
-- Clients learn who may author their workspace's documents: the owner only.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select array_agg(user_id) from public.workspace_trusted_authors()) = array['00000000-0000-0000-0000-00000000000a'::uuid], 'Cat trusts only the developer in her workspace');
-- Sign-in log: an owner never sees another owner's sign-ins, even through membership.
select pg_temp.as_admin();
insert into public.access_log (user_id) values ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');
insert into public.members (workspace_id, user_id) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.access_log where user_id = '00000000-0000-0000-0000-00000000000b') = 0, 'The developer never sees Olga''s sign-ins');
select pg_temp.check((select count(*) from public.access_log where user_id = '00000000-0000-0000-0000-00000000000c') = 1, 'The developer sees his client''s sign-ins');
select pg_temp.as_admin();
delete from public.members where user_id = '00000000-0000-0000-0000-00000000000b' and workspace_id = '10000000-0000-0000-0000-00000000000a';

-- ---------- presence: own topic only ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.fails($q$insert into realtime.messages (topic, extension, payload, private) values ('ps-presence', 'presence', '{}', true)$q$, 'Olga cannot post on the developer''s presence topic');
select pg_temp.fails($q$insert into realtime.messages (topic, extension, payload, private) values ('ps-presence:00000000-0000-0000-0000-00000000000a', 'presence', '{}', true)$q$, 'Olga cannot post on another owner''s topic');

select pg_temp.as_admin();
rollback;
