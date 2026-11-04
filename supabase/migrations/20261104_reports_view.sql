-- Khareeta – moderation view for in-app reports (optional; run once in the Supabase SQL editor, safe to re-run).
-- Reports are ordinary kh_events rows: type = 'layer', props.k = 'report' (no schema change, same insert-only RLS).
-- security_invoker => only signed-in admins in public.kh_admins can read it; anon can still only INSERT into kh_events.
create or replace view public.kh_reports with (security_invoker = true) as
select id, created_at, app_version, lang, os, device, country,
       props->>'t'  as report_type,   -- missing | wrong | link
       props->>'id' as place_id,      -- OSM id (N123/W45/R6…) or Overture id
       props->>'src' as source,       -- osm | ov
       props->>'pn' as place_name,
       (props->>'la')::numeric as lat, (props->>'lo')::numeric as lon,
       props->>'n'  as new_name, props->>'c' as category,
       props->>'f'  as wrong_field,
       props->>'lk' as link_kind, props->>'u' as link_url,
       props->>'v'  as note,
       install_id
from public.kh_events
where type = 'layer' and props->>'k' = 'report';
revoke all on public.kh_reports from anon;
grant select on public.kh_reports to authenticated;
