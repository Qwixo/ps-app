-- 25 Oct 2026: cut egress (free plan quota). vault_probe() lets the app ask "did anything change?" for a few
-- hundred bytes instead of re-downloading records. SECURITY INVOKER, so the caller's own RLS applies: it only
-- fingerprints rows that user may already read. Returns hashes and one timestamp, never ciphertext.
create or replace function public.vault_probe() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'r',   (select max(updated_at) from public.records),
    'rfp', (select md5(coalesce(string_agg(id::text || '|' || coalesce(updated_at::text, '') || '|' || deleted::text, ',' order by id), '')) from public.records),
    'i',   (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.inbox),
    'k',   (select md5(coalesce(string_agg(workspace_id::text || '|' || wrapped_key, ',' order by workspace_id), '')) from public.workspace_keys where user_id = (select auth.uid()))
  );
$$;
revoke all on function public.vault_probe() from public, anon;
grant execute on function public.vault_probe() to authenticated;
