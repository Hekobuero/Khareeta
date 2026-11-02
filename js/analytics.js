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
  if (type === 'visit') { try { if (sessionStorage.getItem('kh.visit') === sessionId) return; sessionStorage.setItem('kh.visit', sessionId); } catch {} }
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
  addEventListener('pagehide', () => { leaving = true; flush(); });
  addEventListener('pageshow', () => { leaving = false; });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  if (q.length) schedule(5000);
}
