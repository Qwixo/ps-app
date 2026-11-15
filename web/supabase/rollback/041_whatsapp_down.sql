-- Rollback of 041_whatsapp.sql: removes the WhatsApp tables, functions and secrets. Messages already in your vault stay.
drop function if exists public.whatsapp_webhook_info();
drop function if exists public.whatsapp_status();
drop function if exists public.whatsapp_unlink();
drop function if exists public.whatsapp_set_config(jsonb);
drop function if exists public.whatsapp_get_config();
delete from vault.secrets where name in ('wa_access_token', 'wa_app_secret', 'wa_phone_number_id', 'wa_waba_id', 'wa_verify_token');
drop table if exists public.whatsapp_enroll;
drop table if exists public.whatsapp_state;
drop table if exists public.whatsapp_window;
drop table if exists public.whatsapp_seen;
