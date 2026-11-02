# Khareeta · خريطة

**Khareeta** ("map" in Arabic) is a free, browser-based navigation app / PWA built on
[OpenStreetMap](https://www.openstreetmap.org). It is designed to work reliably **in Syria**:
no API keys, no Google/Mapbox/HERE/Bing/Apple services, only community / FOSS services that do not
geo-block Syria, and everything the app needs is self-hosted in this repository.

Live: https://khareeta.app/ (custom domain via the root `CNAME` file; the old https://hekobuero.github.io/Khareeta/ URL redirects there)

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
- Offline: installable PWA; the service worker precaches only a small app shell, everything else (fonts, sprites, POI
  parts, icons) is cached at runtime (stale-while-revalidate, warmed after the first idle) plus visited map tiles; download the visible area for offline use
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
| Places (POIs) | `data/poi/` (split from `data/poi-syria.json`) – bundled OSM extract for all of Syria (Geofabrik `syria-261031`, data 2026-10-31), ODbL | self-hosted, works offline |
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
  lang_change, …), time, UI language, device class/OS, app version, coarse country/city, referrer **domain** (visit only), first-touch
  `utm_source` and `channel_language` (see *Tracking links* below), and a location rounded to 0.1° **only** if the user already granted location. No IP address, no raw search text.
- Opt-out: Settings → "Usage statistics"; Do-Not-Track / Global-Privacy-Control are honoured. Events are queued offline
  and sent in batches; failures never block the UI. One `visit` per browser session (sessionStorage); a batch is removed
  from the queue *before* it is sent (`fetch` with `keepalive`), so reloads, SW updates and second tabs cannot resend
  it (no duplicates). Nothing is sent from `localhost`/`127.*`/`file:` unless `localStorage['kh.trackDev']='1'` –
  tests must never write to the production project.
- Setup: run `supabase.sql` in the Supabase SQL editor → create the admin user (Authentication → Users → Add user,
  "Auto Confirm") → `insert into public.kh_admins (user_id, email) select id, email from auth.users where email = 'you@example.com';`
  → optionally disable public sign-ups → open `/admin.html` and sign in.

### Tracking links for marketing (UTM → `channel_language`)
Every event carries `props.ch` = **`<channel>_<language>`** (e.g. `facebook_ar`, `telegram_ar`, `instagram_de`,
`whatsapp_en`, `direct_ar`, `organic_de`). Attribution is **first touch per session**: the parameters of the first page
load in a tab are kept for that tab (sessionStorage) even if the user later navigates or reloads; a new tab/visit is a new session.

| Parameter | Use | Stored as |
|---|---|---|
| `utm_source` (alias `ref`, `source`) | channel – **required** for campaigns | column `utm_source` (every event, ≤ 80 chars) |
| `utm_medium` | `social`, `paid`, `group`, `story`, `email`, `qr` … | `props.utm_medium` |
| `utm_campaign` | campaign name, e.g. `launch_2026` | `props.utm_campaign` |
| `utm_content` | post/creative id **with language suffix**, e.g. `post3_ar` | `props.utm_content` |
| `utm_term` | optional keyword/audience | `props.utm_term` |
| `lang` | explicit language `ar` / `en` / `de` (overrides `utm_content`) | part of `props.ch` |
| `ch` | short form `<channel>_<lang>`, e.g. `ch=facebook_ar` – only known channels (`facebook`, `instagram`, `telegram`, `whatsapp`, `x`, `youtube`, `tiktok`, `linkedin`, `reddit`, `snapchat`, `email`, `organic`, `direct`, `referral`, `qr`, `sms`, `print`) and `ar`/`en`/`de`; anything else is ignored; an explicit `utm_source`/`ref` wins for the channel | `props.ch`; also `utm_source` if none is given |

UTM values are cut to 40 chars (`utm_source` 80). Use lowercase, `_` or `-`, no personal data in links.

**Channel** = `utm_source`/`ref` normalised, else the referrer domain, else `direct`:
`fb`, `facebook`, `m./l./lm.facebook.com`, `fb.me`, `messenger` → `facebook` · `ig`, `l.instagram.com` → `instagram` ·
`tg`, `t.me`, `web.telegram.org`, Telegram app → `telegram` · `wa`, `wa.me`, `chat.whatsapp.com` → `whatsapp` ·
`x`, `twitter`, `t.co` → `x` · also `youtube`, `tiktok`, `linkedin`, `reddit`, `snapchat`, `email` (`newsletter`, Gmail app) ·
Google/Bing/DuckDuckGo/Yandex/Yahoo/Ecosia/Qwant/Brave search → `organic` · any other website → `referral` ·
an unknown `utm_source` becomes a short slug of itself (`utm_source=Syria Forum` → `syriaforum`). Prefixes work: `fb_ads` → `facebook`.

**Language** = `lang=` → else a language code inside `utm_content`/`utm_campaign` (`ar`, `post3_ar`, `de-story`) →
else the UI language at the first page load.

| Example link | `channel_language` |
|---|---|
| `https://khareeta.app/?utm_source=facebook&utm_medium=social&utm_campaign=launch&utm_content=post1_ar` | `facebook_ar` |
| `https://khareeta.app/?utm_source=telegram&utm_medium=channel&utm_content=ar` | `telegram_ar` |
| `https://khareeta.app/?utm_source=instagram&utm_medium=story&utm_content=story_de` | `instagram_de` |
| `https://khareeta.app/?utm_source=whatsapp&utm_medium=group&lang=en` | `whatsapp_en` |
| `https://khareeta.app/?ref=tg&lang=ar` (short form) | `telegram_ar` |
| `https://khareeta.app/?ch=facebook_ar` (shortest form) | `facebook_ar` |
| `https://khareeta.app/?ch=myblog_ar` (unknown channel → ignored) | `direct_<ui language>` |
| shared plain link opened from `t.me` (no parameters) | `telegram_<ui language>` |
| typed in / bookmark / home-screen app | `direct_<ui language>` |
| found via Google | `organic_<ui language>` |

Deep links combine normally: `https://khareeta.app/?q=Aleppo&utm_source=fb&utm_content=post2_ar`.

**Funnel** `visit → search → route → nav_start → install`: the first event of each step in a session carries `props.f = 1`
(at most once per step and session). Repeated `search` / `route` / `nav_start` events are sent **on purpose** (they are the
usage counts in the dashboard); only the funnel flag is once per session. The funnel step `search` = event type `search`
(typed searches and category chips, `props.kind`); `category` events (chip filter changes) are not a funnel step.
In `kh_tracking()` a session counts for a step only if it also has the previous steps; `install` needs a `visit` earlier in the same session.
**Install**: event type `install` with `props.stage` = `available` (browser offered install, once per session),
`prompt_shown`, `accepted`, `dismissed` (stages only) and `installed` (`appinstalled`) – the one real install: sent at
most **once per device** (`localStorage kh.inst`) and once per session, even if the browser fires `appinstalled` twice;
only it can carry `f = 1`. The admin counts installs as distinct devices. `visit` also carries `props.dm` = display mode
(`browser`, `standalone`, …). Only the session id links events – no account, IP, fingerprinting or personal data.
All of this uses existing columns + `props` JSON, so **no migration is required for collecting**.
The optional `supabase/migrations/20261102_tracking.sql` adds the `kh_tracking()` RPC + indexes for the Funnel /
channel_language / Campaign / Install cards in `admin.html` (they stay hidden until it is applied).

## Development
Static site, no build step. Serve the folder with any static web server (`python3 -m http.server`).
Deep links: `?ll=lat,lon&p=n123&n=Name` (place), `?r=lat,lon;lat,lon&m=car|foot|bike` (route), `?q=text` (search), `#map=z/lat/lon`, `?debug`.
Use relative paths only – the site must also work under a sub-path (e.g. `/khareeta/`).

### Releasing: bump `VERSION`
`VERSION` (cache-busting + service-worker cache name) lives in **both** `js/util.js` and `sw.js` and must be identical.
Run this right before every release commit – it stamps the current Berlin time (`YYYYMMDD-HHMM`, Europe/Berlin):

```sh
scripts/bump-version.sh              # TZ=Europe/Berlin date +%Y%m%d-%H%M
scripts/bump-version.sh 20261102-1530   # or an explicit value
```

### SEO & sharing files
`robots.txt` (blocks `/admin.html`, points to the sitemap), `sitemap.xml`, Open Graph/Twitter tags and a JSON-LD
`WebApplication` block in `index.html`. The share image is `icons/og-image.png` (1200×630, logo A) – keep its
path stable so link previews are not re-cached. The service worker never caches robots.txt, sitemap.xml or the
OG image (and the OG image is not in the precache).

### Map attribution & OSM tile fallback
"© OpenStreetMap contributors" (linked to openstreetmap.org/copyright, localized EN/AR/DE) is always visible on the map;
the ⓘ next to it reveals the other source credits. If the vector style cannot be built, `js/app.js` falls back to the
raster tiles of `tile.openstreetmap.org`. Checked against the [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/):
correct HTTPS URL, browser User-Agent and default Referer (no restrictive Referrer-Policy), visible attribution,
caching only via the browser HTTP cache (the SW ignores these tiles) and **no** prefetch/offline download of OSM tiles
(the offline feature only uses OpenFreeMap vector tiles). Open/recommended items: the tile URL is hard-coded,
there is no "Report a map issue" link to openstreetmap.org/fixthemap and no published contact address; OSMF gives no
SLA and may block heavy use without notice – if OpenFreeMap were down for a long time, all users would land on
tile.openstreetmap.org at once.

## Places (POI) data

`data/poi-syria.json` holds ~22 800 places for all of Syria (hotels, ATMs/banks/exchange, restaurants, cafés, fuel,
pharmacies, hospitals/clinics, groceries, bakeries, mosques, churches, parking, police, sights, shops, schools …),
extracted from the Geofabrik OpenStreetMap extract `syria-261031.osm.pbf` (data date 2026-10-31).
Only name (local/ar/en), category, opening hours, phone, website, stars and cuisine/brand are kept.
Licence: © OpenStreetMap contributors, ODbL 1.0 – keep the attribution. The app renders it as its own GeoJSON
source (`kh-poi`), uses it for category filters and the local search, and refreshes details live from
Nominatim/Overpass when a place is opened. To refresh: download a new extract and run the extractor
(`extract.py` + `pack.py`, pyosmium) – see the deploy notes – and then **`python3 tools/poi/split.py`**: the app does
not load `data/poi-syria.json` itself but `data/poi/index.json` + `data/poi/p0…pN.json` (2000 places / ~150 KB each).
The parts are fetched in parallel after the first map paint and parsed one by one with yields to the main thread, so
startup stays fast on phones; they are cached by the service worker for offline search.
