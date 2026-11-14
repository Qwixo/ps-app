-- OPTIONAL, run once per project by its owner AFTER migration 040 and after deploying the rem-push function.
-- Not in migrations/ and not in ps-core.json on purpose: it needs the pg_cron and pg_net extensions, which a personal
-- project does not otherwise use (tests/ps-core.test.ts keeps them out of the core migrations). Without it nothing sends,
-- and reminders on the iPhone still show while the web app is open.
-- Fill in the two values first: your project's functions address and the public VAPID key (see web/supabase/functions/rem-push/README.txt).
create extension if not exists pg_cron;
create extension if not exists pg_net;
insert into public.push_config (id, vapid_public, functions_url)
values (1, 'PUT_THE_PUBLIC_VAPID_KEY_HERE', 'https://PUT_YOUR_PROJECT_REF_HERE.supabase.co/functions/v1')
on conflict (id) do update set vapid_public = excluded.vapid_public, functions_url = excluded.functions_url;
-- Every minute: only when something is due, ask the sender to send it (it re-checks the key and the queue itself).
select cron.schedule('rem-push-every-minute', '* * * * *', $job$
  select net.http_post(
    url := (select functions_url from public.push_config where id = 1) || '/rem-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-sender-key', (select sender_key from public.push_config where id = 1)),
    body := '{}'::jsonb)
  where exists (select 1 from public.push_queue where sent_at is null and fire_at <= now());
$job$);
