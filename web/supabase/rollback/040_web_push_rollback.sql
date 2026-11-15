-- Undo 040_web_push.sql (and push-cron.sql if it was run).
select cron.unschedule('rem-push-every-minute') where exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'rem-push-every-minute');
drop function if exists public.push_clear(text, bigint);
drop function if exists public.push_set_schedule(text, jsonb);
drop function if exists public.push_unregister(text);
drop function if exists public.push_register(text, text, text);
drop function if exists public.push_vapid();
drop table if exists public.push_queue;
drop table if exists public.push_subs;
drop table if exists public.push_config;
