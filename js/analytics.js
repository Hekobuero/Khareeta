// Privacy-first, anonymous usage analytics → Supabase (insert-only for the public app).
// - random install id in localStorage, no personal data, no IP stored, no raw search text
// - location only rounded to 0.1° and only if the user already shared GPS in the app
// - events are queued in localStorage and sent in batches when online; never blocks the UI
import { VERSION, lsGet, lsSet } from './util.js';
import { getLang } from './i18n.js';

const SB_URL = 'https://ihqcgjndnjxxgeqheoei.supabase.co';
const SB_KEY = 'sb_publishable_0YKvFqXx8JX_xGH6ZcloRg_1Lrb_Ngz'; // public (publishable) key – RLS allows INSERT only
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
function attribution() {
  try { const a = JSON.parse(sessionStorage.getItem('kh.att') || 'null'); if (a) return a; } catch {}
  const sp = new URLSearchParams(location.search);
  let refHost = null, refRaw = '';
  try { refRaw = document.referrer || ''; if (refRaw) { const u = new URL(refRaw); const h = u.protocol === 'android-app:' ? u.host || refRaw.slice(14).split('/')[0] : u.hostname; if (h && h !== location.hostname) refHost = h.replace(/^www\./, '').slice(0, 120); } } catch {}
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
  const l = (cp && cp.l) || (LANGS.includes(pl) && pl) || langHint(a.utm_content, a.utm_campaign) || getLang();
  a.ch = ch; a.chl = `${ch}_${l}`;
  try { sessionStorage.setItem('kh.att', JSON.stringify(a)); } catch {}
  return a;
}
const ATT = attribution();
const UTM_KEYS = ['utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
// Funnel visit → search → route → nav_start → install: the first event of each step in a session carries props.f = 1
const FUNNEL = new Set(['visit', 'search', 'route', 'nav_start', 'install']);
function funnelFirst(type, pr) {
  if (!FUNNEL.has(type)) return false;
  if (type === 'install' && pr.stage !== 'installed') return false; // 'accepted' is only a stage, not an install
  try { const f = JSON.parse(sessionStorage.getItem('kh.fun') || '[]'); if (f.includes(type)) return false; f.push(type); sessionStorage.setItem('kh.fun', JSON.stringify(f)); return true; } catch { return false; }
}
// Install events (all as type 'install' – the table's type check already allows it; props.stage tells them apart)
const onceSession = k => { try { if (sessionStorage.getItem(k)) return false; sessionStorage.setItem(k, '1'); return true; } catch { return true; } };
addEventListener('beforeinstallprompt', () => { if (onceSession('kh.bip')) track('install', { stage: 'available' }); });
// 'installed' = the real install: at most one per device (localStorage) and per session, even if the browser fires
// appinstalled twice (seen in Chrome). Only this event can carry the funnel flag f = 1.
const onceDevice = k => { try { if (localStorage.getItem(k)) return false; localStorage.setItem(k, String(Date.now())); return true; } catch { return true; } };
addEventListener('appinstalled', () => { if (onceSession('kh.inst') && onceDevice('kh.inst')) track('install', { stage: 'installed' }); });
const displayMode = () => ['standalone', 'fullscreen', 'minimal-ui'].find(m => matchMedia(`(display-mode: ${m})`).matches) || (navigator.standalone === true ? 'standalone' : 'browser');

// ----- queue -----
let q = lsGet(QKEY, []);
const ALLOWED = new Set(['visit', 'search', 'category', 'place_view', 'route', 'directions_open', 'nav_start', 'nav_arrive', 'reroute', 'offline_download', 'lang_change', 'share', 'locate', 'whats_here', 'measure', 'layer', 'install']);
// Reports must not be linkable to normal usage events. Events about a point/place the user looks at are therefore held
// back for HOLD_MS before they are queued; opening a report sheet drops the held ones (reportQuiet), and none are
// recorded while a report sheet is open or for QUIET_MS after a report was sent.
export const POINT_TYPES = new Set(['place_view', 'whats_here', 'share', 'directions_open', 'route', 'measure']);
export const HOLD_MS = 60e3, QUIET_MS = 60e3;
let held = [], quietUntil = 0;
/** Call when a report sheet opens (ms = how long to stay quiet; Infinity until the next call) and after sending. */
export function reportQuiet(ms = QUIET_MS, now = Date.now()) { for (const h of held) clearTimeout(h.tm); held = []; quietUntil = Math.max(quietUntil, now + ms); }
export const reportQuietOff = (now = Date.now()) => { quietUntil = Math.min(quietUntil, now + QUIET_MS); };
export const _heldCount = () => held.length;
// leaving the page: queue what is held unless a report is open / was just sent (then it is dropped)
function releaseHeld() { const h = held; held = []; for (const x of h) { clearTimeout(x.tm); if (Date.now() >= quietUntil) enqueue(x.type, x.props); } }
export function track(type, props = {}) {
  if (OFF || !ALLOWED.has(type)) return false;
  if (POINT_TYPES.has(type)) {
    if (Date.now() < quietUntil) return false;
    const h = { type, props, tm: setTimeout(() => { held = held.filter(x => x !== h); if (Date.now() >= quietUntil) enqueue(type, props); }, HOLD_MS) };
    held.push(h); return true;
  }
  return enqueue(type, props);
}
function enqueue(type, props) {
  if (type === 'visit') { try { if (sessionStorage.getItem('kh.visit') === sessionId) return; sessionStorage.setItem('kh.visit', sessionId); } catch {} }
  try {
    const pr = { ...props };
    if (type === 'locate' && pr.lat != null) { gpsGeo(pr.lat, pr.lon); delete pr.lat; delete pr.lon; }
    for (const k in pr) if (pr[k] == null || (typeof pr[k] === 'string' && pr[k].length > 40)) delete pr[k];
    pr.ch = ATT.chl; // channel_language on every event (props JSON: works without new columns)
    if (funnelFirst(type, pr)) pr.f = 1;
    if (type === 'visit' || pr.f) { for (const k of UTM_KEYS) if (ATT[k]) pr[k] = ATT[k]; }
    if (type === 'visit') pr.dm = displayMode();
    const ev = {
      client_ts: new Date().toISOString(), install_id: installId, session_id: sessionId, type, lang: getLang(),
      device: DEV.device, os: DEV.os, standalone: DEV.standalone, app_version: VERSION,
      country: geo.country || null, city: geo.city || null, geo_src: geo.geo_src || null,
      lat_r: geo.geo_src === 'gps' ? geo.lat_r : null, lon_r: geo.geo_src === 'gps' ? geo.lon_r : null,
      referrer: type === 'visit' ? ATT.referrer : null, utm_source: ATT.utm_source, props: pr,
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
    const r = await fetchImpl(SB_URL + '/rest/v1/kh_events', { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify([ev]), signal: ac?.signal });
    try { r.text().catch(() => {}); } catch {}
    return r.ok ? { ok: true } : { ok: false, why: 'http', status: r.status };
  } catch { return { ok: false, why: 'network' }; }
  finally { if (tm) clearTimeout(tm); }
}
let timer = null, sending = false, leaving = false;
function schedule(ms = 8000) { if (!timer) timer = setTimeout(() => { timer = null; flush(); }, ms); }
// Delivery is at-most-once: a batch is removed from the stored queue BEFORE it is sent (so a reload, the SW update
// reload or a second tab can never send it again) and only put back when the request demonstrably failed.
// Every request uses keepalive, so it is not cancelled when the page unloads (keepalive bodies are capped at 64 KB).
export async function flush() {
  if (sending || !navigator.onLine) return;
  q = lsGet(QKEY, q);
  if (!q.length) return;
  sending = true;
  const batch = [];
  let bytes = 2;
  for (const ev of q) { const n = JSON.stringify(ev).length + 1; if (batch.length >= 50 || (batch.length && bytes + n > 48000)) break; batch.push(ev); bytes += n; }
  q = q.slice(batch.length); lsSet(QKEY, q);
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
  if (keep) { q = [...batch, ...lsGet(QKEY, [])].slice(-MAXQ); lsSet(QKEY, q); }
  sending = false;
  if (q.length) schedule(keep ? 30000 : 1000);
}
export function initAnalytics() {
  if (OFF) return;
  setTimeout(edgeCountry, 4000);
  addEventListener('online', () => schedule(2000));
  addEventListener('pagehide', () => { leaving = true; releaseHeld(); flush(); });
  addEventListener('pageshow', () => { leaving = false; });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { releaseHeld(); flush(); } });
  if (q.length) schedule(5000);
}
