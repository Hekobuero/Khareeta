// Privacy-first, anonymous usage analytics → Supabase (insert-only for the public app).
// - random install id in localStorage, no personal data, no IP stored, no raw search text
// - location only rounded to 0.1° and only if the user already shared GPS in the app
// - events are queued in localStorage and sent in batches when online; never blocks the UI
import { VERSION, lsGet, lsSet } from './util.js';
import { getLang } from './i18n.js';

const SB_URL = 'https://lqanalmwztxdonrrrgqi.supabase.co';
const SB_KEY = 'sb_publishable_d2TYqPpaVRe1IkD8TYsJ5Q_HAIYFS-b'; // public (publishable) key – RLS allows INSERT only
const QKEY = 'kh.aq', MAXQ = 300;
// Local/dev copies (localhost, 127.x, file:) never send: test runs must not land in the production table.
// A test can opt in with localStorage kh.trackDev = '1' (and then has to intercept the requests itself).
const DEV_HOST = location.protocol === 'file:' || /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname);
const OFF = (() => { try { return localStorage.getItem('kh.noTrack') === '1' || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true || (DEV_HOST && localStorage.getItem('kh.trackDev') !== '1'); } catch { return true; } })();

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
let installId = (() => { try { let v = localStorage.getItem('kh.iid'); if (!v) { v = rid(); localStorage.setItem('kh.iid', v); } return v; } catch { return 'nostorage'; } })();
// One session per tab: survives reloads and the service-worker update reload, so these do not count as new visits.
const sessionId = (() => { try { let v = sessionStorage.getItem('kh.sid'); if (!v) { v = rid().slice(0, 18); sessionStorage.setItem('kh.sid', v); } return v; } catch { return rid().slice(0, 18); } })();

function deviceInfo() {
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ios' : /windows/i.test(ua) ? 'windows' : /mac os/i.test(ua) ? 'mac' : /linux|cros/i.test(ua) ? 'linux' : 'other';
  const w = Math.min(screen.width, screen.height);
  const device = /mobi|iphone|ipod/i.test(ua) || (w < 600 && navigator.maxTouchPoints > 0) ? 'phone' : (navigator.maxTouchPoints > 0 && w < 1100 && os !== 'windows') ? 'tablet' : 'desktop';
  return { os, device, standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true };
}
const DEV = deviceInfo();

// ----- coarse origin -----
const TZ_CC = { 'Asia/Damascus': 'SY', 'Asia/Beirut': 'LB', 'Asia/Amman': 'JO', 'Asia/Baghdad': 'IQ', 'Europe/Istanbul': 'TR', 'Asia/Riyadh': 'SA', 'Asia/Dubai': 'AE', 'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW', 'Africa/Cairo': 'EG', 'Asia/Jerusalem': 'IL', 'Asia/Gaza': 'PS', 'Asia/Hebron': 'PS', 'Europe/Berlin': 'DE', 'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH', 'Europe/Stockholm': 'SE', 'Europe/Amsterdam': 'NL', 'Europe/Copenhagen': 'DK', 'Europe/Oslo': 'NO', 'Europe/London': 'GB', 'Europe/Paris': 'FR', 'Europe/Brussels': 'BE', 'America/New_York': 'US', 'America/Chicago': 'US', 'America/Los_Angeles': 'US', 'America/Toronto': 'CA', 'Asia/Tehran': 'IR', 'Asia/Muscat': 'OM', 'Asia/Bahrain': 'BH', 'Asia/Yerevan': 'AM', 'Europe/Athens': 'GR', 'Asia/Nicosia': 'CY', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT' };
function tzGeo() {
  let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
  const region = (navigator.language || '').split('-')[1];
  const cc = TZ_CC[tz] || (region && region.length === 2 ? region.toUpperCase() : null);
  const city = tz.includes('/') ? tz.split('/').pop().replace(/_/g, ' ') : null;
  return { country: cc, city, geo_src: 'tz' };
}
let geo = lsGet('kh.ageo', null);
if (!geo || Date.now() - (geo.t || 0) > 7 * 864e5) { geo = { ...tzGeo(), t: Date.now() }; lsSet('kh.ageo', geo); }
async function edgeCountry() {
  // Cloudflare edge country of the tile host we already use (OpenFreeMap) – only the 2-letter code is kept
  if (geo.geo_src === 'gps' || geo.edge) return;
  try {
    const r = await fetch('https://tiles.openfreemap.org/cdn-cgi/trace', { cache: 'no-store' });
    const m = (await r.text()).match(/^loc=([A-Z]{2})$/m);
    if (m && m[1] !== 'XX') { if (geo.country !== m[1]) { geo.country = m[1]; geo.city = null; geo.geo_src = 'edge'; } geo.edge = 1; lsSet('kh.ageo', geo); }
  } catch {}
}
async function gpsGeo(lat, lon) {
  if (geo.geo_src === 'gps' && Math.abs(geo.lat_r - lat) < 0.15 && Math.abs(geo.lon_r - lon) < 0.15) return;
  const lat_r = Math.round(lat * 10) / 10, lon_r = Math.round(lon * 10) / 10;
  geo = { ...geo, lat_r, lon_r, geo_src: 'gps', t: Date.now() };
  try { // city-level reverse geocode of the ROUNDED point only
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat_r}&lon=${lon_r}&zoom=10&format=jsonv2&accept-language=en`);
    const j = await r.json(); const a = j.address || {};
    geo.city = (a.city || a.town || a.county || a.state || '').slice(0, 80) || null;
    geo.country = (a.country_code || '').toUpperCase() || geo.country;
  } catch {}
  lsSet('kh.ageo', geo);
}

// ----- attribution: UTM + referrer, first touch per session (sessionStorage, survives reloads in this tab) -----
// channel_language = "<channel>_<lang>", e.g. facebook_ar, telegram_ar, instagram_de, whatsapp_en, direct_en, organic_ar.
// channel: utm_source (or ?ref=) normalised, else the referrer domain, else "direct". lang: ?lang= or a language code
// in utm_content (ar, post3_ar, de-story …), else the active UI language when the visit starts. See README "Tracking".
const CH_ALIAS = [
  ['facebook', /^(fb|facebook|meta|fb\.(com|me)|([a-z]+\.)?facebook\.com|com\.facebook\.(katana|lite|orca)|messenger(\.com)?)$/],
  ['instagram', /^(ig|insta|instagram|([a-z]+\.)?instagram\.com|com\.instagram\.android)$/],
  ['telegram', /^(tg|telegram|t\.me|telegram\.(me|org|dog)|web\.telegram\.org|org\.telegram\.messenger(\.web)?|org\.thunderdog\.challegram)$/],
  ['whatsapp', /^(wa|whatsapp|wa\.me|(api|web|chat)\.whatsapp\.com|whatsapp\.com|com\.whatsapp(\.w4b)?)$/],
  ['x', /^(x|twitter|tw|t\.co|x\.com|(mobile\.)?twitter\.com|com\.twitter\.android)$/],
  ['youtube', /^(yt|youtube|youtu\.be|([a-z]+\.)?youtube\.com|com\.google\.android\.youtube)$/],
  ['tiktok', /^(tiktok|tt|([a-z]+\.)?tiktok\.com|com\.zhiliaoapp\.musically)$/],
  ['linkedin', /^(linkedin|li|lnkd\.in|([a-z]+\.)?linkedin\.com|com\.linkedin\.android)$/],
  ['reddit', /^(reddit|([a-z]+\.)?reddit\.com)$/],
  ['snapchat', /^(snapchat|snap|([a-z]+\.)?snapchat\.com)$/],
  ['email', /^(email|e-mail|mail|newsletter|com\.google\.android\.gm|mail\.google\.com|outlook\.(live|office)\.com)$/],
  ['organic', /^(organic|seo|(www\.)?google(\.[a-z]+)+|com\.google\.android\.googlequicksearchbox|([a-z]+\.)?bing\.com|duckduckgo\.com|([a-z]+\.)?yandex\.[a-z]+|([a-z]+\.)?yahoo\.com|(www\.)?ecosia\.org|(www\.)?qwant\.com|(www\.)?baidu\.com|search\.brave\.com|(www\.)?startpage\.com)$/],
];
const LANGS = ['ar', 'en', 'de'];
const clip = (v, n = 40) => { v = (v || '').trim(); return v ? v.slice(0, n) : null; };
export function normChannel(v) {
  v = (v || '').trim().toLowerCase().replace(/^android-app:\/\//, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!v) return null;
  for (const t of [v, v.split(/[_\-\s+]/)[0]]) for (const [k, re] of CH_ALIAS) if (re.test(t)) return k; // fb, fb_ads, facebook-group …
  return null;
}
export function langHint(...vals) {
  for (const v of vals) { const m = (v || '').toLowerCase().match(/(?:^|[^a-z])(ar|en|de)(?:$|[^a-z])/); if (m) return m[1]; }
  return null;
}
// channel from utm_source/ref first, then the referrer; unknown sources become a short slug, unknown referrers "referral"
export function deriveChannel(src, refHost) {
  if (src) return normChannel(src) || (src.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'other');
  if (refHost) return normChannel(refHost) || 'referral';
  return 'direct';
}
const CH_KNOWN = new Set([...CH_ALIAS.map(([k]) => k), 'direct', 'referral', 'qr', 'sms', 'print']);
export function parseCh(v) {
  const m = String(v || '').trim().toLowerCase().match(/^([a-z]{1,20})[_-](ar|en|de)$/);
  return m && CH_KNOWN.has(m[1]) ? { ch: m[1], l: m[2] } : null;
}
// Pure parse of a landing URL (+ optional referrer host and UI language). Used by attribution() and by unit tests.
// click-ids (fbclid/gclid/…) are NOT stored – they stay out of analytics; report-core still strips them from shared links.
export function buildAttribution({ search = '', referrer = '', lang = 'en' } = {}) {
  const sp = search instanceof URLSearchParams ? search : new URLSearchParams(String(search || '').replace(/^\?/, ''));
  let refHost = null;
  try {
    const refRaw = referrer || '';
    if (refRaw) {
      const u = new URL(refRaw);
      const h = u.protocol === 'android-app:' ? u.host || refRaw.slice(14).split('/')[0] : u.hostname;
      if (h) refHost = h.replace(/^www\./, '').slice(0, 120);
    }
  } catch {}
  const a = {
    utm_source: clip(sp.get('utm_source') || sp.get('ref') || sp.get('source'), 80),
    utm_medium: clip(sp.get('utm_medium')), utm_campaign: clip(sp.get('utm_campaign')),
    utm_content: clip(sp.get('utm_content')), utm_term: clip(sp.get('utm_term')),
    referrer: refHost,
  };
  // ?ch=<channel>_<lang> (e.g. ch=facebook_ar) – only known channels and languages, anything else is ignored;
  // an explicit utm_source/ref wins for the channel, the language of ch still applies
  const cp = parseCh(sp.get('ch'));
  if (cp && !a.utm_source) a.utm_source = cp.ch;
  const ch = deriveChannel(a.utm_source, refHost);
  const pl = (sp.get('lang') || '').toLowerCase().slice(0, 2);
  const l = (cp && cp.l) || (LANGS.includes(pl) && pl) || langHint(a.utm_content, a.utm_campaign) || (LANGS.includes(lang) ? lang : 'en');
  a.ch = ch; a.chl = `${ch}_${l}`;
  return a;
}
// First-touch per session: compute once from the landing URL, then reuse sessionStorage across reloads in this tab.
export function attribution() {
  try { const a = JSON.parse(sessionStorage.getItem('kh.att') || 'null'); if (a && a.chl) return a; } catch {}
  let ref = '';
  try { ref = document.referrer || ''; } catch {}
  // drop same-origin referrer so it does not become a fake "referral" channel
  try { if (ref) { const u = new URL(ref); if (u.hostname.replace(/^www\./, '') === location.hostname.replace(/^www\./, '')) ref = ''; } } catch {}
  const a = buildAttribution({ search: location.search || '', referrer: ref, lang: getLang() });
  try { sessionStorage.setItem('kh.att', JSON.stringify(a)); } catch {}
  return a;
}
attribution(); // warm first-touch as soon as the module loads (same as before)
const UTM_KEYS = ['utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
// Funnel visit → search → place_view → route → nav_start → install.
// place_view = place open / first meaningful use of a result (already fired from js/place.js; no new event type).
// map_ready is NOT a separate type: a new every-session type would 400-drop whole batches until a kh_type_ok migration is applied.
const FUNNEL = new Set(['visit', 'search', 'place_view', 'route', 'nav_start', 'install']);
function funnelFirst(type, pr) {
  if (!FUNNEL.has(type)) return false;
  if (type === 'install' && pr.stage !== 'installed') return false; // 'accepted' is only a stage, not an install
  try { const f = JSON.parse(sessionStorage.getItem('kh.fun') || '[]'); if (f.includes(type)) return false; f.push(type); sessionStorage.setItem('kh.fun', JSON.stringify(f)); return true; } catch { return false; }
}
// Install events (all as type 'install' – the table's type check already allows it; props.stage tells them apart)
const onceSession = k => { try { if (sessionStorage.getItem(k)) return false; sessionStorage.setItem(k, '1'); return true; } catch { return true; } };
const onceDevice = k => { try { if (localStorage.getItem(k)) return false; localStorage.setItem(k, String(Date.now())); return true; } catch { return true; } };
// Exported so unit tests can fire the same handlers Node's stub addEventListener would otherwise swallow.
export function onBeforeInstallPrompt() { if (onceSession('kh.bip')) track('install', { stage: 'available' }); }
// 'installed' = the real install: at most one per device (localStorage) and per session, even if the browser fires
// appinstalled twice (seen in Chrome). Only this event can carry the funnel flag f = 1.
export function onAppInstalled() { if (onceSession('kh.inst') && onceDevice('kh.inst')) track('install', { stage: 'installed' }); }
addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
addEventListener('appinstalled', onAppInstalled);
const displayMode = () => ['standalone', 'fullscreen', 'minimal-ui'].find(m => matchMedia(`(display-mode: ${m})`).matches) || (navigator.standalone === true ? 'standalone' : 'browser');

// ----- queue -----
let q = lsGet(QKEY, []);
const ALLOWED = new Set(['visit', 'search', 'category', 'place_view', 'route', 'directions_open', 'nav_start', 'nav_arrive', 'reroute', 'offline_download', 'lang_change', 'share', 'locate', 'whats_here', 'measure', 'layer', 'install', 'osm_note_sent', 'share_image', 'map_export']);
// Reports must not be linkable to normal usage events, neither by client time nor by the server's insert time:
//  - EVERY usage event (visit included) is held back HOLD_MS before it is queued, keeping its original timestamp;
//  - a "report mark" is stored (localStorage, shared by tabs) when a report form opens and when a report is actually
//    sent; any held/queued event whose time is within ±QUIET_MS of a mark is dropped, and no event is recorded while
//    a report form is open or for QUIET_MS after it closed / a report was sent (quietUntil, also in localStorage);
//  - hiding the page only releases events that are already older than HOLD_MS; younger ones are persisted
//    (kh.held) and re-checked on the next load;
//  - the anonymous report itself is not sent right away but after a random 2–10 min delay (kh.rq, survives closing
//    the page; then sent on the next load), so its server created_at does not line up with the moment of reporting.
export const POINT_TYPES = new Set(['place_view', 'whats_here', 'share', 'directions_open', 'route', 'measure']); // kept for callers; all types are held now
export const HOLD_MS = 60e3, QUIET_MS = 60e3, REPORT_DELAY_MS = [2 * 60e3, 10 * 60e3];
const FKEY = 'kh.lflush', HKEY = 'kh.held', MKEY = 'kh.rmark', QUKEY = 'kh.quiet', RQKEY = 'kh.rq', OPEN_MS = 6 * 36e5;
let held = [];
const quietUntil = () => +lsGet(QUKEY, 0) || 0;
const marks = (now = Date.now()) => lsGet(MKEY, []).filter(m => m > now - 864e5);
const nearReport = ts => marks().some(m => Math.abs(ts - m) <= QUIET_MS);
const blocked = (ts, now = Date.now()) => now < quietUntil() || nearReport(ts);
function mark(now) { lsSet(MKEY, [...marks(now), now].slice(-30)); }
function dropAround(now) {
  for (const h of held) clearTimeout(h.tm); held = [];
  try { lsSet(HKEY, lsGet(HKEY, []).filter(x => Math.abs(x.ts - now) > QUIET_MS)); } catch {}
  try { q = lsGet(QKEY, q).filter(ev => !(Date.parse(ev.client_ts) > now - QUIET_MS)); lsSet(QKEY, q); } catch {}
}
/** A report form opens (ms = Infinity until reportQuietOff) or a report is sent (ms = QUIET_MS). ms = 0: no-op mark. */
export function reportQuiet(ms = QUIET_MS, now = Date.now()) {
  if (!(ms > 0)) return;
  mark(now); dropAround(now);
  lsSet(QUKEY, Math.max(quietUntil(), now + Math.min(ms, OPEN_MS)));
  reschedule();
}
export const reportQuietOff = (now = Date.now()) => { mark(now); dropAround(now); lsSet(QUKEY, Math.min(quietUntil(), now + QUIET_MS)); reschedule(); };
export const _heldCount = () => held.length;
export const _held = () => held.map(h => h.type + '@' + h.ts);
export const _queue = () => q.slice();
export function _resetPrivacy() { for (const h of held) clearTimeout(h.tm); held = []; clearTimeout(rtm); rtm = null; clearTimeout(timer); timer = null; timerAt = 0; rsending = false; sending = false; q = []; for (const k of [HKEY, MKEY, QUKEY, RQKEY, FKEY, QKEY]) try { localStorage.removeItem(k); } catch {} }
function hold(x, now = Date.now()) {
  const h = { ...x, tm: null };
  held.push(h);
  h.tm = setTimeout(() => { held = held.filter(y => y !== h); unpersist(h.id); if (!blocked(h.ts)) enqueue(h.type, h.props, h.ts, h.sid); }, Math.max(0, x.ts + HOLD_MS - now));
}
const unpersist = id => { try { const l = lsGet(HKEY, []); if (l.some(x => x.id === id)) lsSet(HKEY, l.filter(x => x.id !== id)); } catch {} };
// page hidden / closed: only events already older than HOLD_MS may go out now; younger ones are persisted
export function _onHide(now = Date.now()) {
  const keep = [];
  for (const h of held) {
    if (h.ts <= now - HOLD_MS) { clearTimeout(h.tm); unpersist(h.id); if (!blocked(h.ts, now)) enqueue(h.type, h.props, h.ts, h.sid); }
    else keep.push(h);
  }
  held = keep;
  const l = lsGet(HKEY, []), ids = new Set(l.map(x => x.id));
  lsSet(HKEY, [...l, ...keep.filter(h => !ids.has(h.id)).map(({ tm, ...x }) => x)].slice(-200));
}
// next load (or the page is shown again): re-check persisted events – drop near a report, queue old ones, hold the rest
export function _adoptHeld(now = Date.now()) {
  const l = lsGet(HKEY, []); lsSet(HKEY, []);
  const mine = new Set(held.map(h => h.id));
  for (const x of l) {
    if (mine.has(x.id)) continue;
    if (blocked(x.ts, now) || x.ts < now - 864e5) continue;
    if (x.ts <= now - HOLD_MS) enqueue(x.type, x.props, x.ts, x.sid); else hold(x, now);
  }
}
export function track(type, props = {}) {
  if (OFF || !ALLOWED.has(type)) return false;
  const now = Date.now();
  if (blocked(now, now)) return false;
  if (type === 'visit') { try { if (sessionStorage.getItem('kh.visitH') === sessionId) return false; sessionStorage.setItem('kh.visitH', sessionId); } catch {} }
  hold({ id: rid(), type, props, ts: now, sid: sessionId }, now); return true;
}
function enqueue(type, props, ts = Date.now(), sid = sessionId) {
  if (type === 'visit') { try { if (sessionStorage.getItem('kh.visit') === sid) return; if (sid === sessionId) sessionStorage.setItem('kh.visit', sid); } catch {} }
  try {
    const pr = { ...props }; delete pr.rid; // rid (idempotency key) is for reports only, never on usage events
    if (type === 'locate' && pr.lat != null) { gpsGeo(pr.lat, pr.lon); delete pr.lat; delete pr.lon; }
    for (const k in pr) if (pr[k] == null || (typeof pr[k] === 'string' && pr[k].length > 40)) delete pr[k];
    const att = attribution(); // first-touch from sessionStorage (or freshly computed)
    pr.ch = att.chl; // channel_language on every event (props JSON: works without new columns)
    if (funnelFirst(type, pr)) pr.f = 1;
    if (type === 'visit' || pr.f) { for (const k of UTM_KEYS) if (att[k]) pr[k] = att[k]; }
    if (type === 'visit') pr.dm = displayMode();
    const ev = {
      client_ts: new Date(ts).toISOString(), install_id: installId, session_id: sid, type, lang: getLang(),
      device: DEV.device, os: DEV.os, standalone: DEV.standalone, app_version: VERSION,
      country: geo.country || null, city: geo.city || null, geo_src: geo.geo_src || null,
      lat_r: geo.geo_src === 'gps' ? geo.lat_r : null, lon_r: geo.geo_src === 'gps' ? geo.lon_r : null,
      referrer: type === 'visit' ? att.referrer : null, utm_source: att.utm_source, props: pr,
    };
    q.push(ev); if (q.length > MAXQ) q = q.slice(-MAXQ);
    lsSet(QKEY, q); schedule();
    return true; // queued for sending (delivery happens later in flush())
  } catch { return false; }
}
// Explicit user submission (in-app report): sent right away, NOT queued, so the UI can say "sent" only after Supabase
// accepted the row (HTTP 2xx). Same table, same publishable insert-only key and same event shape as track().
// Reports are anonymous: they NEVER carry the install id, session id or any geo (country/city), whether or not usage
// analytics is on. Local/dev copies never send (tests intercept fetch themselves with kh.trackDev = 1).
export const REPORT_DEV_BLOCKED = () => { try { return DEV_HOST && localStorage.getItem('kh.trackDev') !== '1'; } catch { return true; } };
// Idempotency: a delayed report carries props.rid (random UUID, unrelated to install id / time; usage events never
// carry one). With the migration 20261106_kh_events_rid (unique expression index on props->>'rid' + RPC
// kh_report_insert, insert … on conflict do nothing) a retry after a timeout cannot create a second row. PostgREST's
// on_conflict cannot target an expression index, hence the RPC. Without the migration the RPC answers 404 PGRST202
// (function not found); only that specific error falls back to one plain insert (best effort), remembered in kh.noRid.
const NORID = 'kh.noRid';
export async function sendNow(type, props, { fetchImpl = globalThis.fetch, timeout = 12000 } = {}) {
  if (!ALLOWED.has(type)) return { ok: false, why: 'type' };
  if (REPORT_DEV_BLOCKED()) return { ok: false, why: 'dev' };
  if (navigator.onLine === false) return { ok: false, why: 'offline' };
  const ev = {
    // no client_ts / lang / device / os / app_version: they would let a report be matched to the sender's usage
    // events by time and fingerprint (the server's created_at is enough for moderation)
    client_ts: null, install_id: 'anon', session_id: null, type, lang: null,
    device: null, os: null, standalone: null, app_version: null,
    country: null, city: null, geo_src: null, lat_r: null, lon_r: null,
    referrer: null, utm_source: null, props: { ...props },
  };
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const tm = ac && setTimeout(() => ac.abort(), timeout);
  try {
    const idem = !!props?.rid && lsGet(NORID, 0) < Date.now() - 864e5;
    const hdr = { apikey: SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, sig = ac?.signal;
    const post = up => up
      ? fetchImpl(SB_URL + '/rest/v1/rpc/kh_report_insert', { method: 'POST', headers: hdr, body: JSON.stringify({ ev }), signal: sig })
      : fetchImpl(SB_URL + '/rest/v1/kh_events', { method: 'POST', headers: hdr, body: JSON.stringify([ev]), signal: sig });
    let r = await post(idem);
    if (idem && (r.status === 404 || r.status === 400)) {
      let txt = ''; try { txt = await r.text(); } catch {}
      // only "migration missing": function not found (PGRST202) / unknown function or column (42883, 42703, PGRST204)
      if (/"code"\s*:\s*"(PGRST202|42883|42703|PGRST204|42P10)"/.test(txt)) { lsSet(NORID, Date.now()); r = await post(false); }
    }
    try { r.text().catch(() => {}); } catch {}
    return r.ok ? { ok: true } : { ok: false, why: 'http', status: r.status };
  } catch { return { ok: false, why: 'network' }; }
  finally { if (tm) clearTimeout(tm); }
}
// Delayed anonymous report delivery (see above). The UI may say "sent" once the report is stored for delivery.
let rtm = null, rsending = false;
export function submitReport(type, props, { now = Date.now(), rand = Math.random } = {}) {
  if (!ALLOWED.has(type)) return { ok: false, why: 'type' };
  if (REPORT_DEV_BLOCKED()) return { ok: false, why: 'dev' };
  const [lo, hi] = REPORT_DELAY_MS;
  const it = { id: rid(), type, props: { ...props, rid: crypto.randomUUID ? crypto.randomUUID() : rid() }, due: Math.round(now + lo + rand() * (hi - lo)), tries: 0, exp: now + 7 * 864e5 };
  try { localStorage.setItem(RQKEY, JSON.stringify([...lsGet(RQKEY, []), it].slice(-20))); } catch { return { ok: false, why: 'storage' }; }
  scheduleReports(); return { ok: true, queued: true, due: it.due };
}
export const _pendingReports = () => lsGet(RQKEY, []);
// ms to wait before the next usage flush attempt if a pending report is due within QUIET_MS (0 = no report pending)
function reportDueSoon(now = Date.now()) {
  if (navigator.onLine === false) return 0;
  const l = lsGet(RQKEY, []).filter(x => x.exp > now); if (!l.length) return 0;
  const due = Math.min(...l.map(x => x.due));
  return due - QUIET_MS <= now ? Math.max(5e3, due - now + QUIET_MS + 2e3) : 0;
}
function scheduleReports(now = Date.now()) {
  clearTimeout(rtm); const l = lsGet(RQKEY, []); if (!l.length) return;
  rtm = setTimeout(() => sendDueReports(), Math.max(0, Math.min(...l.map(x => x.due)) - now));
}
// Cross-tab exclusivity: the Web Locks API (navigator.locks, atomic across tabs of the origin) – a tab that does not get
// the lock right away skips; the holder sends. Fallback without Web Locks: claim with a random token in localStorage,
// wait a random 30–150 ms and only send the entries that still carry OUR token (last writer wins, the others back off).
// P3 dedupe: localStorage is only eventually consistent between tab processes, so the token check alone could let two
// tabs send the same report. The fallback therefore also (a) takes a timestamped lock key (kh.rq.lock, stale after 30 s)
// and skips while another tab's fresh lock is present, (b) announces its claim on a BroadcastChannel – on overlapping
// claims the smaller token wins deterministically, the other backs off – and (c) waits 250–450 ms for both to settle.
const LOCK = 'kh-report-send', LKEY = 'kh.rq.lock', LOCK_TTL = 30e3;
let bc = null, bcClaims = new Map(); // tok -> { ids, t } claims announced by other tabs
function chan() {
  if (bc || typeof BroadcastChannel !== 'function') return bc;
  try { bc = new BroadcastChannel('kh-report'); bc.unref?.(); // Node (tests): never keep the process alive
  bc.onmessage = e => { const m = e.data || {}; if (m.tok && Array.isArray(m.ids)) bcClaims.set(m.tok, { ids: m.ids, t: Date.now() }); }; } catch { bc = null; }
  return bc;
}
export function _resetReportLock() { bcClaims = new Map(); try { bc?.close(); } catch {} bc = null; }
export async function sendDueReports(opts = {}) {
  if (rsending) return 0;
  const lk = globalThis.navigator?.locks;
  if (lk && typeof lk.request === 'function') return lk.request(LOCK, { ifAvailable: true }, l => l ? sendDueLocked(opts, true) : 0);
  return sendDueLocked(opts, false);
}
// HTTP status / PostgREST error that will not succeed on retry (constraint, bad input, permission …): drop the report
const retryable = r => r.why === 'network' || r.why === 'offline' || (r.why === 'http' && (r.status >= 500 || r.status === 429 || r.status === 408));
async function sendDueLocked({ fetchImpl = globalThis.fetch } = {}, locked) {
  if (rsending) return 0;
  const now = Date.now(), l = lsGet(RQKEY, []).filter(x => x.exp > now);
  // claimed by a tab that is sending right now (or died while sending: retried after 2 min, rid keeps it idempotent)
  const due = l.filter(x => x.due <= now && !(x.claim > now - 120e3));
  if (!due.length) { scheduleReports(now); return 0; }
  if (navigator.onLine === false) return 0; // the 'online' event calls us again
  // usage flushes are paused from QUIET_MS before a due report, so this wait is only needed if a batch slipped out
  // just before (other tab / in flight): at most ~61 s, then the report goes first
  const lf = +lsGet(FKEY, 0) || 0;
  if (now - lf < QUIET_MS || sending) { clearTimeout(rtm); rtm = setTimeout(() => sendDueReports({ fetchImpl }), Math.max(1000, lf + QUIET_MS - now + 1000)); return 0; }
  const ids = new Set(due.map(x => x.id)), tok = rid();
  if (!locked) {
    const lkv = lsGet(LKEY, null);
    if (lkv && lkv.tok && lkv.t > now - LOCK_TTL) { clearTimeout(rtm); rtm = setTimeout(() => sendDueReports({ fetchImpl }), Math.max(1000, lkv.t + LOCK_TTL - now + 500)); return 0; }
    lsSet(LKEY, { tok, t: now });
  }
  rsending = true;
  lsSet(RQKEY, l.map(x => ids.has(x.id) ? { ...x, claim: now, ct: tok } : x));
  let mine = due;
  if (!locked) {
    const ch = chan(); try { ch?.postMessage({ tok, ids: [...ids] }); } catch {}
    await new Promise(r => setTimeout(r, wait()));
    const cur = new Map(lsGet(RQKEY, []).map(x => [x.id, x])), lk2 = lsGet(LKEY, null);
    // another tab's overlapping claim with a smaller token wins (both tabs see both messages → exactly one sends)
    const lost = new Set(); for (const [ot, c] of bcClaims) if (ot !== tok && ot < tok && Date.now() - c.t < 5e3) c.ids.forEach(i => lost.add(i));
    mine = lk2?.tok && lk2.tok !== tok ? [] : due.filter(x => cur.get(x.id)?.ct === tok && !lost.has(x.id));
    if (!mine.length) { rsending = false; if (lk2?.tok === tok) lsSet(LKEY, null); scheduleReports(); return 0; }
  }
  let sent = 0;
  for (const it of mine) {
    reportQuiet(QUIET_MS); // server insert time ≈ now: drop/suppress usage events ±60 s around it
    const r = await sendNow(it.type, it.props, { fetchImpl });
    reportQuiet(QUIET_MS);
    const rest = lsGet(RQKEY, []).filter(x => x.id !== it.id); // success: the stored report is deleted right away
    if (r.ok) sent++;
    else if (retryable(r)) rest.push({ ...it, claim: 0, ct: null, tries: it.tries + 1, due: Date.now() + (r.why === 'offline' ? 0 : Math.min(36e5, 60e3 * 2 ** it.tries) * (1 + Math.random())) });
    lsSet(RQKEY, rest);
  }
  if (!locked && lsGet(LKEY, null)?.tok === tok) lsSet(LKEY, null);
  rsending = false; scheduleReports(); reschedule(); return sent;
}
const wait = () => 120 + Math.random() * 70; // < 200 ms; BroadcastChannel claims arrive within a few ms
let timer = null, sending = false, leaving = false;
// The single place that sets the usage flush timer: always clears it and recomputes the next attempt from the current
// state (quiet period end, pending report due dates). Called on every state change (quiet on/off, report sent,
// visibility, online), so a stale long timer can never stall delivery. min = earliest delay wanted by the caller.
let timerAt = 0;
function reschedule(min = 0, now = Date.now()) {
  clearTimeout(timer); timer = null; timerAt = 0;
  if (OFF || !lsGet(QKEY, q).length) return;
  let at = now + min;
  const qu = quietUntil();
  if (qu - now > 10 * QUIET_MS) return; // a report form is open: reportQuietOff() reschedules
  if (qu > at) at = qu + 1000;
  for (let i = 0; i < 3; i++) { const rd = reportDueSoon(at); if (!rd) break; at += rd; } // report has priority
  timerAt = at; timer = setTimeout(() => { timer = null; timerAt = 0; flush(); }, Math.max(0, at - now));
}
// new event: start the timer if none is running (a running one is always up to date, see reschedule)
function schedule(ms = 8000) { if (!timer) reschedule(ms); }
// Delivery is at-most-once: a batch is removed from the stored queue BEFORE it is sent (so a reload, the SW update
// reload or a second tab can never send it again) and only put back when the request demonstrably failed.
// Every request uses keepalive, so it is not cancelled when the page unloads (keepalive bodies are capped at 64 KB).
export async function flush({ hide = false } = {}) {
  if (sending || !navigator.onLine) return;
  q = lsGet(QKEY, q);
  if (!q.length) return;
  // no usage batch reaches the server while a report form is open or within QUIET_MS of a report insert
  // a report is due within QUIET_MS (or overdue): it has priority – usage batches wait (held, not dropped) until it went out
  if (reportDueSoon() || Date.now() < quietUntil()) { reschedule(); return; }
  sending = true; lsSet(FKEY, Date.now());
  // visible: one batch per attempt; hiding: every eligible batch at once (keepalive in-flight budget ≈ 64 KB in total,
  // so at most ~60 KB are fired; anything beyond stays queued for the next visit)
  const batches = []; let total = 0, i = 0;
  while (i < q.length) {
    const batch = []; let bytes = 2;
    for (; i < q.length; i++) { const n = JSON.stringify(q[i]).length + 1; if (batch.length >= 50 || (batch.length && bytes + n > 48000)) break; batch.push(q[i]); bytes += n; }
    if (batches.length && total + bytes > 60000) { i -= batch.length; break; }
    batches.push(batch); total += bytes;
    if (!hide || total > 60000) break;
  }
  q = q.slice(i); lsSet(QKEY, q);
  const keeps = await Promise.all(batches.map(b => post1(b)));
  const back = batches.filter((b, k) => keeps[k]).flat();
  if (back.length) { q = [...back, ...lsGet(QKEY, [])].slice(-MAXQ); lsSet(QKEY, q); }
  sending = false;
  if (q.length) reschedule(back.length ? 30000 : 1000);
}
async function post1(batch) {
  let keep = false;
  try {
    const r = await fetch(SB_URL + '/rest/v1/kh_events', { method: 'POST', keepalive: true, headers: { apikey: SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(batch) });
    // success, or permanently rejected (4xx) -> done; 401/429/5xx -> retry later
    keep = !(r.ok || (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429));
    // read the (empty) body: an unread response is cancelled by Chrome and shows up as net::ERR_ABORTED in DevTools
    r.text().catch(() => {});
  } catch {
    // A keepalive request outlives the page: when the tab is being hidden/unloaded (reload, SW-update reload, close),
    // the promise rejects although the browser still delivers the body. Re-queueing it then = duplicate rows, so only
    // a failure while the page is visible counts as "not sent".
    keep = !leaving && document.visibilityState === 'visible';
  }
  return keep;
}
export function initAnalytics() {
  scheduleReports(); // pending anonymous reports go out even when usage analytics is off
  addEventListener('online', () => sendDueReports());
  if (OFF) return;
  _adoptHeld();
  setTimeout(edgeCountry, 4000);
  addEventListener('online', () => reschedule(2000));
  addEventListener('pagehide', () => { leaving = true; _onHide(); flush({ hide: true }); });
  addEventListener('pageshow', () => { leaving = false; _adoptHeld(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { _onHide(); flush({ hide: true }); } else { _adoptHeld(); reschedule(2000); } });
  if (q.length) schedule(5000);
}
