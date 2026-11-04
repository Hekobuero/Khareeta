-- DO NOT run automatically. Review first, then apply manually in the Supabase SQL editor (not part of CI).
-- Idempotent anonymous reports: delayed reports carry props.rid (a random UUID created in the browser, not derived
-- from the install id or time). This adds a generated column + unique index so the app's
--   POST /rest/v1/kh_events?on_conflict=rid   Prefer: resolution=ignore-duplicates
-- turns a retried insert (e.g. after a timeout) into a no-op instead of a second row. Rows without rid (usage events)
-- have rid NULL; NULLs never conflict. ON CONFLICT DO NOTHING only needs the existing INSERT policy.
-- Before this migration the app falls back to a plain insert (best effort; duplicates possible on lost responses,
-- moderators can dedupe by props->>'rid').
alter table public.kh_events
  add column if not exists rid text generated always as (props->>'rid') stored;
-- in case of earlier duplicate retries, keep the first row per rid before creating the unique index
delete from public.kh_events a using public.kh_events b
  where a.rid is not null and a.rid = b.rid and a.id > b.id;
create unique index if not exists kh_events_rid_uq on public.kh_events (rid);
