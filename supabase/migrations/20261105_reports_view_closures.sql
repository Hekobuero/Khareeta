-- Khareeta – moderation view, now also for community road reports (props.k = 'closure').
-- DO NOT run from CI or scripts; a moderator runs it once by hand in the Supabase SQL editor (safe to re-run).
-- Replaces the view from 20261104_reports_view.sql. Anonymous reports no longer carry client_ts, lang, os, device or
-- app_version (privacy: they could link a report to the sender's usage events), so those columns are not exposed.
-- SECURITY: every text column below is user input. Escape it (public.kh_esc) before rendering it in any HTML tool.
create or replace function public.kh_esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(t,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;')
$$;
drop view if exists public.kh_reports;
create view public.kh_reports with (security_invoker = true) as
select id, created_at,
       props->>'k'  as report_kind,   -- report | closure
       props->>'t'  as report_type,   -- report: missing | wrong | link; closure: closed | delay | construction | flooding
       props->>'id' as place_id,      -- OSM id (N123/W45/R6…) or Overture id (reports only)
       props->>'src' as source,       -- osm | ov
       props->>'pn' as place_name,
       props->>'rd' as road_name,     -- closures only
       (props->>'la')::numeric as lat, (props->>'lo')::numeric as lon,
       props->>'n'  as new_name, props->>'c' as category,
       props->>'f'  as wrong_field,
       props->>'lk' as link_kind, props->>'u' as link_url,
       props->>'v'  as note           -- never published as-is
from public.kh_events
where type = 'layer' and props->>'k' in ('report', 'closure');
revoke all on public.kh_reports from anon;
grant select on public.kh_reports to authenticated;
