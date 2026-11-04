-- Khareeta – moderation view for in-app reports (optional; run once in the Supabase SQL editor, safe to re-run).
-- Reports are ordinary kh_events rows: type = 'layer', props.k = 'report' (no schema change, same insert-only RLS).
-- Reports are anonymous: no install_id/session_id/country is stored for them and none is exposed here.
-- SECURITY: every text column below is user input. Escape it before rendering it in any HTML/admin tool
-- (e.g. use public.kh_esc(text) below, or textContent in JS); never inject it as HTML or follow links unchecked.
-- security_invoker => only signed-in admins in public.kh_admins can read it; anon can still only INSERT into kh_events.
create or replace function public.kh_esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(t,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;')
$$;
drop view if exists public.kh_reports;
create view public.kh_reports with (security_invoker = true) as
select id, created_at, app_version, lang, os, device,
       props->>'t'  as report_type,   -- missing | wrong | link
       props->>'id' as place_id,      -- OSM id (N123/W45/R6…) or Overture id
       props->>'src' as source,       -- osm | ov
       props->>'pn' as place_name,
       (props->>'la')::numeric as lat, (props->>'lo')::numeric as lon,
       props->>'n'  as new_name, props->>'c' as category,
       props->>'f'  as wrong_field,
       props->>'lk' as link_kind, props->>'u' as link_url,
       props->>'v'  as note
from public.kh_events
where type = 'layer' and props->>'k' = 'report';
revoke all on public.kh_reports from anon;
grant select on public.kh_reports to authenticated;
