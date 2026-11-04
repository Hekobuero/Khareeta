// Whole-city offline packs (Damascus, Aleppo, Homs): pure helpers, no DOM – unit-tested in tests/offline/.
// Tiles come from OpenFreeMap (OSM data, no key). Its vector tiles end at z14 (MapLibre overzooms z15+ from them),
// so a pack covers the metro bbox at z8–z14 plus a small Syria overview at z5–z7.
// Fair use: at most 2 requests in flight, a short pause between requests, back-off on 429/5xx.
export const CITY_CACHE = 'kh-city-';
export const CITIES = [
  { id: 'damascus', name: { en: 'Damascus', ar: 'دمشق', de: 'Damaskus' }, bbox: [36.15, 33.40, 36.45, 33.62], kb: 10450 },
  { id: 'aleppo', name: { en: 'Aleppo', ar: 'حلب', de: 'Aleppo' }, bbox: [37.05, 36.13, 37.25, 36.29], kb: 10020 },
  { id: 'homs', name: { en: 'Homs', ar: 'حمص', de: 'Homs' }, bbox: [36.64, 34.68, 36.78, 34.78], kb: 5060 }
];
export const ZMIN = 8, ZMAX = 14, OVERVIEW = { bbox: [35.6, 32.3, 42.4, 37.4], zmin: 5, zmax: 7 };
export const CONCURRENCY = 2, PAUSE_MS = 120, MAX_RETRY = 3;

const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
export function tilesInBbox([w, s, e, n], zmin, zmax) {
  const out = [];
  for (let z = zmin; z <= zmax; z++) {
    const m = 2 ** z - 1, cl = v => Math.max(0, Math.min(m, v));
    for (let x = cl(lon2x(w, z)); x <= cl(lon2x(e, z)); x++) for (let y = cl(lat2y(n, z)); y <= cl(lat2y(s, z)); y++) out.push([z, x, y]);
  }
  return out;
}
export const cityById = id => CITIES.find(c => c.id === id) || null;
export function cityTiles(city) {
  const seen = new Set(), out = [];
  for (const t of [...tilesInBbox(OVERVIEW.bbox, OVERVIEW.zmin, OVERVIEW.zmax), ...tilesInBbox(city.bbox, ZMIN, ZMAX)]) {
    const k = t.join('/'); if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}
// city.kb = measured decoded pack size (tiles only, OpenFreeMap build 20261101, 2026-11-04); for a city without a
// measurement: average decoded OpenFreeMap tile size per zoom in urban Syria (KB), measured 2026-11-04 over the three packs.
const KB = { 5: 300, 6: 250, 7: 170, 8: 130, 9: 100, 10: 75, 11: 60, 12: 55, 13: 50, 14: 60 };
export const EXTRAS_KB = 2100; // glyph ranges (Latin + Arabic) + sprites + tilejson
export const estimateCityBytes = city => ((city.kb ?? cityTiles(city).reduce((s, [z]) => s + (KB[z] ?? 60), 0)) + EXTRAS_KB) * 1024;
export const tileUrl = (tpl, [z, x, y]) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
// enough free quota? keep 20 % headroom (+ 20 MB) so the browser never evicts the app shell
export function quotaOk(est, need) {
  if (!est || !est.quota) return true; // unknown (old browsers): let the download try
  return (est.quota - (est.usage || 0)) >= need * 1.2 + 20 * 1048576;
}
// download marker: the service worker passes marked requests straight to the network without caching them
export const markCity = u => u + (u.includes('?') ? '&' : '?') + 'kh-city=1';
export const unmarkCity = u => u.replace(/([?&])kh-city=1(&|$)/, (m, a, b) => (b ? a : '')).replace(/[?&]$/, '');
// Delete / Cancel: remove the city pack and any copies of its tile URLs in the shared tile cache kh-tiles
// (glyphs/sprites stay: other areas and the normal map use them)
export async function purgeCity(cachesApi, id, keys) {
  await cachesApi.delete(CITY_CACHE + id);
  const c = await cachesApi.open('kh-tiles'); for (const k of keys) await c.delete(k);
  // the city's servis/bus lines (stored by cacheTransit on download); index.json stays, it is shared by all cities
  try { const tc = await cachesApi.open('kh-transit'); for (const k of await tc.keys()) if (new RegExp(`/data/transit/${id}\\.json$`).test(k.url || k)) await tc.delete(k); } catch {}
}
export const cityName = (city, lang) => city.name[lang] || city.name.en;

// Polite downloader: limited concurrency, pause between requests, retry with back-off on 429/5xx/network errors,
// skips keys already cached, abortable via AbortSignal. fetchFn/cache/sleep are injected (tests, low-end devices).
export async function downloadAll(urls, { fetchFn, cache, keyOf = u => u, signal, onProgress, sleep = ms => new Promise(r => setTimeout(r, ms)), concurrency = CONCURRENCY, pause = PAUSE_MS }) {
  let i = 0, done = 0, bytes = 0, fail = 0, empty = 0;
  const one = async u => {
    const key = keyOf(u);
    if (await cache.match(key)) return;
    for (let a = 0; a <= MAX_RETRY; a++) {
      if (signal?.aborted) return;
      try {
        const r = await fetchFn(markCity(u), { mode: 'cors', credentials: 'omit', signal });
        if (r.ok) { const b = await r.blob(); bytes += b.size; await cache.put(key, new Response(b, { headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream', 'x-kh-date': String(Date.now()) } })); return; }
        if (r.status === 404 || r.status === 204) { empty++; return; }
        if (r.status !== 429 && r.status < 500) { fail++; return; }
      } catch (e) { if (signal?.aborted) return; }
      if (a === MAX_RETRY) { fail++; return; }
      await sleep(1000 * 2 ** a);
    }
  };
  const worker = async () => {
    while (i < urls.length && !signal?.aborted) {
      await one(urls[i++]); done++;
      onProgress?.(done, urls.length, bytes);
      if (pause) await sleep(pause);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return { done, bytes, fail, empty, aborted: !!signal?.aborted };
}
