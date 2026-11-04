// Offline area download (vector tiles + glyphs + sprites) into Cache Storage, respecting the
// OpenFreeMap policy: max 3000 tiles per download, max 4 parallel requests.
import { TRANSIT_DIR, TRANSIT_CITIES } from './transit-core.js';
import { $, esc, fmtBytes, nf, lsGet, lsSet, toast, sleep } from './util.js';
import { t } from './i18n.js';
import { ic } from './icons.js';
import { App, openSheet } from './core.js';
import { track } from './analytics.js';
import { loadPois } from './poi.js';
import { getLang } from './i18n.js';
import { CITIES, CITY_CACHE, cityById, cityTiles, cityName, estimateCityBytes, tileUrl, quotaOk, downloadAll, purgeCity, CONCURRENCY } from './cities.js';

export const MAX_TILES = 3000;
export const tileKey = u => u.replace(/^(https:\/\/tiles\.openfreemap\.org\/planet)\/[^/]+\//, '$1/_/');

function lon2x(lon, z) { return Math.floor((lon + 180) / 360 * 2 ** z); }
function lat2y(lat, z) { const r = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); }
export function tilesFor(b, zmin = 0, zmax = 14) {
  const out = [];
  for (let z = zmin; z <= zmax; z++) {
    // clamp to the tile grid: tiles outside coverage (beyond the antimeridian or ±85°) would only 404
    const n = 2 ** z - 1, cl = v => Math.max(0, Math.min(n, v));
    const x0 = cl(lon2x(b.getWest(), z)), x1 = cl(lon2x(b.getEast(), z)), y0 = cl(lat2y(b.getNorth(), z)), y1 = cl(lat2y(b.getSouth(), z));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  }
  return out;
}

// Typical OpenFreeMap vector tile size per zoom (KB, decoded, measured 2026-11 over Syria: Damascus, Aleppo, Homs,
// Latakia, desert). Low zooms are planet-wide tiles and large; the estimate is "approx." by design.
const TILE_KB = [80, 220, 1500, 1200, 900, 450, 250, 170, 130, 100, 70, 50, 50, 45, 110];
const EXTRAS_KB = 2100; // glyph ranges (Noto Sans Regular + Bold, Latin + Arabic) + sprites, once per download
export const estimateBytes = tiles => (tiles.reduce((s, [z]) => s + (TILE_KB[z] ?? 60), 0) + EXTRAS_KB) * 1024;
// font stacks used by the style; text-font may be an expression (["step", ["zoom"], ["literal", [...]], …])
export function fontStacks(layers) {
  const out = new Set(['Noto Sans Regular', 'Noto Sans Bold']);
  const walk = f => {
    if (!Array.isArray(f)) return;
    if (f.length && f.every(x => typeof x === 'string')) { if (!['step', 'match', 'case', 'coalesce', 'interpolate', 'literal', 'get', 'zoom'].includes(f[0])) out.add(f.join(',')); return; }
    f.forEach(walk);
  };
  layers.forEach(l => walk(l.layout?.['text-font']));
  return out;
}

function vectorTemplate() {
  const src = App.map.getSource('openmaptiles');
  return src?.tiles?.[0] || null;
}

export async function openOfflinePanel() {
  let tiles = tilesFor(App.map.getBounds(), 0, 14), busy = false;
  const areas = lsGet('kh.areas', []);
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = `${fmtBytes(e.usage || 0)} / ${fmtBytes(e.quota || 0)}`; } catch {}
  const body = openSheet(`
    <div class="sec"><h2 class="ptitle" style="font-size:20px">${t('offlineMaps')}</h2><p class="psub" id="oEst"></p></div>
    <div class="shead">${t('cities')}</div>
    <p class="psub" style="padding-inline:16px;margin:0 0 4px">${t('citiesHint')}</p>
    <div class="list" id="oCities">${CITIES.map(cityRow).join('')}</div>
    <div class="actions"><button class="act primary" id="oDl">${ic('download')}${t('downloadArea')}</button></div>
    <div class="sec hidden" id="oBig"><p class="psub" style="color:var(--red)"></p></div>
    <div class="sec hidden" id="oProg"><div class="prog"><i></i></div><p class="psub" id="oTxt"></p></div>
    <div class="shead">${t('offlineAreas')}</div>
    <div class="list">${areas.map((a, i) => `<div class="srow" data-i="${i}"><div class="sic">${ic('map')}</div><div class="st"><div class="t1">${esc(a.name)}</div><div class="t2">${nf(a.n)} · ${fmtBytes(a.bytes)} · ${new Date(a.date).toLocaleDateString()}</div></div></div>`).join('') || `<div class="srow muted">—</div>`}</div>
    <div class="prow">${ic('info')}<div class="pv"><small>${t('storage')}: ${usage}</small><small>${t('ofmPolicy', { m: nf(MAX_TILES), a: nf(4), c: nf(CONCURRENCY) })}</small><small>© OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors</small></div></div>
    <div class="actions"><button class="act" id="oClear">${ic('trash')}${t('clearCache')}</button></div>`, 'half');
  // estimate, button and size warning follow the map while the sheet is open (pan/zoom to pick the area)
  const est = body.querySelector('#oEst'), btn = body.querySelector('#oDl'), big = body.querySelector('#oBig');
  const refresh = () => {
    if (!body.isConnected) { App.map.off('moveend', onMove); return; }
    if (busy) return;
    tiles = tilesFor(App.map.getBounds(), 0, 14);
    const tooBig = tiles.length > MAX_TILES;
    est.textContent = t('estimate', { n: nf(tiles.length), s: fmtBytes(estimateBytes(tiles)) });
    btn.disabled = tooBig; btn.style.opacity = tooBig ? '.5' : '';
    big.classList.toggle('hidden', !tooBig); big.firstElementChild.textContent = tooBig ? t('tooBig', { n: nf(tiles.length), m: nf(MAX_TILES) }) : '';
  };
  const onMove = () => refresh();
  refresh(); App.map.on('moveend', onMove);
  btn.onclick = async () => { if (busy || tiles.length > MAX_TILES) return; busy = true; btn.disabled = true; try { await download(tiles, body); } finally { busy = false; App.map.off('moveend', onMove); } };
  body.querySelector('#oClear').onclick = async () => { cityJob?.ctl.abort(); for (const c of CITIES) await caches.delete(CITY_CACHE + c.id); lsSet('kh.cities', {}); await caches.delete('kh-offline'); await caches.delete('kh-tiles'); lsSet('kh.areas', []); toast('OK'); openOfflinePanel(); };
  wireCities(body);
  body.querySelector('.list:not(#oCities)').onclick = e => { const r = e.target.closest('[data-i]'); if (r) { const a = areas[+r.dataset.i]; App.map.fitBounds(a.bbox, { duration: 600 }); } };
}

async function download(tiles, body) {
  const tpl = vectorTemplate(); if (!tpl) return;
  try { await navigator.storage?.persist?.(); } catch {}
  const cache = await caches.open('kh-offline');
  const urls = tiles.map(([z, x, y]) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  // glyph ranges for Latin + Arabic + sprites
  const style = App.map.getStyle();
  const fonts = fontStacks(style.layers);
  const ranges = ['0-255', '256-511', '1536-1791', '1792-2047', '64256-64511', '64512-64767', '64768-65023', '65024-65279', '8192-8447'];
  const extras = [];
  fonts.forEach(f => ranges.forEach(r => extras.push(style.glyphs.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', r))));
  const sp = typeof style.sprite === 'string' ? style.sprite : style.sprite?.[0]?.url;
  if (sp) ['.json', '.png', '@2x.json', '@2x.png'].forEach(s => extras.push(sp + s));
  const all = [...urls, ...extras];
  const prog = body.querySelector('#oProg'); prog.classList.remove('hidden');
  const bar = prog.querySelector('i'), txt = prog.querySelector('#oTxt');
  let done = 0, bytes = 0, fail = 0, empty = 0, i = 0;
  const worker = async () => {
    while (i < all.length) {
      const u = all[i++];
      const key = tileKey(u);
      try {
        if (await cache.match(key)) { done++; continue; }
        const r = await fetch(u, { mode: 'cors', credentials: 'omit' });
        if (r.ok) { const blob = await r.blob(); bytes += blob.size; await cache.put(key, new Response(blob, { headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream', 'x-kh-date': String(Date.now()) } })); }
        else if (r.status === 404 || r.status === 204) empty++; // no data there (outside coverage / empty sea): skip quietly, no retry
        else fail++;
      } catch { fail++; await sleep(300); }
      done++;
      if (done % 10 === 0 || done === all.length) { bar.style.width = (done / all.length * 100) + '%'; txt.textContent = t('downloading', { a: nf(Math.min(done, urls.length)), b: nf(urls.length) }); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  // POI data, fonts and sprites live in the service worker's runtime cache: make sure they are loaded and stored too
  // (the success message waits until the worker has stored them)
  try { await loadPois(); await App.warmFonts?.(); } catch {}
  const b = App.map.getBounds();
  const c = App.map.getCenter();
  let name = `${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`;
  try { const { nominatim } = await import('./util.js'); const j = await nominatim(`reverse?lat=${c.lat}&lon=${c.lng}&format=jsonv2&zoom=12&accept-language=${document.documentElement.lang}`); if (j.name || j.display_name) name = j.name || j.display_name.split(',')[0]; } catch {}
  const areas = lsGet('kh.areas', []); areas.unshift({ name, bbox: [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], n: urls.length, bytes, date: Date.now() }); lsSet('kh.areas', areas.slice(0, 30));
  track('offline_download', { tiles: urls.length, kb: Math.round(bytes / 1024), ...(empty ? { empty } : {}), ...(fail ? { fail } : {}) });
  toast(t('downloaded', { n: nf(urls.length), s: fmtBytes(bytes) }), 4000);
  openOfflinePanel();
}

// ----- whole-city packs (Damascus, Aleppo, Homs) -----
let cityJob = null; // { id, ctl } – one city at a time keeps the load on OpenFreeMap and on low-end phones small
const cityRow = c => {
  const st = lsGet('kh.cities', {})[c.id], busy = cityJob?.id === c.id;
  const sub = busy ? t('loading') : st ? t('citySaved', { s: fmtBytes(st.bytes) }) + ' · ' + new Date(st.date).toLocaleDateString(getLang()) : t('cityApprox', { s: fmtBytes(estimateCityBytes(c)) });
  const btn = busy ? `<button class="act" data-cancel="${c.id}">${t('cancel')}</button>`
    : st ? `<button class="act" data-del="${c.id}" aria-label="${t('cityDel')} ${esc(cityName(c, getLang()))}">${ic('trash')}${t('cityDel')}</button>`
    : `<button class="act primary" data-dl="${c.id}"${cityJob ? ' disabled style="opacity:.5"' : ''}>${ic('download')}${t('cityDl')}</button>`;
  return `<div class="srow city" data-city="${c.id}"><div class="sic">${ic('map')}</div><div class="st"><div class="t1">${esc(cityName(c, getLang()))}</div><div class="t2">${sub}</div>${busy ? '<div class="prog"><i></i></div>' : ''}</div>${btn}</div>`;
};
function rerenderCities(body) { const l = body.querySelector('#oCities'); if (l) l.innerHTML = CITIES.map(cityRow).join(''); }
function wireCities(body) {
  body.querySelector('#oCities').onclick = async e => {
    const b = e.target.closest('button'); if (!b) { const r = e.target.closest('[data-city]'); const c = r && cityById(r.dataset.city); if (c) App.map.fitBounds([[c.bbox[0], c.bbox[1]], [c.bbox[2], c.bbox[3]]], { duration: 600 }); return; }
    e.stopPropagation();
    if (b.dataset.cancel) { cityJob?.ctl.abort(); return; }
    if (b.dataset.del) { const c = cityById(b.dataset.del); await purgeCity(caches, c.id, cityKeys(c)); const s = lsGet('kh.cities', {}); delete s[c.id]; lsSet('kh.cities', s); toast(t('cityDeleted', { c: cityName(c, getLang()) })); rerenderCities(body); return; }
    if (b.dataset.dl && !cityJob) await downloadCity(cityById(b.dataset.dl), body);
  };
}
const cityKeys = c => { const tpl = vectorTemplate(); return tpl ? cityTiles(c).map(x => tileKey(tileUrl(tpl, x))) : []; };
function cityExtras() {
  const style = App.map.getStyle(), out = ['https://tiles.openfreemap.org/planet'];
  const ranges = ['0-255', '256-511', '1536-1791', '1792-2047', '64256-64511', '64512-64767', '64768-65023', '65024-65279', '8192-8447'];
  if (style.glyphs) fontStacks(style.layers).forEach(f => ranges.forEach(r => out.push(style.glyphs.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', r))));
  const sp = typeof style.sprite === 'string' ? style.sprite : style.sprite?.[0]?.url;
  if (sp && /^https:\/\/tiles\.openfreemap\.org\//.test(sp)) ['.json', '.png', '@2x.json', '@2x.png'].forEach(s => out.push(sp + s));
  return out;
}
// Servis/bus lines for this city (if OSM has any) go into the SW's kh-transit cache, so the Lines layer works offline too.
export async function cacheTransit(id, cacheApi = globalThis.caches, fetchFn = fetch) {
  if (!TRANSIT_CITIES.includes(id) || !cacheApi) return false;
  try {
    const c = await cacheApi.open('kh-transit');
    for (const f of ['index.json', id + '.json']) {
      const u = new URL(TRANSIT_DIR + f, location.href).href, r = await fetchFn(u, { cache: 'no-cache' });
      if (r.ok) await c.put(u, r.clone());
    }
    return true;
  } catch { return false; }
}
export async function downloadCity(city, body) {
  const tpl = vectorTemplate(); if (!tpl || !city) return;
  const need = estimateCityBytes(city);
  try { const est = await navigator.storage?.estimate?.(); if (!quotaOk(est, need)) { toast(t('quotaLow', { s: fmtBytes(need), f: fmtBytes(Math.max(0, (est.quota || 0) - (est.usage || 0))) }), 5000); return; } } catch {}
  try { await navigator.storage?.persist?.(); } catch {}
  const ctl = new AbortController(); cityJob = { id: city.id, ctl }; rerenderCities(body);
  const cache = await caches.open(CITY_CACHE + city.id);
  const urls = [...cityTiles(city).map(x => tileUrl(tpl, x)), ...cityExtras()];
  let last = 0;
  const res = await downloadAll(urls, { fetchFn: fetch, cache, keyOf: tileKey, signal: ctl.signal, onProgress: (d, n) => {
    const now = Date.now(); if (now - last < 250 && d < n) return; last = now; // few DOM writes: smooth on low-end Android
    const row = body.querySelector(`[data-city="${city.id}"]`); if (!row) return;
    row.querySelector('.prog i')?.style.setProperty('width', (d / n * 100) + '%'); const t2 = row.querySelector('.t2'); if (t2) t2.textContent = t('downloading', { a: nf(d), b: nf(n) });
  } });
  cityJob = null;
  if (!res.aborted) await cacheTransit(city.id);
  if (res.aborted) { await purgeCity(caches, city.id, cityKeys(city)); toast(t('cityCancelled')); }
  else {
    let bytes = 0; try { for (const k of await cache.keys()) { const r = await cache.match(k); bytes += +(r.headers.get('content-length')) || (await r.blob()).size; } } catch { bytes = res.bytes; }
    const s = lsGet('kh.cities', {}); s[city.id] = { bytes, date: Date.now(), fail: res.fail }; lsSet('kh.cities', s);
    track('offline_city', { city: city.id, kb: Math.round(bytes / 1024), ...(res.fail ? { fail: res.fail } : {}) });
    toast(t('cityDone', { c: cityName(city, getLang()), s: fmtBytes(bytes) }), 4000);
  }
  if (body.isConnected) rerenderCities(body);
}
