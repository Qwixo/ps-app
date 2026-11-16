-- Rollback of dm_001_dm_groups_avatars.sql: removes only the dm_ tables and functions. Messages sent in DMs and groups are lost.
begin;
drop function if exists public.dm_tidy();
drop function if exists public.dm_edit(uuid, uuid, uuid, integer, text);
drop function if exists public.dm_avatar_set(uuid, text, integer);
drop function if exists public.dm_post(uuid, uuid, uuid, integer, text);
drop function if exists public.dm_rotate(uuid, uuid, integer, jsonb, text);
drop function if exists public.dm_change(uuid, uuid, uuid[], uuid);
drop function if exists public.dm_new(uuid, uuid, text, uuid[], text, jsonb);
drop function if exists public.dm_status(uuid);
drop function if exists public.dm_access(uuid, uuid);
drop function if exists public.dm_lock(uuid);
drop function if exists public.dm_in(uuid);
drop index if exists public.squad_members_left;
drop table if exists public.dm_epochs, public.dm_meta, public.dm_avatars, public.dm_reads, public.dm_messages, public.dm_keydrops, public.dm_members, public.dm_convs;
commit;
