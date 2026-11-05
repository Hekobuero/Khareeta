-- DO NOT run automatically. Review first (compare with the live kh_type_ok definition: \d+ public.kh_events), then run by hand.
-- Allow the 'share_image' usage event (props: {ok, via} only — never coordinates/names/addresses) after a place/route PNG is composed (js/share-image.js).
alter table public.kh_events drop constraint if exists kh_type_ok;
alter table public.kh_events add constraint kh_type_ok check (type in ('visit','search','category','place_view','route','directions_open','nav_start','nav_arrive','reroute',
  'offline_download','lang_change','share','locate','whats_here','measure','layer','install','osm_note_sent','share_image'));
