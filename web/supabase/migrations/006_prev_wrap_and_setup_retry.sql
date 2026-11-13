-- Previous vault-key wrap, kept only while a passphrase change is in flight.
alter table public.user_keys add column if not exists wrapped_vk_prev text;

-- Owner setup codes are consumed only once the owner's keys are actually stored,
-- so an interrupted setup can be retried with the same code.
create or replace function public.consume_setup_codes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.app_owner where user_id = new.user_id) then
    delete from public.setup_codes where code_hash is not null; -- explicit WHERE: pg_safeupdate
  end if;
  return new;
end $$;
revoke all on function public.consume_setup_codes() from public, anon, authenticated;
create trigger user_keys_consume_setup after insert on public.user_keys
  for each row execute function public.consume_setup_codes();
