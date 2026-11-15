-- 25 Oct 2026 (egress): instantly-inbox re-reads quiet threads every 30 minutes and used to seal every re-read
-- thread again, unchanged or not, so PS rewrote its records all day. content_h is a KEYED hash of the thread as it
-- would be sealed (keyed with the cron secret, so it reveals nothing); a thread is only sealed when it changes.
alter table public.instantly_threads add column if not exists content_h text;
