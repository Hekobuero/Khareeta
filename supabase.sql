-- =====================================================================
-- Khareeta – privacy-first usage analytics (Supabase project lqanalmwztxdonrrrgqi)
-- Run once in the Supabase SQL editor. Safe to re-run.
--   * anon (the public app) may only INSERT events – it can never read them
--   * only signed-in admins listed in public.kh_admins may SELECT / use the dashboard
--   * no IP addresses, no raw search text, no precise coordinates are stored
-- =====================================================================

create table if not exists public.kh_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  client_ts   timestamptz,
  install_id  text not null,                -- random id generated in the browser (localStorage)
  session_id  text,
  type        text not null,
  lang        text,                          -- en | ar | de
  device      text,                          -- phone | tablet | desktop
  os          text,                          -- android | ios | windows | mac | linux | other
  standalone  boolean,                       -- installed PWA?
  app_version text,
  country     text,                          -- ISO-3166 alpha-2, coarse
  city        text,                          -- coarse city / timezone city
  geo_src     text,                          -- gps | tz | edge (Cloudflare edge country)
  lat_r       numeric(4,1),                  -- rounded to 0.1° (~11 km), only if user shared location anyway
  lon_r       numeric(4,1),
  referrer    text,                          -- referrer DOMAIN only
  utm_source  text,
  props       jsonb not null default '{}'::jsonb,
  constraint kh_type_ok check (type in ('visit','search','category','place_view','route','directions_open','nav_start','nav_arrive','reroute',
                                         'offline_download','lang_change','share','locate','whats_here','measure','layer','install','osm_note_sent')),
  constraint kh_len_ok  check (length(install_id) <= 64 and coalesce(length(session_id),0) <= 64 and coalesce(length(lang),0) <= 8
                               and coalesce(length(device),0) <= 16 and coalesce(length(os),0) <= 16 and coalesce(length(app_version),0) <= 32
                               and coalesce(length(country),0) <= 2 and coalesce(length(city),0) <= 80 and coalesce(length(geo_src),0) <= 8
                               and coalesce(length(referrer),0) <= 120 and coalesce(length(utm_source),0) <= 80),
  constraint kh_props_small check (pg_column_size(props) <= 1024),
  constraint kh_coarse check ((lat_r is null or lat_r between -90 and 90) and (lon_r is null or lon_r between -180 and 180))
);
create index if not exists kh_events_created_idx on public.kh_events (created_at desc);
create index if not exists kh_events_type_idx    on public.kh_events (type, created_at desc);
create index if not exists kh_events_install_idx on public.kh_events (install_id, created_at desc);

-- admins: Supabase Auth users that may read analytics
create table if not exists public.kh_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email   text,
  added_at timestamptz not null default now()
);

alter table public.kh_events enable row level security;
alter table public.kh_admins enable row level security;

create or replace function public.kh_is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.kh_admins where user_id = auth.uid()) $$;
revoke all on function public.kh_is_admin() from public;
grant execute on function public.kh_is_admin() to anon, authenticated;

drop policy if exists kh_events_insert_anon on public.kh_events;
create policy kh_events_insert_anon on public.kh_events
  for insert to anon, authenticated
  with check (created_at > now() - interval '5 minutes' and created_at < now() + interval '5 minutes');

drop policy if exists kh_events_select_admin on public.kh_events;
create policy kh_events_select_admin on public.kh_events
  for select to authenticated using (public.kh_is_admin());

drop policy if exists kh_admins_self on public.kh_admins;
create policy kh_admins_self on public.kh_admins
  for select to authenticated using (user_id = auth.uid());

-- table privileges: anon can only insert (not select/update/delete)
revoke all on public.kh_events from anon, authenticated;
grant insert (client_ts, install_id, session_id, type, lang, device, os, standalone, app_version, country, city, geo_src, lat_r, lon_r, referrer, utm_source, props)
  on public.kh_events to anon, authenticated;
grant select on public.kh_events to authenticated;
revoke all on public.kh_admins from anon;
grant select on public.kh_admins to authenticated;

-- ---------------------------------------------------------------------
-- Views (security_invoker => RLS of the caller applies, so only admins see rows)
-- ---------------------------------------------------------------------
create or replace view public.kh_daily with (security_invoker = true) as
select date_trunc('day', created_at)::date as day,
       count(distinct install_id) filter (where type = 'visit') as visitors,
       count(*) filter (where type = 'visit')                    as visits,
       count(distinct install_id)                                as active_users,
       count(*) filter (where type = 'search')                   as searches,
       count(*) filter (where type = 'category')                 as category_searches,
       count(*) filter (where type = 'route')                    as routes,
       count(*) filter (where type = 'nav_start')                as navigations,
       count(*) filter (where type = 'place_view')               as place_views,
       count(*) filter (where type = 'offline_download')         as offline_downloads
from public.kh_events group by 1;

create or replace view public.kh_geo_grid with (security_invoker = true) as
select lat_r, lon_r, coalesce(max(city), '') as city, max(country) as country,
       count(distinct install_id) as users, count(*) as events
from public.kh_events where lat_r is not null group by lat_r, lon_r;

-- ---------------------------------------------------------------------
-- Dashboard RPC: one call returns every aggregate the admin page needs.
-- SECURITY INVOKER: RLS applies, non-admins get empty results.
-- ---------------------------------------------------------------------
drop function if exists public.kh_dashboard(int);
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
    'geo',       (select coalesce(jsonb_agg(g), '[]') from (select lat_r, lon_r, max(city) city, count(distinct install_id) users, count(*) events from ev where lat_r is not null group by lat_r, lon_r) g)
  ) into r;
  return r;
end $$;
revoke all on function public.kh_dashboard(int) from public, anon;
grant execute on function public.kh_dashboard(int) to authenticated;

-- Optional housekeeping: delete raw events older than 400 days (run manually or via pg_cron)
-- delete from public.kh_events where created_at < now() - interval '400 days';

-- ---------------------------------------------------------------------
-- ADMIN SETUP (after running the above):
-- 1) Supabase Dashboard → Authentication → Users → "Add user" → e-mail + password, tick "Auto Confirm User".
-- 2) Then run (replace the e-mail):
--    insert into public.kh_admins (user_id, email)
--    select id, email from auth.users where email = 'YOUR-ADMIN-EMAIL@example.com'
--    on conflict (user_id) do nothing;
-- 3) Optional: Authentication → Providers → Email → disable "Allow new users to sign up",
--    so nobody else can create accounts (non-admin accounts could not read anything anyway).
-- 4) Open https://khareeta.app/admin.html and sign in.
-- ---------------------------------------------------------------------
