-- Signups are invite only. vault-auth (service role) writes a 2 minute allowance for the
-- exact pseudonymous login id right before it creates the account. Anything else that
-- tries to insert into auth.users is rejected. (Replaces the app_metadata check from 001,
-- which failed because GoTrue sets app_metadata after the insert.)
create table public.signup_allowances (
  email text primary key,
  expires_at timestamptz not null
);
alter table public.signup_allowances enable row level security;
revoke all on public.signup_allowances from anon, authenticated;

create or replace function public.vault_signup_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.signup_allowances where expires_at < now();
  if not exists (select 1 from public.signup_allowances where email = lower(new.email)) then
    raise exception 'Signups are invite only';
  end if;
  delete from public.signup_allowances where email = lower(new.email);
  return new;
end $$;
