-- Khareeta – navigation arrivals + reroutes in the admin dashboard (2026-11-04)
-- Run once in the Supabase SQL editor (project lqanalmwztxdonrrrgqi). Safe to re-run.
-- Adds key 'nav' to kh_dashboard(); every existing output key is unchanged (backward compatible).
-- Events: type 'nav_arrive' and 'reroute' in public.kh_events; props->>'sim' = 'true' marks simulated trips.
-- Distinct devices = count(distinct install_id) excluding 'anon'.

create or replace function public.kh_nav_stats(p_type text, p_sim boolean, p_since timestamptz)
returns jsonb language sql stable security invoker set search_path = public as
$$
  with e as (
    select created_at, install_id from public.kh_events
    where type = p_type and created_at >= p_since
      and (coalesce(props->>'sim', 'false') = 'true') = p_sim
  )
  select jsonb_build_object(
    'total', (select count(*) from e),
    'devices', (select count(distinct install_id) from e where install_id is not null and install_id <> 'anon'),
    'last7', (select count(*) from e where created_at >= now() - interval '7 days'),
    'devices7', (select count(distinct install_id) from e where created_at >= now() - interval '7 days' and install_id is not null and install_id <> 'anon'),
    'daily', (select coalesce(jsonb_agg(d order by d.day), '[]') from (
        select date_trunc('day', created_at)::date as day, count(*) as n,
               count(distinct install_id) filter (where install_id is not null and install_id <> 'anon') as devices
        from e group by 1) d));
$$;
revoke all on function public.kh_nav_stats(text, boolean, timestamptz) from public, anon;
grant execute on function public.kh_nav_stats(text, boolean, timestamptz) to authenticated;

create or replace function public.kh_dashboard(p_days int default 30)
returns jsonb language plpgsql stable security invoker set search_path = public as
$$
declare since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
        r jsonb;
begin
  if not public.kh_is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  with ev as (select * from public.kh_events where created_at >= since)
  select jsonb_build_object(
    'since', since,
    'totals', (select jsonb_build_object(
        'events', count(*), 'users', count(distinct install_id),
        'visits', count(*) filter (where type='visit'),
        'searches', count(*) filter (where type in ('search','category')),
        'routes', count(*) filter (where type='route'),
        'navigations', count(*) filter (where type='nav_start'),
        'place_views', count(*) filter (where type='place_view'),
        'offline_downloads', count(*) filter (where type='offline_download'),
        'installs', count(distinct install_id) filter (where standalone)) from ev),
    'dau', (select count(distinct install_id) from public.kh_events where created_at >= now() - interval '1 day'),
    'wau', (select count(distinct install_id) from public.kh_events where created_at >= now() - interval '7 days'),
    'mau', (select count(distinct install_id) from public.kh_events where created_at >= now() - interval '30 days'),
    'daily', (select coalesce(jsonb_agg(d order by d.day), '[]') from (
        select x.day, x.users, x.visits, x.searches, x.routes,
               (select count(*) from (select install_id, min(created_at) f from public.kh_events group by install_id) fs
                 where fs.f >= x.day and fs.f < x.day + 1) as new_users
        from (select date_trunc('day', created_at)::date as day,
                     count(distinct install_id) as users,
                     count(*) filter (where type='visit') as visits,
                     count(*) filter (where type in ('search','category')) as searches,
                     count(*) filter (where type='route') as routes
              from ev group by 1) x) d),
    'langs',     (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(lang,'?') k, count(distinct install_id) n from ev group by 1) x),
    'devices',   (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(device,'?') || ' · ' || coalesce(os,'?') k, count(distinct install_id) n from ev group by 1) x),
    'types',     (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select type k, count(*) n from ev group by 1) x),
    'categories',(select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select props->>'cat' k, count(*) n from ev where type in ('category','place_view') and props->>'cat' is not null group by 1 order by 2 desc limit 15) x),
    'route_modes',(select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(props->>'mode','?') k, count(*) n from ev where type='route' group by 1) x),
    'countries', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(country,'?') k, count(distinct install_id) n from ev group by 1 order by 2 desc limit 20) x),
    'cities',    (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(city,'?') || coalesce(' (' || country || ')', '') k, count(distinct install_id) n from ev where city is not null group by 1 order by 2 desc limit 20) x),
    'referrers', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(nullif(referrer,''), '(direct)') k, count(distinct install_id) n from ev where type='visit' group by 1 order by 2 desc limit 20) x),
    'utm',       (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select utm_source k, count(distinct install_id) n from ev where utm_source is not null group by 1 order by 2 desc limit 20) x),
    'versions',  (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(app_version,'?') k, count(distinct install_id) n from ev group by 1 order by 2 desc limit 10) x),
    'geo',       (select coalesce(jsonb_agg(g), '[]') from (select lat_r, lon_r, max(city) city, count(distinct install_id) users, count(*) events from ev where lat_r is not null group by lat_r, lon_r) g),
    -- navigation arrivals / reroutes (added 2026-11-04). Real vs simulated split on props.sim
    -- (js/route.js sends sim: true for the "simulate" button; events without the flag = real, i.e. pre-flag app versions).
    'nav', (select jsonb_build_object(
        'arrive', jsonb_build_object('real', public.kh_nav_stats('nav_arrive', false, since), 'sim', public.kh_nav_stats('nav_arrive', true, since)),
        'reroute', jsonb_build_object('real', public.kh_nav_stats('reroute', false, since), 'sim', public.kh_nav_stats('reroute', true, since))))
  ) into r;
  return r;
end $$;
revoke all on function public.kh_dashboard(int) from public, anon;
grant execute on function public.kh_dashboard(int) to authenticated;
