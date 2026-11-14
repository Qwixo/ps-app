-- Instantly webhook receiver (18 Oct 2026). You set up the webhook in Instantly yourself; replies then arrive the
-- moment they land (instantly-webhook), and the every-minute poll (instantly-replies) becomes the slower backup.
-- Secrets live only in Supabase Vault and are read through this service-role-only function:
--   instantly_api_key        the Instantly API key (you add it; read-only scope is enough: emails:read)
--   instantly_webhook_secret the long random secret in the webhook URL (made here, inside the database)
create or replace function public.instantly_get_config() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'api_key', (select decrypted_secret from vault.decrypted_secrets where name = 'instantly_api_key'),
    'webhook_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'instantly_webhook_secret')
  );
$$;
revoke all on function public.instantly_get_config() from public, anon, authenticated;
grant execute on function public.instantly_get_config() to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'instantly_webhook_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'instantly_webhook_secret', 'Secret path segment for the instantly-webhook receiver');
  end if;
end $$;
