-- Cincee Client Vault: zero-knowledge storage.
-- The database only ever holds AES-256-GCM ciphertext produced in the browser.
-- Access control (who can fetch which ciphertext) is enforced here with RLS;
-- confidentiality comes from keys the server never sees.

create extension if not exists pgcrypto with schema extensions;

-- Single owner (the developer). Set once by the vault-auth edge function.
create table public.app_owner (
  id boolean primary key default true check (id),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- One-time owner setup codes (sha256 hex). Deleted when the owner is created.
create table public.setup_codes (
  code_hash text primary key,
  expires_at timestamptz not null
);

-- Per user key material. Everything here is wrapped (encrypted) client side.
create table public.user_keys (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  kdf jsonb not null,                 -- public KDF params, eg {"alg":"PBKDF2-SHA256","iters":600000,"v":1}
  wrapped_vk text not null,           -- vault key wrapped under the passphrase key
  wrapped_vk_recovery text,           -- vault key wrapped under the recovery key (owner)
  recovery_check text,                -- sha256 of the recovery auth token (owner), lets the edge fn reset login
  public_key text,                    -- owner ECDH P-256 public key (spki, b64), for sealed inbox items
  wrapped_private_key text,           -- matching private key wrapped under the vault key
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'client' check (role in ('client')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index members_user_idx on public.members(user_id);

-- Each workspace key, wrapped separately for every user allowed to read it.
create table public.workspace_keys (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  wrapped_key text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_keys_user_idx on public.workspace_keys(user_id);

-- Encrypted documents. workspace_id null = owner private (vault key),
-- otherwise shared with that workspace (workspace key). AAD binds id + scope.
create table public.records (
  id uuid primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ct text not null,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index records_ws_updated_idx on public.records(workspace_id, updated_at);
create index records_author_updated_idx on public.records(author_id, updated_at);
create index records_updated_idx on public.records(updated_at);

-- Client invites. The secret lives only in the link fragment; the server
-- stores a hash of a token derived from it and a workspace key wrapped under it.
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token_hash text not null,
  wrapped_key text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index invites_ws_idx on public.invites(workspace_id);

-- Sealed inbox (Fireflies). Encrypted to the owner public key by the edge fn.
create table public.inbox (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'fireflies',
  sealed text not null,
  created_at timestamptz not null default now()
);

-- ---------- helpers ----------
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_owner where user_id = (select auth.uid()));
$$;

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_owner() or exists (
    select 1 from public.members where workspace_id = ws and user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_owner() from public, anon;
revoke all on function public.is_member(uuid) from public, anon;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_member(uuid) to authenticated;

-- Records: author and scope are immutable, timestamps come from the server.
create or replace function public.records_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then new.author_id := (select auth.uid()); end if;
    new.created_at := now();
    new.updated_at := now();
  else
    new.id := old.id;
    new.author_id := old.author_id;
    new.workspace_id := old.workspace_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger records_guard before insert or update on public.records
  for each row execute function public.records_guard();

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger user_keys_touch before update on public.user_keys
  for each row execute function public.touch_updated_at();

-- Signups are invite only: the public signup endpoint cannot set app metadata,
-- only the vault-auth edge function (service role) can.
create or replace function public.vault_signup_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'vault_invited', '') <> 'yes' then
    raise exception 'Signups are invite only';
  end if;
  return new;
end $$;
create trigger vault_signup_gate before insert on auth.users
  for each row execute function public.vault_signup_gate();

-- Existing users redeem a new invite while signed in (second workspace).
create or replace function public.redeem_invite(invite uuid, token text) returns text
language plpgsql security definer set search_path = '' as $$
declare inv public.invites%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  select * into inv from public.invites
   where id = invite
     and token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
     and expires_at > now()
     and (used_at is null or used_by = (select auth.uid()));
  if not found then raise exception 'Invite is invalid or has expired'; end if;
  insert into public.members(workspace_id, user_id) values (inv.workspace_id, (select auth.uid()))
    on conflict do nothing;
  update public.invites set used_at = coalesce(used_at, now()), used_by = (select auth.uid()) where id = inv.id;
  return inv.wrapped_key;
end $$;
revoke all on function public.redeem_invite(uuid, text) from public, anon;
grant execute on function public.redeem_invite(uuid, text) to authenticated;

-- ---------- RLS ----------
alter table public.app_owner enable row level security;
alter table public.setup_codes enable row level security;
alter table public.user_keys enable row level security;
alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.workspace_keys enable row level security;
alter table public.records enable row level security;
alter table public.invites enable row level security;
alter table public.inbox enable row level security;
-- app_owner and setup_codes: no policies at all (service role only).

create policy "own keys read" on public.user_keys for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own keys insert" on public.user_keys for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own keys update" on public.user_keys for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "workspaces read" on public.workspaces for select to authenticated
  using (public.is_member(id));
create policy "workspaces owner insert" on public.workspaces for insert to authenticated
  with check (public.is_owner());
create policy "workspaces owner delete" on public.workspaces for delete to authenticated
  using (public.is_owner());

create policy "members read" on public.members for select to authenticated
  using (public.is_owner() or user_id = (select auth.uid()));
create policy "members owner delete" on public.members for delete to authenticated
  using (public.is_owner());

create policy "wskeys read own" on public.workspace_keys for select to authenticated
  using (user_id = (select auth.uid()));
create policy "wskeys insert own" on public.workspace_keys for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member(workspace_id));
create policy "wskeys update own" on public.workspace_keys for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.is_member(workspace_id));
create policy "wskeys owner delete" on public.workspace_keys for delete to authenticated
  using (public.is_owner());

create policy "records read" on public.records for select to authenticated
  using (
    (workspace_id is null and author_id = (select auth.uid()) and public.is_owner())
    or (workspace_id is not null and public.is_member(workspace_id))
  );
create policy "records insert" on public.records for insert to authenticated
  with check (
    author_id = (select auth.uid()) and (
      (workspace_id is null and public.is_owner())
      or (workspace_id is not null and public.is_member(workspace_id))
    )
  );
create policy "records update" on public.records for update to authenticated
  using (
    (workspace_id is null and author_id = (select auth.uid()) and public.is_owner())
    or (workspace_id is not null and public.is_owner())
    or (workspace_id is not null and author_id = (select auth.uid()) and public.is_member(workspace_id))
  )
  with check (
    (workspace_id is null and public.is_owner())
    or (workspace_id is not null and public.is_member(workspace_id))
  );
create policy "records owner delete" on public.records for delete to authenticated
  using (public.is_owner());

create policy "invites owner all" on public.invites for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "inbox owner read" on public.inbox for select to authenticated
  using (public.is_owner());
create policy "inbox owner delete" on public.inbox for delete to authenticated
  using (public.is_owner());

-- anon gets nothing anywhere.
revoke all on all tables in schema public from anon;
