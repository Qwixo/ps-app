-- PS Second Computer (31 Oct 2026): the developer's Macs (the travelling primary and the M1 at home) tell each other
-- "something is waiting for you" on a PRIVATE Realtime broadcast topic of their own owner, "second:<user id>".
-- The payload is only {k: "job" | "msg" | "file" | "stat"}; jobs, notes, files and status travel as normal
-- vault records and blobs (AES-256-GCM under the vault key, change-only pulls). Nobody else can join, send
-- on or read the topic. Additive: nothing existing changes.
drop policy if exists "owner reads own second topic" on realtime.messages;
drop policy if exists "owner sends on own second topic" on realtime.messages;
create policy "owner reads own second topic" on realtime.messages
  for select to authenticated
  using (realtime.topic() = ('second:' || (select auth.uid())::text) and extension = 'broadcast' and (select public.is_vault_owner()));
create policy "owner sends on own second topic" on realtime.messages
  for insert to authenticated
  with check (realtime.topic() = ('second:' || (select auth.uid())::text) and extension = 'broadcast' and (select public.is_vault_owner()));
