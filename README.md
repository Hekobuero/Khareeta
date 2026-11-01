# Khareeta · خريطة

**Khareeta** ("map" in Arabic) is a free, browser-based navigation app / PWA built on
[OpenStreetMap](https://www.openstreetmap.org). It is designed to work reliably **in Syria**:
no API keys, no Google/Mapbox/HERE/Bing/Apple services, only community / FOSS services that do not
geo-block Syria, and everything the app needs is self-hosted in this repository.

Live: https://hekobuero.github.io/Khareeta/

## Features
- Vector map (MapLibre GL JS, self-hosted) with crisp high-DPI rendering, Arabic text shaping (RTL plugin, self-hosted)
- UI in **English (default)**, **Arabic (RTL)** and **German** – switch in the menu, choice is remembered
- Map labels: like app language (bilingual EN/DE + Arabic), or Arabic / English / German only
- Search with autocomplete (places, addresses, coordinates, DMS, plus codes), recent searches & saved places
- Category chips: restaurants, cafés, fuel, pharmacies, hospitals, ATMs/banks/exchange, mosques, churches, hotels,
  groceries, bakeries, attractions, parking, police, toilets
- Place sheet: Arabic/English name, category, address, opening hours with "open now / closes at" and week table,
  phone (tap to call), WhatsApp, website, e-mail, cuisine, wheelchair, payment, Wi-Fi, outdoor seating, takeaway, delivery,
  photos (Wikimedia Commons / Wikidata), Wikipedia summary, Panoramax street-level images, weather, nearby places,
  plus code + coordinates, share link, save / set home / set work, "suggest an edit" on OSM
- Directions for car / walking / cycling (+ note about public transport), alternatives, multi-stop (up to 6),
  distance/ETA, turn-by-turn list, live GPS navigation with follow camera, off-route rerouting,
  voice guidance (speechSynthesis, AR/EN/DE), simulation mode, share route URL
- "What's here?" via long-press (touch) or right-click
- My location (puck with accuracy halo + heading cone; locate button cycles off → follow → follow + heading),
  measure distance, map types (Standard, Terrain/hillshade, Dark), appearance System/Light/Dark, 3D buildings, 3D terrain
- Offline: installable PWA, service worker caches app shell + visited map tiles; download the visible area for offline use
  (≤ 3000 tiles per download, as allowed by OpenFreeMap), saved places/recents stored locally
- Low-data mode (no 3D buildings/photos/weather chip, lower pixel ratio), dark mode, Arabic-Indic digits option
- Apple-Maps-style design (`css/tokens.css`, `map-style-light/dark.json`, `sprites/`): glass search pill, category chips,
  draggable bottom sheet with peek/half/full detents (spring + velocity), place sheet with 4 actions and info group,
  directions card with segmented modes + route bubbles on the map, navigation banner with lanes, "then" tab and ETA bar.
  Satellite imagery and a transit tab are intentionally not offered (no reliable key-free imagery / no GTFS for Syria).
- Privacy-friendly usage statistics (opt-out in Settings, honours Do-Not-Track/GPC) and an admin dashboard (`admin.html`)

## Services used (all key-free)
| Purpose | Service | Why it is OK for Syria |
|---|---|---|
| Vector tiles, styles, fonts, sprites | [OpenFreeMap](https://openfreemap.org) (Hungary, via Cloudflare) | free, no key, no limits; offline downloads allowed ≤3000 tiles/50 MB, ≤4 parallel |
| Map data | © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL | OSMF, open data |
| Places (POIs) | `data/poi-syria.json` – bundled OSM extract for all of Syria (Geofabrik `syria-261031`, data 2026-10-31), ODbL | self-hosted, works offline |
| Autocomplete | [Photon](https://photon.komoot.io) by komoot | key-free public instance (fair use) |
| Search, reverse geocoding, place lookup | [Nominatim](https://nominatim.org) (OSMF) | key-free; app limits to 1 request/s, no autocomplete use (policy) |
| Routing | [FOSSGIS OSRM](https://routing.openstreetmap.de) car/bike/foot, failover [FOSSGIS Valhalla](https://valhalla1.openstreetmap.de) | German non-profit, key-free, planet-wide |
| POI details / categories / nearby | Overpass API: overpass-api.de, overpass.private.coffee, maps.mail.ru (hedged failover) + Nominatim fallback | key-free community servers |
| Photos, descriptions | Wikimedia Commons, Wikidata, Wikipedia (CC BY-SA) | Wikimedia is available in Syria |
| Street-level images | [Panoramax](https://panoramax.fr) federation API | open, key-free |
| Weather & elevation | [Open-Meteo](https://open-meteo.com) (CC BY 4.0) | key-free, non-commercial use |
| Terrain / hillshade / 3D terrain | [Mapterhorn](https://mapterhorn.com) | open terrain tiles, key-free |
| Usage statistics (optional) | [Supabase](https://supabase.com) project `ihqcgjndnjxxgeqheoei` (insert-only for visitors, RLS) | anonymous, no IP stored, no raw search text; the map works fully if it is unreachable |
| Coarse country for statistics | `tiles.openfreemap.org/cdn-cgi/trace` (Cloudflare edge, same host as the tiles) | only the 2-letter country code is kept, never the IP |

Libraries and assets (self-hosted in `vendor/`, `fonts/`, `sprites/`): MapLibre GL JS 5 (BSD-3-Clause),
mapbox-gl-rtl-text 0.3.0 (BSD-2-Clause), Material Design Icons (Apache-2.0), Maki icons in the sprites (CC0 1.0),
Inter and Noto Sans Arabic (SIL OFL 1.1), Khareeta map styles/sprites/tokens (made for this project).
Map data © OpenStreetMap contributors (ODbL); tiles © OpenFreeMap / OpenMapTiles – attribution stays visible on the map.

## Known limits vs. Google Maps
No live traffic, no user reviews/ratings, no business-provided photos, no public-transport timetables for Syria,
coverage of opening hours/phones depends on OpenStreetMap contributors (everyone can improve it via "Suggest an edit").

## Usage statistics & admin
- What is recorded (per event): random install id, session id, event type (visit, search, route, place_view, offline_download,
  lang_change, …), time, UI language, device class/OS, app version, coarse country/city, referrer **domain** and `utm_source`
  (visit only), and a location rounded to 0.1° **only** if the user already granted location. No IP address, no raw search text.
- Opt-out: Settings → "Usage statistics"; Do-Not-Track / Global-Privacy-Control are honoured. Events are queued offline
  and sent in batches; failures never block the UI.
- Setup: run `supabase.sql` in the Supabase SQL editor → create the admin user (Authentication → Users → Add user,
  "Auto Confirm") → `insert into public.kh_admins (user_id, email) select id, email from auth.users where email = 'you@example.com';`
  → optionally disable public sign-ups → open `/admin.html` and sign in.

## Development
Static site, no build step. Serve the folder with any static web server (`python3 -m http.server`).
Deep links: `?ll=lat,lon&p=n123&n=Name` (place), `?r=lat,lon;lat,lon&m=car|foot|bike` (route), `?q=text` (search), `#map=z/lat/lon`, `?debug`.

## Places (POI) data

`data/poi-syria.json` holds ~22 800 places for all of Syria (hotels, ATMs/banks/exchange, restaurants, cafés, fuel,
pharmacies, hospitals/clinics, groceries, bakeries, mosques, churches, parking, police, sights, shops, schools …),
extracted from the Geofabrik OpenStreetMap extract `syria-261031.osm.pbf` (data date 2026-10-31).
Only name (local/ar/en), category, opening hours, phone, website, stars and cuisine/brand are kept.
Licence: © OpenStreetMap contributors, ODbL 1.0 – keep the attribution. The app renders it as its own GeoJSON
source (`kh-poi`), uses it for category filters and the local search, and refreshes details live from
Nominatim/Overpass when a place is opened. To refresh: download a new extract and run the extractor
(`extract.py` + `pack.py`, pyosmium) – see the deploy notes.
