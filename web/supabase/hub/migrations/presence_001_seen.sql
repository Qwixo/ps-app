-- G Squad members list (PS 1.64), Supabase project zxhvchchfrkfqxuyorqo only. NOT APPLIED: the manager applies it on
-- The developer's word, BEFORE deploying the `squad` function that reads these columns.
-- Additive: four columns on squad_members, nothing else changes. The `squad` function writes them on each beat (every
-- 3 minutes while PS runs and "working" is shared) and on "away" (the member switched "working" off).
--   presence_at   when this row's presence last changed, so the others' pulls read only what changed
--   presence_ct   the member's last gym time, sealed with the squad key on their own device (the hub never sees it)
--   presence_gen  the squad key gen it is sealed under
--   presence_off  the member switched "working" off: the others see no last beat for them (last_beat itself stays,
--                 auto_join reads it to keep a second device of the same person in)
-- None of these columns is in the squad_members_heal trigger's list, so a beat never runs the heal.
alter table public.squad_members
  add column if not exists presence_at timestamptz,
  add column if not exists presence_ct text check (presence_ct is null or length(presence_ct) <= 600),
  add column if not exists presence_gen integer check (presence_gen is null or presence_gen >= 1),
  add column if not exists presence_off boolean not null default false;
create index if not exists squad_members_presence on public.squad_members(squad_id, presence_at);
-- A member who leaves keeps nothing of this.
create or replace function public.presence_clear_on_leave() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.left_at is not null and old.left_at is null then
    new.presence_ct := null; new.presence_gen := null; new.presence_at := now();
  end if;
  return new;
end $$;
drop trigger if exists squad_members_presence_leave on public.squad_members;
create trigger squad_members_presence_leave before update of left_at on public.squad_members for each row execute function public.presence_clear_on_leave();
revoke all on function public.presence_clear_on_leave() from public, anon, authenticated;
