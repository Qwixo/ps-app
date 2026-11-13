-- Sign-in log (NDA 2.4 breach detection, 4.6 access certification). Owner readable only.
create table public.access_log (
  id bigserial primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  user_agent text,
  ip text
);
create index access_log_created_idx on public.access_log(created_at desc);
alter table public.access_log enable row level security;
create policy "access log owner read" on public.access_log for select to authenticated
  using (public.is_owner());
revoke all on public.access_log from anon;

create or replace function public.log_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.access_log(user_id, created_at, user_agent, ip)
    values (new.user_id, now(), left(new.user_agent, 300), host(new.ip));
  exception when others then
    null; -- never block a login because of logging
  end;
  return new;
end $$;
create trigger vault_log_session after insert on auth.sessions
  for each row execute function public.log_session();
