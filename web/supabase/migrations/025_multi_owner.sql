-- 025: more than one vault owner (27 Oct 2026, the developer's request). NOT APPLIED until the security review is done
-- and the manager gives the go.
--
-- Until now the vault had one owner, the developer (public.app_owner), and is_owner() meant "is the developer". The developer can now hand
-- someone a one-time "Invite someone" link that creates a NEW OWNER: their own vault, passphrase, recovery key,
-- clients and workspaces, with the same zero-knowledge model. Strict isolation both ways.
--
-- Design rules:
-- * is_owner() keeps meaning "is the developer" (the primary owner). Everything that was developer-only stays developer-only by
--   default: the sealed inbox (Gmail, Telegram, Fireflies, Instantly, calendar, follow-up feed, Claude's
--   packages), the feed status functions, the Claude assistant (agents), the access log of other owners.
--   Every edge function keeps sealing to app_owner, i.e. to the developer only.
-- * is_vault_owner() means "any owner, the developer included". Workspaces now carry owner_id; an owner reaches only
--   workspaces they own or are a member of, and only their OWN private records (workspace_id null).
-- * Only the developer can create owner invites. Redemption runs only in vault-auth (service role), atomically,
--   single use, with a cap on how many owners the free plan carries.
-- * The server stores no names: an invite is a hash of a 256-bit secret that lives only in the link fragment.
--
-- After the security review (27 Oct 2026) this also: keeps owners out of each other's workspaces, limits the
-- assistant to the developer's workspaces, caps storage per invited owner, binds client password resets to the invite
-- made for that login, counts wrong invite secrets, and moves the live inbox signal to a private developer-only topic.
-- Deploy order: apply this migration FIRST, then deploy vault-auth, then release the web app.

begin;

-- Never run against a vault that has workspaces but no primary owner (it would leave them ownerless).
do $$ begin
  if not exists (select 1 from public.app_owner) and exists (select 1 from public.workspaces) then
    raise exception 'No primary owner: refusing to migrate';
  end if;
end $$;

-- ---------- owners ----------
create table if not exists public.owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.owners enable row level security;
revoke all on public.owners from anon, authenticated;
comment on table public.owners is 'Every vault owner (the developer included). Service role only; callers learn their own role through vault_role().';
insert into public.owners (user_id) select user_id from public.app_owner on conflict (user_id) do nothing;

-- The developer's own row follows app_owner, so a fresh database (owner_setup) gets it too.
create or replace function public.app_owner_to_owners() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.owners (user_id) values (new.user_id) on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function public.app_owner_to_owners() from public, anon, authenticated;
drop trigger if exists app_owner_to_owners on public.app_owner;
create trigger app_owner_to_owners after insert on public.app_owner
  for each row execute function public.app_owner_to_owners();

create or replace function public.is_vault_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_owner() or exists (select 1 from public.owners where user_id = (select auth.uid()));
$$;
revoke all on function public.is_vault_owner() from public, anon;
grant execute on function public.is_vault_owner() to authenticated;

-- "red" (the primary owner), "owner" (invited owner) or "client". Only ever about the caller.
create or replace function public.vault_role() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when (select auth.uid()) is null then null
    when public.is_owner() then 'red'
    when exists (select 1 from public.owners where user_id = (select auth.uid())) then 'owner'
    else 'client' end;
$$;
revoke all on function public.vault_role() from public, anon;
grant execute on function public.vault_role() to authenticated;

-- ---------- workspaces belong to one owner ----------
alter table public.workspaces add column if not exists owner_id uuid references auth.users(id) on delete cascade;
update public.workspaces set owner_id = (select user_id from public.app_owner) where owner_id is null;
alter table public.workspaces alter column owner_id set default auth.uid();
alter table public.workspaces alter column owner_id set not null;
create index if not exists workspaces_owner_idx on public.workspaces(owner_id);

-- owner_id is always the creator and never changes.
create or replace function public.workspaces_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then new.owner_id := (select auth.uid()); end if;
    new.created_at := now();
  else
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
revoke all on function public.workspaces_guard() from public, anon, authenticated;
drop trigger if exists workspaces_guard on public.workspaces;
create trigger workspaces_guard before insert or update on public.workspaces
  for each row execute function public.workspaces_guard();

create or replace function public.owns_workspace(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspaces where id = ws and owner_id = (select auth.uid()));
$$;
revoke all on function public.owns_workspace(uuid) from public, anon;
grant execute on function public.owns_workspace(uuid) to authenticated;

-- Was "The developer, or a member". Now: the workspace's own owner, or a member. (Every existing workspace is the developer's.)
create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.owns_workspace(ws) or exists (
    select 1 from public.members where workspace_id = ws and user_id = (select auth.uid())
  );
$$;

-- The assistant (public.agents, the developer's Claude account) may only ever edit inside THE DEVELOPER's workspaces, even if it
-- were somehow a member of another owner's.
create or replace function public.agent_can_edit(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_agent() and public.is_member(ws) and exists (
    select 1 from public.workspaces w join public.app_owner a on a.user_id = w.owner_id where w.id = ws
  );
$$;
revoke all on function public.agent_can_edit(uuid) from public, anon;
grant execute on function public.agent_can_edit(uuid) to authenticated;

-- Never an owner as the assistant.
create or replace function public.agent_target_ok(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.owners where user_id = u)
     and not exists (select 1 from public.app_owner where user_id = u);
$$;
revoke all on function public.agent_target_ok(uuid) from public, anon;
grant execute on function public.agent_target_ok(uuid) to authenticated;
drop policy if exists "agents owner all" on public.agents;
create policy "agents owner all" on public.agents for all to authenticated
  using (public.is_owner()) with check (public.is_owner() and public.agent_target_ok(user_id));

-- ---------- policies: is_owner() ("Owner") becomes "this owner, on their own things" ----------
-- Read: the owner by the row's own column (so a just-inserted workspace can be read back in the same request,
-- which the app does for every new client; a function looking the row up would not see it yet), or a member.
drop policy if exists "workspaces read" on public.workspaces;
create policy "workspaces read" on public.workspaces for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_member(id));
drop policy if exists "workspaces owner insert" on public.workspaces;
drop policy if exists "workspaces owner delete" on public.workspaces;
create policy "workspaces owner insert" on public.workspaces for insert to authenticated
  with check (public.is_vault_owner() and owner_id = (select auth.uid()));
create policy "workspaces owner delete" on public.workspaces for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "members read" on public.members;
drop policy if exists "members owner delete" on public.members;
create policy "members read" on public.members for select to authenticated
  using (user_id = (select auth.uid()) or public.owns_workspace(workspace_id));
create policy "members owner delete" on public.members for delete to authenticated
  using (public.owns_workspace(workspace_id));

drop policy if exists "wskeys owner delete" on public.workspace_keys;
create policy "wskeys owner delete" on public.workspace_keys for delete to authenticated
  using (public.owns_workspace(workspace_id));

drop policy if exists "records read" on public.records;
drop policy if exists "records insert" on public.records;
drop policy if exists "records update" on public.records;
drop policy if exists "records owner delete" on public.records;
create policy "records read" on public.records for select to authenticated
  using (
    (workspace_id is null and author_id = (select auth.uid()) and public.is_vault_owner())
    or (workspace_id is not null and public.is_member(workspace_id))
  );
create policy "records insert" on public.records for insert to authenticated
  with check (
    author_id = (select auth.uid()) and (
      (workspace_id is null and public.is_vault_owner())
      or (workspace_id is not null and public.is_member(workspace_id))
    )
  );
create policy "records update" on public.records for update to authenticated
  using (
    (workspace_id is null and author_id = (select auth.uid()) and public.is_vault_owner())
    or (workspace_id is not null and public.owns_workspace(workspace_id))
    or (workspace_id is not null and author_id = (select auth.uid()) and public.is_member(workspace_id))
    or (workspace_id is not null and public.agent_can_edit(workspace_id))
  )
  with check (
    (workspace_id is null and author_id = (select auth.uid()) and public.is_vault_owner())
    or (workspace_id is not null and public.is_member(workspace_id))
  );
create policy "records owner delete" on public.records for delete to authenticated
  using (
    (workspace_id is null and author_id = (select auth.uid()) and public.is_vault_owner())
    or (workspace_id is not null and public.owns_workspace(workspace_id))
  );

-- Client invites. for_login: the pseudonymous login the invite was made for (the client's email or three-word
-- username, hashed exactly as their login is), so a forgotten-password reset works only through an invite made
-- for that very login. fail_count: wrong secrets tried; 10 locks the invite. Owners may make, read and cancel
-- their own invites but never change one (used_by, used_at, counts are vault-auth's).
alter table public.invites add column if not exists for_login text check (for_login is null or for_login ~ '^v-[0-9a-f]{40}@vault\.cincee\.app$');
alter table public.invites add column if not exists fail_count integer not null default 0;
drop policy if exists "invites owner all" on public.invites;
drop policy if exists "invites owner read" on public.invites;
drop policy if exists "invites owner insert" on public.invites;
drop policy if exists "invites owner delete" on public.invites;
create policy "invites owner read" on public.invites for select to authenticated
  using (public.owns_workspace(workspace_id));
create policy "invites owner insert" on public.invites for insert to authenticated
  with check (public.owns_workspace(workspace_id) and used_at is null and used_by is null and fail_count = 0);
create policy "invites owner delete" on public.invites for delete to authenticated
  using (public.owns_workspace(workspace_id));

-- vault-auth only: count a wrong secret; claim an invite for one join (atomic); finish or release it.
create or replace function public.invite_failed(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.invites set fail_count = fail_count + 1 where id = p_id;
$$;
create or replace function public.claim_client_invite(p_id uuid, p_token_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.invites set used_at = now()
   where id = p_id and token_hash = p_token_hash and used_at is null and expires_at > now() and fail_count < 10;
  return found;
end $$;
create or replace function public.release_client_invite(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.invites set used_at = null where id = p_id and used_by is null;
$$;
-- After a password reset: end every session of that account, so a reset really locks out whoever had it.
create or replace function public.end_sessions(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.refresh_tokens where user_id = p_user::text;
  delete from auth.sessions where user_id = p_user;
end $$;
revoke all on function public.invite_failed(uuid) from public, anon, authenticated;
revoke all on function public.claim_client_invite(uuid, text) from public, anon, authenticated;
revoke all on function public.release_client_invite(uuid) from public, anon, authenticated;
revoke all on function public.end_sessions(uuid) from public, anon, authenticated;
grant execute on function public.invite_failed(uuid) to service_role;
grant execute on function public.claim_client_invite(uuid, text) to service_role;
grant execute on function public.release_client_invite(uuid) to service_role;
grant execute on function public.end_sessions(uuid) to service_role;

-- Signed-in redemption of a client invite (a second workspace). Now: never an owner (owners stay out of each
-- other's workspaces), the assistant only into the developer's, and wrong secrets count towards the lock.
create or replace function public.redeem_invite(invite uuid, token text) returns text
language plpgsql security definer set search_path = '' as $$
declare inv public.invites%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  select * into inv from public.invites where id = invite;
  if not found then raise exception 'Invite is invalid or has expired'; end if;
  if inv.token_hash <> encode(extensions.digest(token, 'sha256'), 'hex') then
    -- Counted, then a plain "no" (null): raising here would roll the count back.
    update public.invites set fail_count = fail_count + 1 where id = inv.id;
    return null;
  end if;
  if inv.expires_at <= now() or inv.fail_count >= 10 or (inv.used_at is not null and inv.used_by is distinct from (select auth.uid())) then
    raise exception 'Invite is invalid or has expired';
  end if;
  if public.is_vault_owner() then raise exception 'Owner accounts cannot join a client workspace'; end if;
  if public.is_agent() and not exists (
    select 1 from public.workspaces w join public.app_owner a on a.user_id = w.owner_id where w.id = inv.workspace_id
  ) then raise exception 'Invite is invalid or has expired'; end if;
  insert into public.members(workspace_id, user_id) values (inv.workspace_id, (select auth.uid()))
    on conflict do nothing;
  update public.invites set used_at = coalesce(used_at, now()), used_by = (select auth.uid()) where id = inv.id;
  return inv.wrapped_key;
end $$;
revoke all on function public.redeem_invite(uuid, text) from public, anon;
grant execute on function public.redeem_invite(uuid, text) to authenticated;

drop policy if exists "blobs read" on public.blobs;
drop policy if exists "blobs insert" on public.blobs;
drop policy if exists "blobs owner delete" on public.blobs;
create policy "blobs read" on public.blobs for select to authenticated
  using (
    (workspace_id is null and author_id = (select auth.uid()) and public.is_vault_owner())
    or (workspace_id is not null and public.is_member(workspace_id))
  );
create policy "blobs insert" on public.blobs for insert to authenticated
  with check (
    author_id = (select auth.uid()) and (
      (workspace_id is null and public.is_vault_owner())
      or (workspace_id is not null and public.owns_workspace(workspace_id))
      or (workspace_id is not null and public.agent_can_edit(workspace_id))
    )
  );
create policy "blobs owner delete" on public.blobs for delete to authenticated
  using (
    (workspace_id is null and author_id = (select auth.uid()) and public.is_vault_owner())
    or (workspace_id is not null and public.owns_workspace(workspace_id))
  );

-- Sign-in log: each owner sees their own sign-ins and those of members of THEIR workspaces. The developer no longer
-- sees other owners' sign-ins (or their clients'), and they never see his.
drop policy if exists "access log owner read" on public.access_log;
create or replace function public.can_see_signins_of(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_vault_owner() and (
    u = (select auth.uid())
    or (
      not exists (select 1 from public.owners where user_id = u)
      and not exists (select 1 from public.app_owner where user_id = u)
      and exists (
        select 1 from public.members m join public.workspaces w on w.id = m.workspace_id
        where m.user_id = u and w.owner_id = (select auth.uid())
      )
    )
  );
$$;
revoke all on function public.can_see_signins_of(uuid) from public, anon;
grant execute on function public.can_see_signins_of(uuid) to authenticated;
create policy "access log owner read" on public.access_log for select to authenticated
  using (public.can_see_signins_of(user_id));

-- PS presence: the developer keeps the shared "ps-presence" topic (unchanged); every other owner gets a private topic
-- of their own, "ps-presence:<their user id>", that nobody else can join or see.
drop policy if exists "owner reads own ps presence" on realtime.messages;
drop policy if exists "owner tracks own ps presence" on realtime.messages;
create policy "owner reads own ps presence" on realtime.messages
  for select to authenticated
  using (realtime.topic() = ('ps-presence:' || (select auth.uid())::text) and extension = 'presence' and (select public.is_vault_owner()));
create policy "owner tracks own ps presence" on realtime.messages
  for insert to authenticated
  with check (realtime.topic() = ('ps-presence:' || (select auth.uid())::text) and extension = 'presence' and (select public.is_vault_owner()));

-- ---------- owner invites (the developer only) ----------
-- The link is /client/join-owner#<id>.<secret>. The secret (32 random bytes) never reaches a server; this
-- table keeps only sha256 of it. Single use, 7 day expiry, revocable. No names: the developer's own vault keeps who
-- each invite was for, encrypted.
create table if not exists public.owner_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  claimed_at timestamptz,          -- a redemption in flight (vault-auth), so two can never race
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.owner_invites enable row level security;
revoke all on public.owner_invites from anon, authenticated;
comment on table public.owner_invites is 'One-time owner invite hashes. No policies: only the developer, through the functions below, and vault-auth (service role).';

-- How many owners the free plan carries, the developer not counted (about 8 to 10 active people in all).
create or replace function public.owner_cap() returns integer language sql immutable set search_path = '' as $$ select 12 $$;
revoke all on function public.owner_cap() from public, anon, authenticated;

create or replace function public.create_owner_invite(p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; open_n int; owners_n int;
begin
  if not public.is_owner() then raise exception 'Only the primary owner can invite owners'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Bad invite'; end if;
  perform pg_advisory_xact_lock(hashtext('owner_invites'));
  select count(*) into open_n from public.owner_invites
   where used_at is null and revoked_at is null and expires_at > now();
  select count(*) into owners_n from public.owners o
   where not exists (select 1 from public.app_owner a where a.user_id = o.user_id);
  if open_n >= 5 then raise exception 'Too many open invites. Revoke one first.'; end if;
  if owners_n + open_n >= public.owner_cap() then raise exception 'The vault is full (owner limit reached).'; end if;
  insert into public.owner_invites (token_hash, created_by, expires_at)
  values (p_token_hash, (select auth.uid()), now() + interval '7 days')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_owner_invite(text) from public, anon;
grant execute on function public.create_owner_invite(text) to authenticated;

create or replace function public.revoke_owner_invite(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the primary owner can revoke owner invites'; end if;
  update public.owner_invites set revoked_at = now()
   where id = p_id and used_at is null and revoked_at is null;
  return found;
end $$;
revoke all on function public.revoke_owner_invite(uuid) from public, anon;
grant execute on function public.revoke_owner_invite(uuid) to authenticated;

-- The developer's list: ids, dates and state only (never hashes, never who used them beyond "used").
create or replace function public.list_owner_invites()
returns table (id uuid, created_at timestamptz, expires_at timestamptz, used_at timestamptz, revoked_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.created_at, i.expires_at, i.used_at, i.revoked_at from public.owner_invites i
  where public.is_owner() order by i.created_at desc limit 50;
$$;
revoke all on function public.list_owner_invites() from public, anon;
grant execute on function public.list_owner_invites() to authenticated;

-- vault-auth only: claim an invite for one redemption attempt (atomic, 2 minute hold), then finish or release.
create or replace function public.claim_owner_invite(p_id uuid, p_token_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare owners_n int;
begin
  perform pg_advisory_xact_lock(hashtext('owner_invites'));
  select count(*) into owners_n from public.owners o
   where not exists (select 1 from public.app_owner a where a.user_id = o.user_id);
  if owners_n >= public.owner_cap() then return false; end if;
  update public.owner_invites set claimed_at = now()
   where id = p_id and token_hash = p_token_hash
     and used_at is null and revoked_at is null and expires_at > now()
     and (claimed_at is null or claimed_at < now() - interval '2 minutes');
  return found;
end $$;

create or replace function public.finish_owner_invite(p_id uuid, p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_by uuid; owners_n int;
begin
  perform pg_advisory_xact_lock(hashtext('owner_invites'));
  select count(*) into owners_n from public.owners o
   where not exists (select 1 from public.app_owner a where a.user_id = o.user_id);
  if owners_n >= public.owner_cap() then return false; end if;
  update public.owner_invites set used_at = now(), used_by = p_user, claimed_at = null
   where id = p_id and used_at is null and revoked_at is null
     and claimed_at is not null and claimed_at > now() - interval '2 minutes'
   returning created_by into v_by;
  if not found then return false; end if;
  insert into public.owners (user_id, invited_by) values (p_user, v_by) on conflict (user_id) do nothing;
  return true;
end $$;

create or replace function public.release_owner_invite(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.owner_invites set claimed_at = null where id = p_id and used_at is null;
$$;

revoke all on function public.claim_owner_invite(uuid, text) from public, anon, authenticated;
revoke all on function public.finish_owner_invite(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_owner_invite(uuid) from public, anon, authenticated;
grant execute on function public.claim_owner_invite(uuid, text) to service_role;
grant execute on function public.finish_owner_invite(uuid, uuid) to service_role;
grant execute on function public.release_owner_invite(uuid) to service_role;

-- ---------- live "new inbox package" signal: the developer only ----------
-- Supabase's table change feed does not apply RLS to DELETE events, so every signed-in account (other owners
-- included) could watch the ids and times of the developer's inbox and record deletions. The app only ever used inbox
-- INSERT signals (records changes come with the paced vault_probe). So: both tables leave the change feed, and
-- each new inbox row sends an empty broadcast on a private topic, "inbox:<the developer's user id>", that only the developer can join.
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbox') then
    alter publication supabase_realtime drop table public.inbox;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records') then
    alter publication supabase_realtime drop table public.records;
  end if;
end $$;

create or replace function public.inbox_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  select user_id into v_owner from public.app_owner;
  if v_owner is not null then
    begin
      perform realtime.send('{}'::jsonb, 'inbox', 'inbox:' || v_owner::text, true);
    exception when others then
      null; -- never fail a feed because the signal could not be sent (the probe catches up)
    end;
  end if;
  return null;
end $$;
revoke all on function public.inbox_signal() from public, anon, authenticated;
drop trigger if exists inbox_signal on public.inbox;
create trigger inbox_signal after insert on public.inbox
  for each statement execute function public.inbox_signal();

drop policy if exists "red reads inbox signal" on realtime.messages;
create policy "red reads inbox signal" on realtime.messages
  for select to authenticated
  using (realtime.topic() = ('inbox:' || (select auth.uid())::text) and extension = 'broadcast' and (select public.is_owner()));

-- ---------- storage limit for invited owners (free plan: one database for everyone) ----------
-- The developer is never limited. For every other owner, everything stored in their space (their private records and
-- files, and everything in their workspaces, their clients' rows included) counts towards one quota, and no
-- single row may be huge. Stops one account filling the shared free database and locking everyone out.
create or replace function public.owner_quota_bytes() returns bigint language sql immutable set search_path = '' as $$ select 25 * 1024 * 1024::bigint $$;
revoke all on function public.owner_quota_bytes() from public, anon, authenticated;

create or replace function public.space_quota_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; used bigint; row_max bigint;
begin
  if new.workspace_id is null then v_owner := new.author_id;
  else select owner_id into v_owner from public.workspaces where id = new.workspace_id; end if;
  if v_owner is null or exists (select 1 from public.app_owner where user_id = v_owner) then return new; end if;
  row_max := case when tg_table_name = 'blobs' then 15 * 1024 * 1024 else 1024 * 1024 end;
  if octet_length(new.ct) > row_max then raise exception 'Too large to store'; end if;
  if tg_op = 'UPDATE' and octet_length(new.ct) <= octet_length(old.ct) then return new; end if;
  perform pg_advisory_xact_lock(hashtext('quota:' || v_owner::text));
  select coalesce(sum(octet_length(r.ct)), 0) into used from public.records r
    left join public.workspaces w on w.id = r.workspace_id
   where (r.workspace_id is null and r.author_id = v_owner) or w.owner_id = v_owner;
  select used + coalesce(sum(octet_length(b.ct)), 0) into used from public.blobs b
    left join public.workspaces w on w.id = b.workspace_id
   where (b.workspace_id is null and b.author_id = v_owner) or w.owner_id = v_owner;
  if used + octet_length(new.ct) - (case when tg_op = 'UPDATE' then octet_length(old.ct) else 0 end) > public.owner_quota_bytes() then
    raise exception 'Storage limit reached for this account';
  end if;
  return new;
end $$;
revoke all on function public.space_quota_guard() from public, anon, authenticated;
drop trigger if exists records_quota on public.records;
create trigger records_quota before insert or update of ct on public.records
  for each row execute function public.space_quota_guard();
drop trigger if exists blobs_quota on public.blobs;
create trigger blobs_quota before insert on public.blobs
  for each row execute function public.space_quota_guard();

-- ---------- for clients: who may author a workspace's project documents ----------
-- A client accepts projects, tasks, updates, files and the workspace name only from the workspace's owner (or
-- The developer's assistant in the developer's workspaces), never from another member. Only about workspaces the caller is in.
create or replace function public.workspace_trusted_authors() returns table (workspace_id uuid, user_id uuid)
language sql stable security definer set search_path = '' as $$
  select w.id, w.owner_id from public.workspaces w where public.is_member(w.id)
  union
  select m.workspace_id, m.user_id from public.members m
    join public.agents a on a.user_id = m.user_id
    join public.workspaces w on w.id = m.workspace_id
    join public.app_owner o on o.user_id = w.owner_id
   where public.is_member(m.workspace_id);
$$;
revoke all on function public.workspace_trusted_authors() from public, anon;
grant execute on function public.workspace_trusted_authors() to authenticated;

commit;
