-- The near real time Instantly reply poll (instantly-replies), every 2 minutes. With no Instantly key the function does nothing.
-- Calls your own project's functions address (kept in Vault by mail_set_project(ref), migration 031); no address, no call.
select cron.unschedule(jobid) from cron.job where jobname = 'instantly-replies';
select cron.schedule('instantly-replies', '*/2 * * * *', $job$
  select net.http_post(url := u.v || '/instantly-replies',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gmail_cron_secret')),
    body := '{"op":"poll"}'::jsonb, timeout_milliseconds := 120000)
  from (select decrypted_secret as v from vault.decrypted_secrets where name = 'ps_functions_url') u;
$job$);
