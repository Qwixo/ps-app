-- PS presence (15th Oct 2026). While the PS Mac app is open and unlocked it joins the PRIVATE
-- Realtime channel "ps-presence" and tracks {app: "ps"}; the website sees that and leaves Tab
-- to PS, so two task overlays never show at once. The channel carries no task data, only
-- "PS is open", and only the vault owner can join it, send on it or see it.
create policy "owner reads ps presence" on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'ps-presence' and extension = 'presence' and (select public.is_owner()));

create policy "owner tracks ps presence" on realtime.messages
  for insert to authenticated
  with check (realtime.topic() = 'ps-presence' and extension = 'presence' and (select public.is_owner()));
