-- =====================================================================
-- Khareeta tracking (UTM / channel_language / funnel) – OPTIONAL, for the admin dashboard only.
-- The app works without this migration: all new data lives in the existing kh_events.props JSON
-- (props.ch = channel_language, props.f = 1 on the first funnel step of a session – install: only stage 'installed',
--  props.utm_medium/utm_campaign/utm_content/utm_term on visit + funnel events, props.stage on 'install',
--  props.dm = display mode on 'visit') and in the existing utm_source / referrer / session_id columns.
-- No new columns, no new event types (the kh_type_ok check stays as it is). Safe to re-run.
-- Run in the Supabase SQL editor (project lqanalmwztxdonrrrgqi) after supabase.sql.
-- =====================================================================

create index if not exists kh_events_ch_idx on public.kh_events ((props->>'ch'), created_at desc);
create index if not exists kh_events_session_idx on public.kh_events (session_id, type);

-- Dashboard RPC for the admin page: funnel (distinct sessions per step), channel_language, campaigns, install stages.
-- SECURITY INVOKER + kh_is_admin(): RLS applies, non-admins get an error.
create or replace function public.kh_tracking(p_days int default 30)
returns jsonb language plpgsql stable security invoker set search_path = public as
$$
declare v_since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
        v_res jsonb;
begin
  if not public.kh_is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  with ev as (select * from public.kh_events where created_at >= v_since and session_id is not null),
  -- a session counts for a step if it has that event (props.f marks the first one; older rows have no flag)
  st0 as (
    select session_id,
           -- 'search' = what the client sends as type 'search' (incl. category chips with props.kind = 'cat');
           -- an install is only the 'installed' stage (the client sends it at most once per device and session)
           bool_or(type = 'visit') v, bool_or(type = 'search') s, bool_or(type = 'route') r,
           bool_or(type = 'nav_start') n, min(coalesce(client_ts, created_at)) filter (where type = 'visit') vt,
           min(coalesce(client_ts, created_at)) filter (where type = 'install' and props->>'stage' = 'installed') it,
           coalesce(max(props->>'ch') filter (where type = 'visit'), max(props->>'ch')) ch
    from ev group by session_id),
  -- real funnel: an install only counts when the same session had a visit before it
  st as (select *, (vt is not null and it is not null and it >= vt) i from st0)
  select jsonb_build_object(
    'since', v_since,
    'funnel', (select jsonb_build_array(
        jsonb_build_object('k', 'visit', 'n', count(*) filter (where v)),
        jsonb_build_object('k', 'search', 'n', count(*) filter (where v and s)),
        jsonb_build_object('k', 'route', 'n', count(*) filter (where v and s and r)),
        jsonb_build_object('k', 'nav_start', 'n', count(*) filter (where v and s and r and n)),
        jsonb_build_object('k', 'install', 'n', count(*) filter (where v and i))) from st),
    -- installs counted once: distinct devices with an 'installed' event in the period
    'installs', (select count(distinct install_id) from ev where type = 'install' and props->>'stage' = 'installed'),
    'channel_language', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(ch, '(none)') k, count(*) filter (where v) n, count(*) filter (where s) searches,
               count(*) filter (where r) routes, count(*) filter (where n) navs, count(*) filter (where v and i) installs
        from st group by 1 order by 2 desc limit 30) x),
    'campaigns', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(utm_source, '?') || ' / ' || coalesce(props->>'utm_medium', '-') || ' / ' || coalesce(props->>'utm_campaign', '-') k,
               count(distinct session_id) n
        from ev where type = 'visit' and utm_source is not null group by 1 order by 2 desc limit 30) x),
    'install_stages', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        -- distinct devices per stage, so a repeated event never counts twice
        select coalesce(props->>'stage', 'accepted (old)') k, count(distinct install_id) n from ev where type = 'install' group by 1) x),
    'display_modes', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(props->>'dm', case when standalone then 'standalone' else 'browser' end) k, count(*) n
        from ev where type = 'visit' group by 1) x)
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.kh_tracking(int) from public, anon;
grant execute on function public.kh_tracking(int) to authenticated;
