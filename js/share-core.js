// "What's here" + share links – pure helpers (no DOM, no network): deep-link parsing, share URL/text, geo: URI,
// Nominatim reverse throttle (≤ 1 req/s) and a bounded reverse-geocode cache (memory + localStorage).
// Tested in tests/share/. Coordinates never go to analytics.

export const SITE = 'https://khareeta.app/';
export const SHARE_ZOOM = 16;
export const REV_PREC = 5;          // cache key: ~1 m
export const REV_MAX = 200;         // cache entries (memory + localStorage)
export const REV_LS_KEY = 'kh.rev';
export const NOM_GAP_MS = 1000;     // Nominatim usage policy: max 1 request / second

const num = s => (typeof s === 'string' && /^\s*[-+]?\d+(\.\d+)?\s*$/.test(s)) ? Number(s) : NaN;
export const round = (v, p = REV_PREC) => Number(v.toFixed(p));
export const fmt5 = v => v.toFixed(5);

/** Parse "?p=lat,lon&n=name&z=16&route=1". Returns null when p is missing/invalid. An OSM id (p=n123) is not ours → null. */
export function parseDeepLink(search) {
  let sp; try { sp = new URLSearchParams(search || ''); } catch { return null; }
  const p = sp.get('p'); if (!p || !p.includes(',')) return null;
  const parts = p.split(','); if (parts.length !== 2) return null;
  const lat = num(parts[0]), lon = num(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  let z = num(sp.get('z') ?? ''); if (!Number.isFinite(z)) z = SHARE_ZOOM; z = Math.min(20, Math.max(2, z));
  let name = (sp.get('n') || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 80) || null;
  return { lat: round(lat), lon: round(lon), z, name, route: sp.get('route') === '1' };
}

export function buildShareUrl({ lat, lon, name, z = SHARE_ZOOM, route = false }, base = SITE) {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  // keep "," readable in the link (WhatsApp/Telegram link detection stops at %2C on some clients)
  let q = 'p=' + fmt5(lat) + ',' + fmt5(lon);
  if (name) q += '&n=' + encodeURIComponent(String(name).slice(0, 80));
  q += '&z=' + Math.round(z);
  if (route) q += '&route=1';
  return u.origin + u.pathname + '?' + q;
}

export const geoUri = (lat, lon) => `geo:${fmt5(lat)},${fmt5(lon)}`;

export const SHARE_I18N = {
  en: { whTitle: "What's here?", whCoords: 'Coordinates', whCopyCoords: 'Copy coordinates', whRouteHere: 'Route here', whShare: 'Share', whGeo: 'Open in another map app', whAddrLoading: 'Looking up address…', whNoAddr: 'No address found', whCopied: 'Link copied – paste it in WhatsApp or Telegram', whCoordsCopied: 'Coordinates copied', shareMyLoc: 'Share my location', myLocName: 'My location', shareTitle: '{n} – Khareeta', whRouteOffer: 'Route from your location', whNeedGps: 'Turn on location to get a route', shareGeoLine: 'Other map app: {g}', ohHidden: '{n} without opening hours hidden' },
  ar: { whTitle: 'ما هذا المكان؟', whCoords: 'الإحداثيات', whCopyCoords: 'نسخ الإحداثيات', whRouteHere: 'المسار إلى هنا', whShare: 'مشاركة', whGeo: 'فتح في تطبيق خرائط آخر', whAddrLoading: 'جارٍ البحث عن العنوان…', whNoAddr: 'لم يتم العثور على عنوان', whCopied: 'تم نسخ الرابط – الصقه في واتساب أو تيليغرام', whCoordsCopied: 'تم نسخ الإحداثيات', shareMyLoc: 'مشاركة موقعي', myLocName: 'موقعي', shareTitle: '{n} – خريطة', whRouteOffer: 'المسار من موقعك', whNeedGps: 'فعّل الموقع للحصول على مسار', shareGeoLine: 'تطبيق خرائط آخر: {g}', ohHidden: 'تم إخفاء {n} بدون ساعات عمل' },
  de: { whTitle: 'Was ist hier?', whCoords: 'Koordinaten', whCopyCoords: 'Koordinaten kopieren', whRouteHere: 'Route hierher', whShare: 'Teilen', whGeo: 'In anderer Karten-App öffnen', whAddrLoading: 'Adresse wird gesucht…', whNoAddr: 'Keine Adresse gefunden', whCopied: 'Link kopiert – in WhatsApp oder Telegram einfügen', whCoordsCopied: 'Koordinaten kopiert', shareMyLoc: 'Mein Standort teilen', myLocName: 'Mein Standort', shareTitle: '{n} – Khareeta', whRouteOffer: 'Route von deinem Standort', whNeedGps: 'Standort einschalten, um eine Route zu erhalten', shareGeoLine: 'Andere Karten-App: {g}', ohHidden: '{n} ohne Öffnungszeiten ausgeblendet' },
};
const tr = (lang, k, v = {}) => { let s = (SHARE_I18N[lang] || SHARE_I18N.en)[k] ?? SHARE_I18N.en[k]; for (const x in v) s = s.split('{' + x + '}').join(v[x]); return s; };

/** Share text: "title\naddress\nlink" (+ optional geo: line). */
export function shareText({ lang = 'en', name, address, url, lat, lon, geo = false }) {
  const title = tr(lang, 'shareTitle', { n: name || tr(lang, 'whTitle') });
  const lines = [title];
  if (address && address !== name) lines.push(address);
  lines.push(url);
  if (geo && lat != null) lines.push(tr(lang, 'shareGeoLine', { g: geoUri(lat, lon) }));
  return lines.join('\n');
}

/** Minimum gap between requests (shared queue). now/sleep injectable for tests. */
export class Throttle {
  constructor(gap = NOM_GAP_MS, { now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) { this.gap = gap; this.now = now; this.sleep = sleep; this.next = 0; }
  async run(fn) {
    const t = this.now(), at = Math.max(t, this.next); this.next = at + this.gap;
    if (at > t) await this.sleep(at - t);
    return fn();
  }
}

export const revKey = (lat, lon, lang) => `${lang}:${fmt5(lat)},${fmt5(lon)}`;

/** LRU-ish bounded cache, persisted to storage (any {getItem,setItem}). */
export class RevCache {
  constructor(storage = null, max = REV_MAX, key = REV_LS_KEY) {
    this.st = storage; this.max = max; this.key = key; this.m = new Map();
    try { const a = JSON.parse(storage?.getItem(key) || '[]'); if (Array.isArray(a)) for (const [k, v] of a.slice(-max)) if (typeof k === 'string' && typeof v === 'string') this.m.set(k, v); } catch {}
  }
  get(k) { if (!this.m.has(k)) return undefined; const v = this.m.get(k); this.m.delete(k); this.m.set(k, v); return v; }
  set(k, v) {
    this.m.delete(k); this.m.set(k, String(v).slice(0, 300));
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value);
    try { this.st?.setItem(this.key, JSON.stringify([...this.m])); } catch {}
  }
  get size() { return this.m.size; }
}

export function reverseUrl(lat, lon, lang) {
  return `https://nominatim.openstreetmap.org/reverse?lat=${fmt5(lat)}&lon=${fmt5(lon)}&format=jsonv2&zoom=18&addressdetails=1&accept-language=${encodeURIComponent(lang)}&email=khareeta-app%40users.noreply.github.com`;
}
export function addrFromReverse(j) {
  if (!j || j.error) return '';
  return String(j.display_name || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4).join(', ');
}

/** Reverse geocode with cache + throttle. fetchFn returns parsed JSON. */
export function makeReverse({ fetchFn, cache, throttle }) {
  const inflight = new Map();
  return async (lat, lon, lang) => {
    const k = revKey(lat, lon, lang);
    const c = cache.get(k); if (c !== undefined) return c;
    if (inflight.has(k)) return inflight.get(k);
    const p = throttle.run(() => fetchFn(reverseUrl(lat, lon, lang))).then(j => { const a = addrFromReverse(j); cache.set(k, a); return a; }).finally(() => inflight.delete(k));
    inflight.set(k, p); return p;
  };
}
