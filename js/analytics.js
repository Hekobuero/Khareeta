// Privacy-first, anonymous usage analytics → Supabase (insert-only for the public app).
// - random install id in localStorage, no personal data, no IP stored, no raw search text
// - location only rounded to 0.1° and only if the user already shared GPS in the app
// - events are queued in localStorage and sent in batches when online; never blocks the UI
import { VERSION, lsGet, lsSet } from './util.js';
import { getLang } from './i18n.js';

const SB_URL = 'https://ihqcgjndnjxxgeqheoei.supabase.co';
const SB_KEY = 'sb_publishable_0YKvFqXx8JX_xGH6ZcloRg_1Lrb_Ngz'; // public (publishable) key – RLS allows INSERT only
const QKEY = 'kh.aq', MAXQ = 300;
const OFF = (() => { try { return localStorage.getItem('kh.noTrack') === '1' || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true; } catch { return false; } })();

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
let installId = (() => { try { let v = localStorage.getItem('kh.iid'); if (!v) { v = rid(); localStorage.setItem('kh.iid', v); } return v; } catch { return 'nostorage'; } })();
const sessionId = rid().slice(0, 18);

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
if (!geo || Date.now() - (geo.t || 0) > 7 * 864e5) geo = { ...tzGeo(), t: Date.now() };
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

// ----- referrer / utm (first visit of the session) -----
const sp = new URLSearchParams(location.search);
const utm = (sp.get('utm_source') || '').slice(0, 80) || null;
let refDomain = null;
try { if (document.referrer) { const h = new URL(document.referrer).hostname; if (h && h !== location.hostname) refDomain = h.replace(/^www\./, '').slice(0, 120); } } catch {}

// ----- queue -----
let q = lsGet(QKEY, []);
const ALLOWED = new Set(['visit', 'search', 'category', 'place_view', 'route', 'directions_open', 'nav_start', 'nav_arrive', 'reroute', 'offline_download', 'lang_change', 'share', 'locate', 'whats_here', 'measure', 'layer', 'install']);
export function track(type, props = {}) {
  if (OFF || !ALLOWED.has(type)) return;
  try {
    const pr = { ...props };
    if (type === 'locate' && pr.lat != null) { gpsGeo(pr.lat, pr.lon); delete pr.lat; delete pr.lon; }
    for (const k in pr) if (pr[k] == null || (typeof pr[k] === 'string' && pr[k].length > 40)) delete pr[k];
    const ev = {
      client_ts: new Date().toISOString(), install_id: installId, session_id: sessionId, type, lang: getLang(),
      device: DEV.device, os: DEV.os, standalone: DEV.standalone, app_version: VERSION,
      country: geo.country || null, city: geo.city || null, geo_src: geo.geo_src || null,
      lat_r: geo.geo_src === 'gps' ? geo.lat_r : null, lon_r: geo.geo_src === 'gps' ? geo.lon_r : null,
      referrer: type === 'visit' ? refDomain : null, utm_source: type === 'visit' ? utm : null, props: pr,
    };
    q.push(ev); if (q.length > MAXQ) q = q.slice(-MAXQ);
    lsSet(QKEY, q); schedule();
  } catch {}
}
let timer = null, sending = false;
function schedule(ms = 8000) { if (!timer) timer = setTimeout(() => { timer = null; flush(); }, ms); }
export async function flush(beacon = false) {
  if (sending || !q.length || !navigator.onLine) return;
  sending = true;
  const batch = q.slice(0, 50);
  try {
    const opts = { method: 'POST', keepalive: beacon, headers: { apikey: SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(batch) };
    const r = await fetch(SB_URL + '/rest/v1/kh_events', opts);
    if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429)) {
      // success, or permanently rejected (e.g. table missing) -> drop batch to avoid endless growth
      q = lsGet(QKEY, q).slice(batch.length); lsSet(QKEY, q);
    }
  } catch {}
  sending = false;
  if (q.length) schedule(30000);
}
export function initAnalytics() {
  if (OFF) return;
  setTimeout(edgeCountry, 4000);
  addEventListener('online', () => schedule(2000));
  addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  if (q.length) schedule(5000);
}
