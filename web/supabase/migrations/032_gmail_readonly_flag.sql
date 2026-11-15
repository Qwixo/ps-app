-- Whether each connected Gmail login is read-only (shown in Settings). A login is not read-only
-- only when the developer chose to reuse his existing connector login because Google blocked a new
-- read-only sign-in for that account. The function only ever reads either way.
alter table public.gmail_state add column if not exists readonly boolean;

drop function if exists public.gmail_status();
create function public.gmail_status() returns table (account text, last_ok timestamptz, last_error text, readonly boolean)
language sql security definer set search_path = '' as $$
  select s.account, s.last_ok, s.last_error, s.readonly from public.gmail_state s
  where public.is_owner() order by s.account;
$$;
revoke all on function public.gmail_status() from public, anon;
grant execute on function public.gmail_status() to authenticated;
