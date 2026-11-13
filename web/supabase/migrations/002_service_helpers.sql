create or replace function public.vault_user_id_by_email(e text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where email = lower(e) limit 1;
$$;
revoke all on function public.vault_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.vault_user_id_by_email(text) to service_role;
