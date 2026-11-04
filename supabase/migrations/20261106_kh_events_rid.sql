-- ============================================================================================================
-- DO NOT run automatically. Review first; a maintainer runs it by hand, step by step (NOT inside one transaction).
-- ============================================================================================================
-- Idempotent anonymous reports (PR #24). The app sends every report with props.rid = random client UUID (never
-- derived from install id or time; usage events never carry it). Without this migration the app falls back to a plain
-- insert (best effort: a lost response + retry could store a report twice; moderators can dedupe by props->>'rid').
--
-- Why not a generated column: "add column ... generated always as (...) stored" rewrites the whole table under an
-- ACCESS EXCLUSIVE lock. An expression index built CONCURRENTLY does not block inserts.
-- Why an RPC: PostgREST's ?on_conflict= only accepts column names, so it cannot target an expression / partial index.
-- The insert therefore goes through public.kh_report_insert(ev jsonb) (SECURITY INVOKER: the caller's existing
-- insert-only RLS policy still applies; ON CONFLICT DO NOTHING needs no SELECT right).

-- Step 1 (may run in a transaction): remove existing duplicates, keep the oldest row per rid.
delete from public.kh_events e
 using (select id, row_number() over (partition by props->>'rid' order by id) as rn
          from public.kh_events
         where props->>'rid' is not null) d
 where e.id = d.id
   and d.rn > 1;

-- Step 2: SEPARATE statement, OUTSIDE any transaction block (CREATE INDEX CONCURRENTLY cannot run inside one).
-- If it fails it leaves an INVALID index: drop index concurrently kh_events_rid_uq; then repeat step 1 + 2.
create unique index concurrently if not exists kh_events_rid_uq
  on public.kh_events ((props->>'rid'))
  where props->>'rid' is not null;

-- Step 3: insert-if-new function used by the app (POST /rest/v1/rpc/kh_report_insert {"ev": {...}}).
create or replace function public.kh_report_insert(ev jsonb)
returns void
language sql
security invoker
set search_path = pg_catalog, public
as $$
  insert into public.kh_events (client_ts, install_id, session_id, type, lang, device, os, standalone, app_version,
                                country, city, geo_src, lat_r, lon_r, referrer, utm_source, props)
  select r.client_ts, r.install_id, r.session_id, r.type, r.lang, r.device, r.os, r.standalone, r.app_version,
         r.country, r.city, r.geo_src, r.lat_r, r.lon_r, r.referrer, r.utm_source, r.props
    from jsonb_populate_record(null::public.kh_events, ev) r
   where r.props->>'rid' is not null
  on conflict ((props->>'rid')) where props->>'rid' is not null do nothing;
$$;
revoke all on function public.kh_report_insert(jsonb) from public;
grant execute on function public.kh_report_insert(jsonb) to anon, authenticated;
