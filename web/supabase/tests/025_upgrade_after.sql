-- Upgrade check, step 3 of 3 (see 025_upgrade_seed.sql): the developer, his client and his assistant keep everything after 025.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('role','authenticated',true); perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true); end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'FAIL: %', what; end if; raise notice 'ok - %', what; end $$;
select pg_temp.check((select owner_id from public.workspaces) = '00000000-0000-0000-0000-00000000000a', 'existing workspace backfilled to the developer');
select pg_temp.check(exists (select 1 from public.owners where user_id = '00000000-0000-0000-0000-00000000000a'), 'The developer is in owners');
select pg_temp.check(not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename in ('inbox','records')), 'inbox and records left the public change feed');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.vault_role() = 'red', 'The developer is still red');
select pg_temp.check((select count(*) from public.records) = 3, 'The developer still reads all 3 records');
select pg_temp.check((select count(*) from public.inbox) = 1, 'The developer still reads his inbox');
select pg_temp.check((select count(*) from public.members) = 2, 'The developer still sees his members');
select pg_temp.check((select count(*) from public.invites) = 1, 'The developer still sees his invites');
select pg_temp.check((select count(*) from public.workspace_keys) = 1, 'The developer still has his workspace key');
update public.records set ct = 'red-private-2' where id = '20000000-0000-0000-0000-0000000000a1';
update public.records set ct = 'cat-tick-edited-by-red' where id = '20000000-0000-0000-0000-0000000000a3';
insert into public.records (id, workspace_id, ct) values (gen_random_uuid(), '10000000-0000-0000-0000-00000000000a', 'red-new');
insert into public.workspaces (id) values ('10000000-0000-0000-0000-0000000000a2') returning id;   -- read back in the same request, as the app does
select pg_temp.check((select owner_id from public.workspaces where id = '10000000-0000-0000-0000-0000000000a2') = '00000000-0000-0000-0000-00000000000a', 'The developer can still add a client workspace');
select pg_temp.check((select count(*) from public.list_owner_invites()) = 0, 'The developer can list owner invites');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
update public.records set ct = 'agent-edit' where id = '20000000-0000-0000-0000-0000000000a2';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check(public.vault_role() = 'client', 'Cat is still a client');
select pg_temp.check((select count(*) from public.records) = 3, 'Cat reads her workspace (3 shared records)');
select pg_temp.check((select count(*) from public.records where workspace_id is null) = 0, 'Cat reads none of the developer''s private records');
set local role postgres;
select pg_temp.check((select ct from public.records where id = '20000000-0000-0000-0000-0000000000a1') = 'red-private-2', 'The developer''s edit of his private record saved');
select pg_temp.check((select ct from public.records where id = '20000000-0000-0000-0000-0000000000a3') = 'cat-tick-edited-by-red', 'The developer can still edit a client-written record');
select pg_temp.check((select ct from public.records where id = '20000000-0000-0000-0000-0000000000a2') = 'agent-edit', 'the assistant can still edit in the developer''s workspace');
rollback;
