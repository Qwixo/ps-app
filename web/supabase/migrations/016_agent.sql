-- One trusted assistant account (Claude, on the developer's Mac) that can edit CLIENT workspaces like the developer
-- does, and nothing else (16 Oct 2026, the developer's request).
-- * It joins each client workspace through a normal invite that the developer's vault creates, so it only
--   ever holds the keys of workspaces the developer gave it. It never holds the developer's vault key, and the
--   existing policies already stop any non-owner reading the developer's private records (workspace_id null).
-- * Only the developer (the owner) can add or remove the assistant here; revoking also removes its
--   memberships and workspace keys (done by the app).
create table public.agents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.agents enable row level security;
revoke all on public.agents from anon;
create policy "agents owner all" on public.agents for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy "agents read self" on public.agents for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.is_agent() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agents where user_id = (select auth.uid()));
$$;
revoke all on function public.is_agent() from public, anon;
grant execute on function public.is_agent() to authenticated;

-- Records: the assistant may update any record in a client workspace it is a member of
-- (author and scope stay immutable through records_guard). Never workspace_id null.
drop policy "records update" on public.records;
create policy "records update" on public.records for update to authenticated
  using (
    (workspace_id is null and author_id = (select auth.uid()) and public.is_owner())
    or (workspace_id is not null and public.is_owner())
    or (workspace_id is not null and author_id = (select auth.uid()) and public.is_member(workspace_id))
    or (workspace_id is not null and public.is_agent() and public.is_member(workspace_id))
  )
  with check (
    (workspace_id is null and public.is_owner())
    or (workspace_id is not null and public.is_member(workspace_id))
  );

-- Files: the assistant may add files to client workspaces it is a member of (eg a signed PDF).
drop policy "blobs owner insert" on public.blobs;
create policy "blobs insert" on public.blobs for insert to authenticated
  with check (
    author_id = (select auth.uid()) and (
      public.is_owner()
      or (workspace_id is not null and public.is_agent() and public.is_member(workspace_id))
    )
  );
