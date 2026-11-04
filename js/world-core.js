// Pure helpers for on-demand world POIs (outside the bundled Syria extract). No DOM → unit-tested in tests/world.
// Source: Overpass API only (free community endpoints, no keys). Requests are GET so the service worker can cache them.
export const SY_BBOX = [35.6, 32.3, 42.4, 37.4]; // W,S,E,N – the bundled offline POI extract covers this box
export const WORLD_MIN_ZOOM = 14;   // never query Overpass for wide views
export const CELL = 0.02;           // grid cell size in degrees (~2 km); requests cover whole cells → cacheable, deduped
export const MAX_CELLS = 12;        // at most this many cells per request (bounds the query area)
export const MIN_INTERVAL = 4000;   // ms between two Overpass requests (rate limit)
export const DEBOUNCE = 700;        // ms after the map stopped moving
export const MEM_CELLS = 300;       // in-memory cell LRU
export const OVERPASS_GET = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

export function inBox(lon, lat, b = SY_BBOX) { return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]; }
/** true if the view [W,S,E,N] is completely inside the bundled Syria data (then no live fetch is needed) */
export function viewInSyria(v) { return inBox(v[0], v[1]) && inBox(v[2], v[3]); }
const cellIdx = x => Math.floor(x / CELL + 1e-9);
export function cellKey(ix, iy) { return ix + ':' + iy; }
/** grid cells touching the view, nearest to the centre first, minus cells fully inside Syria; capped at MAX_CELLS */
export function cellsFor(v, max = MAX_CELLS) {
  const cx = (v[0] + v[2]) / 2, cy = (v[1] + v[3]) / 2, out = [];
  for (let ix = cellIdx(v[0]); ix <= cellIdx(v[2]); ix++) for (let iy = cellIdx(v[1]); iy <= cellIdx(v[3]); iy++) {
    const w = ix * CELL, s = iy * CELL;
    if (inBox(w, s) && inBox(w + CELL, s + CELL)) continue;
    out.push({ key: cellKey(ix, iy), ix, iy, d: Math.hypot(w + CELL / 2 - cx, s + CELL / 2 - cy) });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max);
}
/** bounding box [S,W,N,E] (Overpass order) of a set of cells */
export function cellsBox(cells) {
  const xs = cells.map(c => c.ix), ys = cells.map(c => c.iy);
  const r = v => +v.toFixed(5);
  return [r(Math.min(...ys) * CELL), r(Math.min(...xs) * CELL), r((Math.max(...ys) + 1) * CELL), r((Math.max(...xs) + 1) * CELL)];
}
/** Overpass QL: named OR branded amenities/shops/tourism – a name:ar is never required */
export function worldQuery(box) {
  const b = box.join(',');
  const sel = ['amenity', 'shop', 'tourism'].flatMap(k => [`nwr["${k}"]["name"](${b});`, `nwr["${k}"]["brand"][!"name"](${b});`]);
  return `[out:json][timeout:15];(${sel.join('')});out center tags 400;`;
}
export function overpassGetUrl(q, i = 0) { return OVERPASS_GET[i % OVERPASS_GET.length] + '?data=' + encodeURIComponent(q); }
/** Overpass element -> GeoJSON feature for the world POI source (props compatible with the bundled POI layers) */
export function elementToFeature(el, catFor) {
  const lon = el.lon ?? el.center?.lon, lat = el.lat ?? el.center?.lat, tags = el.tags || {};
  if (lon == null || lat == null) return null;
  const k = catFor(tags); if (!k) return null;
  const props = { wid: el.type[0] + el.id, c: k.c, g: k.g, sp: k.sp, imp: k.imp, rank: (3 - k.imp) * 10 + (tags.name ? 0 : 3) };
  for (const n of ['name', 'name:ar', 'name:en', 'name:de', 'int_name', 'name:latin', 'brand']) if (tags[n]) props[n] = tags[n];
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props };
}
/** Simple rate limiter: returns ms to wait before the next request may start */
export function rateWait(last, now, min = MIN_INTERVAL) { return Math.max(0, last + min - now); }
/** LRU of cells -> features; evicts the oldest cells beyond max */
export class CellCache {
  constructor(max = MEM_CELLS) { this.max = max; this.m = new Map(); }
  has(k) { return this.m.has(k); }
  set(k, feats) { this.m.delete(k); this.m.set(k, feats); while (this.m.size > this.max) this.m.delete(this.m.keys().next().value); }
  features() { const seen = new Set(), out = []; for (const fs of this.m.values()) for (const f of fs) if (!seen.has(f.properties.wid)) { seen.add(f.properties.wid); out.push(f); } return out; }
}
/** assign features to the cells they fall in */
export function splitByCell(feats) {
  const by = new Map();
  for (const f of feats) { const [x, y] = f.geometry.coordinates, k = cellKey(cellIdx(x), cellIdx(y)); (by.get(k) || by.set(k, []).get(k)).push(f); }
  return by;
}

// ---------- backoff (QA P1-1: no endless retries on 429/504) ----------
export const BACKOFF_BASE = 4000;      // first wait after a failed attempt
export const BACKOFF_MAX = 300000;     // never wait longer than 5 min between attempts
export const VIEW_TRIES = 4;           // failed attempts per viewport (cell set) before giving up on it
export const SESSION_FAILS = 8;        // consecutive failed attempts per session before world POIs pause until reload/online
/** Retry-After header (seconds or HTTP date) → ms, or 0 */
export function retryAfterMs(v, now = Date.now()) {
  if (v == null || v === '') return 0;
  const s = Number(v); if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const d = Date.parse(v); return Number.isFinite(d) ? Math.max(0, d - now) : 0;
}
/** Exponential backoff gate: 4 s → 8 s → 16 s … ≤ 5 min, honours Retry-After, caps attempts per view and per session,
 *  and allows the "busy" toast at most once per backoff period. Pure (time passed in) → unit-tested. */
export class Backoff {
  constructor(o = {}) { Object.assign(this, { base: BACKOFF_BASE, max: BACKOFF_MAX, viewTries: VIEW_TRIES, sessionFails: SESSION_FAILS }, o); this.fails = 0; this.until = 0; this.toastUntil = 0; this.view = ''; this.viewFails = 0; }
  /** ms to wait before an attempt for this view (0 = go, Infinity = do not try) */
  wait(now, view = '') {
    if (view !== this.view) { this.view = view; this.viewFails = 0; }
    if (this.fails >= this.sessionFails || this.viewFails >= this.viewTries) return Infinity;
    return Math.max(0, this.until - now);
  }
  /** record a failed attempt; returns { wait, toast } */
  fail(now, retryAfter = 0) {
    this.fails++; this.viewFails++;
    const exp = Math.min(this.max, this.base * 2 ** (this.fails - 1));
    const wait = Math.min(this.max, Math.max(exp, retryAfter || 0));
    this.until = now + wait;
    const toast = now >= this.toastUntil; if (toast) this.toastUntil = now + wait;
    return { wait, toast };
  }
  ok() { this.fails = 0; this.viewFails = 0; this.until = 0; }
  reset() { this.ok(); this.toastUntil = 0; }
}
/** One attempt: the endpoints in sequence, each at most once, starting at `start`. A 429/504 (overloaded) ends the
 *  attempt at once (the other public instances share the load; hammering them makes it worse). Resolves
 *  { elements, ep } or throws an Error with .status / .retryAfter (ms). */
export async function overpassAttempt(q, { fetchFn = fetch, start = 0, timeout = 20000, now = Date.now } = {}) {
  let last;
  for (let i = 0; i < OVERPASS_GET.length; i++) {
    const ep = (start + i) % OVERPASS_GET.length;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const tm = ctl ? setTimeout(() => ctl.abort(), timeout) : 0;
    try {
      const r = await fetchFn(overpassGetUrl(q, ep), ctl ? { signal: ctl.signal } : {});
      if (!r.ok) {
        const e = new Error('HTTP ' + r.status); e.status = r.status; e.retryAfter = retryAfterMs(r.headers?.get?.('Retry-After'), now());
        if (r.status === 429 || r.status === 504 || r.status === 503) throw Object.assign(e, { stop: true });
        last = e; continue;
      }
      const j = await r.json(); if (!j || !Array.isArray(j.elements)) { last = new Error('bad'); continue; }
      return { elements: j.elements, ep };
    } catch (e) { if (e.stop) throw e; last = e; }
    finally { clearTimeout(tm); }
  }
  throw last || new Error('overpass');
}
