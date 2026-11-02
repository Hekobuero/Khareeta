import { t, getLang } from './i18n.js';

export const VERSION = '20261102-2135';
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- settings ----------
const DEF = { mapLang: 'auto', arabicDigits: false, lowData: false, dark: false, voice: true, style: 'standard', hillshade: false, b3d: true, terrain3d: false, hybridLabels: true, satHD: false };
export const settings = Object.assign({}, DEF, (() => { try { return JSON.parse(localStorage.getItem('kh.settings') || '{}'); } catch { return {}; } })());
export function saveSettings() { try { localStorage.setItem('kh.settings', JSON.stringify(settings)); } catch {} }
export function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
export function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

export { nf, digits, fmtDist, fmtDur, fmtTime, fmtBytes, locale } from './fmt.js';
import { digits } from './fmt.js';

// ---------- geo ----------
export function haversine(a, b) { // [lon,lat]
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function bearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
export function compass8(deg) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]; }
// nearest point on polyline: returns {dist, idx, t, point, along}
export function nearestOnLine(p, coords, cum) {
  let best = { dist: Infinity, idx: 0, point: coords[0], along: 0 };
  const kx = Math.cos(p[1] * Math.PI / 180) * 111320, ky = 110540;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let tt = l2 ? -(ax * dx + ay * dy) / l2 : 0; tt = Math.max(0, Math.min(1, tt));
    const cx = ax + tt * dx, cy = ay + tt * dy, d = Math.hypot(cx, cy);
    if (d < best.dist) best = { dist: d, idx: i, t: tt, point: [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt], along: cum ? cum[i] + (cum[i + 1] - cum[i]) * tt : 0 };
  }
  return best;
}
export function cumulative(coords) { const c = [0]; for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + haversine(coords[i - 1], coords[i])); return c; }
export function fmtCoord(lat, lon) { return digits(lat.toFixed(5) + ', ' + lon.toFixed(5)); }

// parse "33.51, 36.29" / "33.51 36.29" / "33°30'N 36°17'E" / geo:33.5,36.2
export function parseCoords(q) {
  q = q.trim().replace(/^geo:/i, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  let m = q.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (m) { const la = +m[1], lo = +m[2]; if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) return [lo, la]; }
  m = q.match(/^(\d{1,2})[°\s]+(\d{1,2})['′\s]+(?:(\d{1,2}(?:\.\d+)?)["″\s]*)?\s*([NS])[\s,]+(\d{1,3})[°\s]+(\d{1,2})['′\s]+(?:(\d{1,2}(?:\.\d+)?)["″\s]*)?\s*([EW])$/i);
  if (m) {
    let la = +m[1] + m[2] / 60 + (+m[3] || 0) / 3600, lo = +m[5] + m[6] / 60 + (+m[7] || 0) / 3600;
    if (/s/i.test(m[4])) la = -la; if (/w/i.test(m[8])) lo = -lo; return [lo, la];
  }
  return null;
}

// ---------- Open Location Code (plus codes) ----------
const OLC = '23456789CFGHJMPQRVWX';
export function plusEncode(lat, lon) {
  lat = Math.min(90 - 1e-10, Math.max(-90, lat)) + 90; lon = ((lon + 180) % 360 + 360) % 360;
  let code = '', res = 20;
  let la = lat, lo = lon;
  for (let i = 0; i < 5; i++) {
    const dl = Math.floor(la / res), dn = Math.floor(lo / res);
    la -= dl * res; lo -= dn * res; code += OLC[dl] + OLC[dn]; res /= 20;
  }
  return code.slice(0, 8) + '+' + code.slice(8);
}
export function plusDecode(code) {
  code = code.toUpperCase().replace(/\s/g, '');
  const m = code.match(/^([23456789CFGHJMPQRVWX]{8})\+([23456789CFGHJMPQRVWX]{2,3})$/);
  if (!m) return null;
  const s = m[1] + m[2]; let lat = -90, lon = -180, res = 20;
  for (let i = 0; i < 10 && i < s.length; i += 2) { lat += OLC.indexOf(s[i]) * res; lon += OLC.indexOf(s[i + 1]) * res; if (i < 8) res /= 20; }
  return [lon + res / 2, lat + res / 2];
}

// ---------- network with timeout + failover ----------
export async function fetchJSON(urls, opts = {}, timeout = 12000) {
  if (!Array.isArray(urls)) urls = [urls];
  let lastErr;
  for (const u of urls) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeout);
    if (opts.signal) opts.signal.addEventListener('abort', () => ctl.abort());
    try {
      const r = await fetch(u, { ...opts, signal: ctl.signal });
      clearTimeout(tm);
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status); if (r.status === 400 || r.status === 404) throw lastErr; continue; }
      return await r.json();
    } catch (e) { clearTimeout(tm); lastErr = e; if (opts.signal?.aborted) throw e; if (e.message === 'HTTP 400' || e.message === 'HTTP 404') throw e; }
  }
  throw lastErr || new Error('network');
}

// Nominatim politeness: max 1 request / second
let nomLast = 0;
export async function nominatim(path) {
  const wait = nomLast + 1100 - Date.now(); if (wait > 0) await sleep(wait);
  nomLast = Date.now();
  return fetchJSON('https://nominatim.openstreetmap.org/' + path + (path.includes('?') ? '&' : '?') + 'email=khareeta-app%40users.noreply.github.com');
}

// Overpass with multiple community endpoints
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
let opIdx = 0;
// hedged requests: start with the last good endpoint, add the next one if no answer after `hedge` ms
export function overpass(q, timeout = 20000, hedge = 3500) {
  return new Promise((resolve, reject) => {
    let done = false, fails = 0, started = 0; const timers = [];
    const start = () => {
      if (done || started >= OVERPASS.length) return;
      const k = (opIdx + started++) % OVERPASS.length;
      fetchJSON(OVERPASS[k], { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, timeout)
        .then(j => { if (done) return; if (!j || !Array.isArray(j.elements)) throw new Error('bad'); done = true; opIdx = k; timers.forEach(clearTimeout); resolve(j); })
        .catch(e => { if (done) return; fails++; if (fails >= OVERPASS.length) { done = true; reject(e); } else start(); });
      if (started < OVERPASS.length) timers.push(setTimeout(start, hedge));
    };
    start();
  });
}

// ---------- toast ----------
let toastT;
export function toast(msg, ms = 2600) {
  const el = $('#toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), ms);
}
export function debounce(fn, ms) { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; }
