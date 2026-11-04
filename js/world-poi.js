// On-demand POIs outside Syria: Overpass (key-free) for the visible area, debounced, rate-limited, only from
// WORLD_MIN_ZOOM, cached per ~2 km cell in memory and (GET requests) in the service worker cache kh-wpoi (size-limited).
// Syria keeps using the bundled offline extract (poi.js); cells fully inside the Syria box are never fetched.
import { fetchJSON, toast } from './util.js';
import { t } from './i18n.js';
import { poiLayerSpec, poiCatFor } from './poi.js';
import { WORLD_MIN_ZOOM, DEBOUNCE, cellsFor, cellsBox, worldQuery, overpassGetUrl, elementToFeature, rateWait, CellCache, splitByCell, viewInSyria } from './world-core.js';

export const WLAYERS = ['kh-wpoi-1', 'kh-wpoi-2', 'kh-wpoi-3'];
const cache = new CellCache();
let map = null, timer = 0, last = 0, busy = false, ep = 0, hinted = false, enabled = true;

function view() { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }
export function addWorldLayers(m, dark) {
  if (m.getSource('kh-wpoi')) return;
  m.addSource('kh-wpoi', { type: 'geojson', data: { type: 'FeatureCollection', features: cache.features() }, buffer: 32, maxzoom: 16 });
  const before = m.getLayer('poi-transit') ? 'poi-transit' : m.getLayer('label-airport') ? 'label-airport' : undefined;
  const lay = poiLayerSpec(m, dark, 'kh-wpoi');
  m.addLayer(lay('kh-wpoi-1', WORLD_MIN_ZOOM, ['>=', ['get', 'imp'], 3], 0.8, WORLD_MIN_ZOOM), before);
  m.addLayer(lay('kh-wpoi-2', WORLD_MIN_ZOOM, ['==', ['get', 'imp'], 2], 0.8, 15), before);
  m.addLayer(lay('kh-wpoi-3', 15, ['<=', ['get', 'imp'], 1], 0.85, 16), before);
  if (!enabled) setWorldVisible(m, false);
}
export function setWorldVisible(m, on) { enabled = on; for (const id of WLAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); }
async function fetchCells(cells) {
  const q = worldQuery(cellsBox(cells));
  for (let i = 0; i < 3; i++) {
    try { const j = await fetchJSON(overpassGetUrl(q, ep + i), {}, 20000); if (!j || !Array.isArray(j.elements)) throw new Error('bad'); ep = (ep + i) % 3; return j.elements; }
    catch (e) { if (i === 2) throw e; }
  }
}
async function update() {
  if (!map || !enabled || !navigator.onLine) return;
  const z = map.getZoom(), v = view();
  if (viewInSyria(v)) return;
  if (z < WORLD_MIN_ZOOM) { if (!hinted && z >= 10) { hinted = true; toast(t('worldPoiZoom'), 3500); } return; }
  const cells = cellsFor(v).filter(c => !cache.has(c.key));
  if (!cells.length || busy) return;
  const wait = rateWait(last, Date.now());
  if (wait) { clearTimeout(timer); timer = setTimeout(update, wait); return; }
  busy = true; last = Date.now();
  try {
    const els = await fetchCells(cells);
    const by = splitByCell(els.map(el => elementToFeature(el, poiCatFor)).filter(Boolean));
    for (const c of cells) cache.set(c.key, by.get(c.key) || []);
    map.getSource('kh-wpoi')?.setData({ type: 'FeatureCollection', features: cache.features() });
  } catch { toast(t('worldPoiBusy')); }
  finally { busy = false; }
  if (cellsFor(view()).some(c => !cache.has(c.key))) { clearTimeout(timer); timer = setTimeout(update, DEBOUNCE); }
}
export function initWorldPois(m) {
  map = m;
  m.on('moveend', () => { clearTimeout(timer); timer = setTimeout(update, DEBOUNCE); });
  addEventListener('online', () => { clearTimeout(timer); timer = setTimeout(update, DEBOUNCE); });
  timer = setTimeout(update, DEBOUNCE);
}
