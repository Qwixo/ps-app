revoke all on function public.log_session() from public, anon, authenticated;
revoke all on function public.records_guard() from public, anon, authenticated;
revoke all on function public.vault_signup_gate() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
comment on table public.app_owner is 'Single owner row. No client policies on purpose: service role only.';
comment on table public.setup_codes is 'One-time owner setup code hashes. Service role only.';
comment on table public.signup_allowances is 'Short lived allowances written by vault-auth before creating an account. Service role only.';
