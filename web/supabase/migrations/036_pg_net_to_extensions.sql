-- 27 Oct 2026 (security finding P5): pg_net sat in the public schema (advisor WARN extension_in_public).
-- pg_net is not relocatable, so it is dropped and created again in extensions. Its functions always live in the
-- net schema, and the only callers are the pg_cron jobs (gmail-inbox, instantly-inbox,
-- instantly-replies and any other feed), whose commands call net.http_post by name at run time, so they need no
-- change. Nothing else uses it (checked: no other function body, trigger or webhook). The issue_pg_net_access
-- event trigger grants the net schema again on create. Lost on the way: queued requests and the response log.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
