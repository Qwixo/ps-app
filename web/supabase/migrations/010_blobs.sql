-- Encrypted files (proposal PDFs, agreements). Same model as records: AES-256-GCM in the
-- browser with the workspace key (or the vault key when workspace_id is null), AAD binds
-- id + scope. Fetched on demand, not synced, because files are large.
create table public.blobs (
  id uuid primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ct text not null,
  size integer not null default 0,
  created_at timestamptz not null default now()
);
create index blobs_ws_idx on public.blobs(workspace_id);
alter table public.blobs enable row level security;
revoke all on public.blobs from anon;

create policy "blobs read" on public.blobs for select to authenticated
  using (
    (workspace_id is null and author_id = (select auth.uid()) and public.is_owner())
    or (workspace_id is not null and public.is_member(workspace_id))
  );
create policy "blobs owner insert" on public.blobs for insert to authenticated
  with check (public.is_owner() and author_id = (select auth.uid()));
create policy "blobs owner delete" on public.blobs for delete to authenticated
  using (public.is_owner());

create or replace function public.blobs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then new.author_id := (select auth.uid()); end if;
  new.created_at := now();
  return new;
end $$;
revoke all on function public.blobs_guard() from public, anon, authenticated;
create trigger blobs_guard before insert on public.blobs for each row execute function public.blobs_guard();
