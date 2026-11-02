// Offline area download (vector tiles + glyphs + sprites) into Cache Storage, respecting the
// OpenFreeMap policy: max 3000 tiles per download, max 4 parallel requests.
import { $, esc, fmtBytes, nf, lsGet, lsSet, toast, sleep } from './util.js';
import { t } from './i18n.js';
import { ic } from './icons.js';
import { App, openSheet } from './core.js';
import { track } from './analytics.js';
import { loadPois } from './poi.js';

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
    <div class="actions"><button class="act primary" id="oDl">${ic('download')}${t('downloadArea')}</button></div>
    <div class="sec hidden" id="oBig"><p class="psub" style="color:var(--red)"></p></div>
    <div class="sec hidden" id="oProg"><div class="prog"><i></i></div><p class="psub" id="oTxt"></p></div>
    <div class="shead">${t('offlineAreas')}</div>
    <div class="list">${areas.map((a, i) => `<div class="srow" data-i="${i}"><div class="sic">${ic('map')}</div><div class="st"><div class="t1">${esc(a.name)}</div><div class="t2">${nf(a.n)} · ${fmtBytes(a.bytes)} · ${new Date(a.date).toLocaleDateString()}</div></div></div>`).join('') || `<div class="srow muted">—</div>`}</div>
    <div class="prow">${ic('info')}<div class="pv"><small>${t('storage')}: ${usage}</small><small>OpenFreeMap: ≤ ${nf(MAX_TILES)} tiles / download, 4 parallel.</small></div></div>
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
  body.querySelector('#oClear').onclick = async () => { await caches.delete('kh-offline'); await caches.delete('kh-tiles'); lsSet('kh.areas', []); toast('OK'); openOfflinePanel(); };
  body.querySelector('.list').onclick = e => { const r = e.target.closest('[data-i]'); if (r) { const a = areas[+r.dataset.i]; App.map.fitBounds(a.bbox, { duration: 600 }); } };
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
