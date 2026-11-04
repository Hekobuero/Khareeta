// Optional "Shops (Overture, unverified)" layer. OSM (js/poi.js) stays primary; this is a muted hollow-dot layer under it.
// Lazy: nothing is fetched until the layer is on, zoom >= 14 and the view touches Syria; then only the 0.1° tiles in view.
import { OV_DIR, OV_MINZOOM, tilesFor, ovActive, ovFeature, ovItem, ovHidden } from './overture-data.js';

const GROUP = {
  light: { food: '#A84F04', shopping: '#8F3B7A', lodging: '#5B43B8', health: '#B8262B', nature: '#1D7342', transport: '#38507D', civic: '#535A63' },
  dark: { food: '#F5A55C', shopping: '#E08FCB', lodging: '#B3A3F0', health: '#F58A8D', nature: '#6FCB93', transport: '#9DB4DA', civic: '#B4BBC3' },
};
export const OV_LAYERS = ['kh-ov-dot', 'kh-ov-label'];
const S = { index: null, idx: null, tiles: new Map(), rows: [], keys: [], pending: new Set(), on: false };

function loadIndex() {
  return S.idx ||= fetch(OV_DIR + 'index.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(j => (S.index = j)).catch(e => { S.idx = null; throw e; });
}
function loadTile(key) {
  if (S.tiles.has(key) || S.pending.has(key)) return Promise.resolve();
  S.pending.add(key);
  return fetch(`${OV_DIR}t${key}.json?v=${S.index.dv}`).then(r => r.ok ? r.json() : { f: [] }).then(j => S.tiles.set(key, j.f || []))
    .catch(() => {}).finally(() => S.pending.delete(key));
}
function rebuild(map) {
  const src = map.getSource('kh-ov'); if (!src) return;
  S.rows = []; S.keys = []; const hid = ovHidden();
  for (const [k, rs] of S.tiles) for (const r of rs) if (!hid.has(r[2])) { S.rows.push(r); S.keys.push(k); }
  src.setData({ type: 'FeatureCollection', features: S.rows.map((r, i) => ovFeature(r, S.index, i)) });
}
export function addOvLayers(map, dark) {
  if (map.getSource('kh-ov')) return;
  map.addSource('kh-ov', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: '' });
  const before = ['kh-poi-1', 'kh-poi-2', 'kh-poi-3', 'kh-poi-0', 'kh-poi-f', 'poi-transit'].find(id => map.getLayer(id));
  const g = GROUP[dark ? 'dark' : 'light'], col = ['match', ['get', 'g'], ...Object.entries(g).flat(), g.civic];
  const vis = S.on ? 'visible' : 'none';
  map.addLayer({ id: 'kh-ov-dot', type: 'circle', source: 'kh-ov', minzoom: OV_MINZOOM, layout: { visibility: vis },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3.5, 17, 6], 'circle-color': dark ? '#1C1C1E' : '#FFFFFF',
      'circle-stroke-color': col, 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 14, 1.5, 17, 2.2], 'circle-opacity': 0.9, 'circle-stroke-opacity': 0.85 } }, before);
  map.addLayer({ id: 'kh-ov-label', type: 'symbol', source: 'kh-ov', minzoom: 16.5, metadata: { 'khareeta:label': true }, layout: { visibility: vis,
    'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 8, 'text-variable-anchor': ['left', 'right', 'top'],
    'text-radial-offset': 0.8, 'text-optional': true, 'text-padding': 4 },
    paint: { 'text-color': col, 'text-halo-color': dark ? 'rgba(28,28,30,0.92)' : 'rgba(244,242,238,0.92)', 'text-halo-width': 1.4, 'text-opacity': 0.85 } }, before);
  if (S.index) rebuild(map);
}
// called on moveend / toggle: shows/hides the layers, fetches missing tiles in view; onState(visible) drives the attribution line
export function syncOverture(map, on, onState) {
  const b = map.getBounds(), bounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const act = ovActive(on, map.getZoom(), bounds);
  if (act !== S.on) { S.on = act; for (const id of OV_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', act ? 'visible' : 'none'); }
  onState?.(act);
  if (!act) return;
  loadIndex().then(() => {
    const need = tilesFor(bounds, S.index).filter(k => !S.tiles.has(k));
    if (need.length) Promise.all(need.map(loadTile)).then(() => rebuild(map));
  }).catch(e => console.warn('overture index', e));
}
export function ovItemAt(i) { const r = S.rows[i]; return r ? ovItem(r, S.index, S.keys[i]) : null; }
export function ovVisible() { return S.on; }
// after a report: drop the hidden place from the map right away
export function ovRefresh(map) { if (S.index) rebuild(map); }
