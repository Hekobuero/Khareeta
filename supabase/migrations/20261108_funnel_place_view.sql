-- DO NOT run automatically. Review first, then run by hand in the Supabase SQL editor
-- (project lqanalmwztxdonrrrgqi). Safe to re-run.
--
-- Extends the optional kh_tracking() dashboard RPC so the funnel includes place_view
-- (place open / first meaningful use of a result) between search and route:
--   visit → search → place_view → route → nav_start → install
-- No new columns, no new event types (place_view is already in kh_type_ok).
-- The client already sets props.f = 1 on the first place_view of a session; this
-- migration only changes the admin funnel bars. Without it the app keeps working;
-- admin.html simply shows the older 5-step funnel until this is applied.
-- Requires 20261102_tracking.sql (or an equivalent kh_tracking) to have been applied first.

create or replace function public.kh_tracking(p_days int default 30)
returns jsonb language plpgsql stable security invoker set search_path = public as
$$
declare v_since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
        v_res jsonb;
begin
  if not public.kh_is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  with ev as (select * from public.kh_events where created_at >= v_since and session_id is not null),
  st0 as (
    select session_id,
           bool_or(type = 'visit') v, bool_or(type = 'search') s, bool_or(type = 'place_view') p,
           bool_or(type = 'route') r,
           bool_or(type = 'nav_start') n, min(coalesce(client_ts, created_at)) filter (where type = 'visit') vt,
           min(coalesce(client_ts, created_at)) filter (where type = 'install' and props->>'stage' = 'installed') it,
           coalesce(max(props->>'ch') filter (where type = 'visit'), max(props->>'ch')) ch
    from ev group by session_id),
  st as (select *, (vt is not null and it is not null and it >= vt) i from st0)
  select jsonb_build_object(
    'since', v_since,
    'funnel', (select jsonb_build_array(
        jsonb_build_object('k', 'visit', 'n', count(*) filter (where v)),
        jsonb_build_object('k', 'search', 'n', count(*) filter (where v and s)),
        jsonb_build_object('k', 'place_view', 'n', count(*) filter (where v and s and p)),
        jsonb_build_object('k', 'route', 'n', count(*) filter (where v and s and p and r)),
        jsonb_build_object('k', 'nav_start', 'n', count(*) filter (where v and s and p and r and n)),
        jsonb_build_object('k', 'install', 'n', count(*) filter (where v and i))) from st),
    'installs', (select count(distinct install_id) from ev where type = 'install' and props->>'stage' = 'installed'),
    'channel_language', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(ch, '(none)') k, count(*) filter (where v) n, count(*) filter (where s) searches,
               count(*) filter (where p) places, count(*) filter (where r) routes,
               count(*) filter (where n) navs, count(*) filter (where v and i) installs
        from st group by 1 order by 2 desc limit 30) x),
    'campaigns', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(utm_source, '?') || ' / ' || coalesce(props->>'utm_medium', '-') || ' / ' || coalesce(props->>'utm_campaign', '-') k,
               count(distinct session_id) n
        from ev where type = 'visit' and utm_source is not null group by 1 order by 2 desc limit 30) x),
    'install_stages', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(props->>'stage', 'accepted (old)') k, count(distinct install_id) n from ev where type = 'install' group by 1) x),
    'display_modes', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(props->>'dm', case when standalone then 'standalone' else 'browser' end) k, count(*) n
        from ev where type = 'visit' group by 1) x)
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.kh_tracking(int) from public, anon;
grant execute on function public.kh_tracking(int) to authenticated;
