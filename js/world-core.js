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
