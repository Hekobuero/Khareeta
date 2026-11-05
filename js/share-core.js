// "What's here" + share links – pure helpers (no DOM, no network): deep-link parsing, share URL/text, geo: URI,
// Nominatim reverse throttle (≤ 1 req/s) and a bounded reverse-geocode cache (memory + localStorage).
// Tested in tests/share/. Coordinates never go to analytics.

export const SITE = 'https://khareeta.app/';
export const SHARE_ZOOM = 16;
export const REV_PREC = 5;          // cache key: ~1 m
export const REV_MAX = 200;         // cache entries (memory + localStorage)
export const REV_LS_KEY = 'kh.rev2';   // v2: structured address (P3) – old display_name entries are not reused
export const NOM_GAP_MS = 1000;     // Nominatim usage policy: max 1 request / second
export const WH_EVENT_GAP_MS = 5000; // whats_here analytics: max 1 event per point / 5 s
export const HINT_MAX = 99;         // hidden-without-hours hint: exact up to 99, otherwise "99+"

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
  en: { whTitle: "What's here?", whCoords: 'Coordinates', whCopyCoords: 'Copy coordinates', whCopyShort: 'Copy', whRouteHere: 'Route here', whShare: 'Share', whGeo: 'Open in another map app', whAddrLoading: 'Looking up address…', whNoAddr: 'No address found', whCopied: 'Link copied – paste it in WhatsApp or Telegram', whCoordsCopied: 'Coordinates copied', shareMyLoc: 'Share my location', myLocName: 'My location', shareTitle: '{n} – Khareeta', whRouteOffer: 'Route from your location', whNeedGps: 'Turn on location to get a route', shareGeoLine: 'Other map app: {g}', ohHidden: '{n} without opening hours hidden', ohShowAnyway: 'Show anyway' },
  ar: { whTitle: 'ما هذا المكان؟', whCoords: 'الإحداثيات', whCopyCoords: 'نسخ الإحداثيات', whCopyShort: 'نسخ', whRouteHere: 'المسار إلى هنا', whShare: 'مشاركة', whGeo: 'فتح في تطبيق خرائط آخر', whAddrLoading: 'جارٍ البحث عن العنوان…', whNoAddr: 'لم يتم العثور على عنوان', whCopied: 'تم نسخ الرابط – الصقه في واتساب أو تيليغرام', whCoordsCopied: 'تم نسخ الإحداثيات', shareMyLoc: 'مشاركة موقعي', myLocName: 'موقعي', shareTitle: '{n} – خريطة', whRouteOffer: 'المسار من موقعك', whNeedGps: 'فعّل الموقع للحصول على مسار', shareGeoLine: 'تطبيق خرائط آخر: {g}', ohHidden: 'تم إخفاء {n} بدون ساعات عمل', ohShowAnyway: 'عرض الكل' },
  de: { whTitle: 'Was ist hier?', whCoords: 'Koordinaten', whCopyCoords: 'Koordinaten kopieren', whCopyShort: 'Kopieren', whRouteHere: 'Route hierher', whShare: 'Teilen', whGeo: 'In anderer Karten-App öffnen', whAddrLoading: 'Adresse wird gesucht…', whNoAddr: 'Keine Adresse gefunden', whCopied: 'Link kopiert – in WhatsApp oder Telegram einfügen', whCoordsCopied: 'Koordinaten kopiert', shareMyLoc: 'Mein Standort teilen', myLocName: 'Mein Standort', shareTitle: '{n} – Khareeta', whRouteOffer: 'Route von deinem Standort', whNeedGps: 'Standort einschalten, um eine Route zu erhalten', shareGeoLine: 'Andere Karten-App: {g}', ohHidden: '{n} ohne Öffnungszeiten ausgeblendet', ohShowAnyway: 'Trotzdem anzeigen' },
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
  /** skip(): checked after the wait – when true the request is dropped (no fetch) and an AbortError is thrown. */
  async run(fn, skip = null) {
    const t = this.now(), at = Math.max(t, this.next); this.next = at + this.gap;
    if (at > t) await this.sleep(at - t);
    if (skip && skip()) { const e = new Error('superseded'); e.name = 'AbortError'; throw e; }
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
const ADDR_SEP = { ar: '، ' };
const firstOf = (a, ks) => { for (const k of ks) { const v = a[k]; if (typeof v === 'string' && v.trim()) return v.trim(); } return ''; };
/** Structured address from Nominatim's address object (road + house_number, suburb/neighbourhood, city), locale order:
 *  DE "Straße 12, Stadtteil, Stadt" · EN "12 Street, Suburb, City" · AR "الشارع 12، الحي، المدينة". Fallback: display_name (first 4 parts). */
export function formatAddress(a, lang = 'en') {
  if (!a || typeof a !== 'object') return '';
  const road = firstOf(a, ['road', 'pedestrian', 'footway', 'street', 'square', 'place']);
  const hn = firstOf(a, ['house_number']);
  const sub = firstOf(a, ['suburb', 'neighbourhood', 'quarter', 'city_district', 'borough']);
  const city = firstOf(a, ['city', 'town', 'village', 'municipality', 'hamlet']);
  if (!road && !sub) return '';
  const street = !road ? '' : !hn ? road : lang === 'en' ? hn + ' ' + road : road + ' ' + hn;
  const parts = [];
  for (const x of [street, sub, city]) if (x && !parts.includes(x)) parts.push(x);
  return parts.join(ADDR_SEP[lang] || ', ');
}
export function addrFromReverse(j, lang = 'en') {
  if (!j || j.error) return '';
  return formatAddress(j.address, lang) || String(j.display_name || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4).join(', ');
}

/** Reverse geocode with cache + throttle. fetchFn returns parsed JSON.
 *  latest: true → only the newest request survives; older ones still waiting in the throttle are dropped (AbortError, no fetch). */
export function makeReverse({ fetchFn, cache, throttle, latest = false }) {
  const inflight = new Map(); let seq = 0;
  return async (lat, lon, lang) => {
    const k = revKey(lat, lon, lang);
    const c = cache.get(k); if (c !== undefined) return c;
    const my = ++seq;
    if (inflight.has(k)) { const q = inflight.get(k); q.seq = my; return q.p; }
    const q = { seq: my };
    q.p = throttle.run(() => fetchFn(reverseUrl(lat, lon, lang)), latest ? () => q.seq !== seq : null)
      .then(j => { const a = addrFromReverse(j, lang); cache.set(k, a); return a; }).finally(() => inflight.delete(k));
    inflight.set(k, q); return q.p;
  };
}

/** At most one event per key within gap ms (whats_here analytics: key = point at 5 decimals). */
export class EventGate {
  constructor(gap = WH_EVENT_GAP_MS, now = () => Date.now()) { this.gap = gap; this.now = now; this.m = new Map(); }
  ok(key) {
    const t = this.now();
    for (const [k, v] of this.m) if (t - v >= this.gap) this.m.delete(k);
    if (this.m.has(key)) return false;
    this.m.set(key, t); return true;
  }
}
export const pointKey = (lat, lon) => fmt5(lat) + ',' + fmt5(lon);

/** Hint count: exact up to 99, otherwise "99+"; locale e.g. 'de-DE', 'en-GB', 'ar-SY-u-nu-latn' / 'ar-SY-u-nu-arab'. */
export function hintCount(n, locale = 'en-GB') {
  let f; try { f = new Intl.NumberFormat(locale); } catch { f = new Intl.NumberFormat('en-GB'); }
  n = Math.max(0, Math.round(n || 0));
  return n > HINT_MAX ? f.format(HINT_MAX) + '+' : f.format(n);
}
