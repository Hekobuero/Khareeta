// Rewrites the OpenMapTiles POI layers in map-style-{light,dark}.json for worldwide POIs (idempotent).
// Usage: node tools/poi/style-poi.mjs
//   poi-dot  z14–15  rank ≤ 10, badges without labels
//   poi-z15  z15–16  rank ≤ 25, labels
//   poi      z16+    all named POIs, labels
// OpenMapTiles has all named POIs in z14 (overzoomed above), so this adds no tile requests.
// Inside SY_BBOX our own GeoJSON (data/poi, js/poi.js) is authoritative → tile POIs are filtered out there (no double labels).
import fs from 'node:fs';
import path from 'node:path';
import { SY_BBOX } from '../../js/world-core.js';
import { labelExpression } from '../../js/names.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const [W, S, E, N] = SY_BBOX;
export const SY_POLY = { type: 'Polygon', coordinates: [[[W, S], [E, S], [E, N], [W, N], [W, S]]] };
const TRANSIT = ['bus', 'railway', 'airport', 'aerialway', 'ferry_terminal'];
// street furniture / clutter that sometimes carries a name in OSM
export const JUNK = ['bicycle_parking', 'bollard', 'waste_basket', 'gate', 'lift_gate', 'entrance', 'recycling', 'shelter', 'bench', 'vending_machine', 'cycle_barrier', 'bicycle_rental', 'parcel_locker', 'post_box', 'brownfield', 'construction'];
export const BANDS = [
  { id: 'poi-dot', minzoom: 14, maxzoom: 15, rank: 10, label: false, size: 0.72 },
  { id: 'poi-z15', minzoom: 15, maxzoom: 16, rank: 25, label: true, size: 0.82 },
  { id: 'poi', minzoom: 16, rank: null, label: true, size: null },
];
export function baseFilter(band) {
  const f = ['all',
    ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
    ['has', 'name'],
    ['!', ['match', ['get', 'class'], [...TRANSIT, ...JUNK], true, false]],
    ['!', ['within', SY_POLY]],
  ];
  if (band.rank != null) f.push(['<=', ['get', 'rank'], band.rank]);
  // below z16 only government offices from class=office (companies, NGOs … are clutter)
  if (band.minzoom < 16) f.push(['any', ['!=', ['get', 'class'], 'office'], ['match', ['get', 'subclass'], ['government', 'diplomatic'], true, false]]);
  return f;
}
/** icon: specific badges first (office, worship by religion, clinic), then the existing subclass/class match */
export function iconExpr(old) {
  return ['case',
    ['==', ['get', 'class'], 'office'], ['match', ['get', 'subclass'], 'government', 'government', 'diplomatic', 'embassy', 'generic'],
    ['==', ['get', 'class'], 'place_of_worship'], ['match', ['get', 'subclass'], 'muslim', 'mosque', 'christian', 'church', 'worship'],
    ['all', ['==', ['get', 'class'], 'hospital'], ['==', ['get', 'subclass'], 'clinic']], 'doctor',
    old];
}
function unwrap(e) { return Array.isArray(e) && e[0] === 'case' && e[1]?.[2] === 'office' ? e[e.length - 1] : e; }
export function patch(style) {
  const L = style.layers, iPoi = L.findIndex(l => l.id === 'poi');
  if (iPoi < 0) throw new Error('no poi layer');
  const tpl = L[iPoi];
  const oldIcon = unwrap(tpl.layout['icon-image']);
  const out = BANDS.map(b => {
    const l = JSON.parse(JSON.stringify(tpl));
    l.id = b.id; l.minzoom = b.minzoom; if (b.maxzoom) l.maxzoom = b.maxzoom; else delete l.maxzoom;
    l.filter = baseFilter(b);
    l.layout['icon-image'] = iconExpr(oldIcon);
    l.layout['icon-size'] = b.size ? b.size : ['interpolate', ['linear'], ['zoom'], 16, 0.9, 18, 1];
    l.layout['symbol-sort-key'] = ['get', 'rank'];
    l.layout['icon-padding'] = b.label ? 4 : 2;
    if (b.label) {
      l.layout['text-field'] = labelExpression('en'); // applyMapLanguage() swaps in the UI language (AR: name:ar → name …)
      l.layout['text-size'] = b.minzoom === 15 ? 11.5 : 12;
      l.metadata = { 'khareeta:label': true };
    } else {
      for (const k of Object.keys(l.layout)) if (k.startsWith('text-')) delete l.layout[k];
      for (const k of Object.keys(l.paint)) if (k.startsWith('text-')) delete l.paint[k];
      delete l.metadata;
    }
    return l;
  });
  const rest = L.filter(l => !BANDS.some(b => b.id === l.id));
  const at = rest.findIndex((l, i) => i >= 0 && L.indexOf(l) > iPoi) ; // first layer after the old poi
  rest.splice(at < 0 ? rest.length : at, 0, ...out);
  style.layers = rest;
  return style;
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  for (const t of ['light', 'dark']) {
    const f = path.join(ROOT, `map-style-${t}.json`);
    const raw = fs.readFileSync(f, 'utf8');
    const s = patch(JSON.parse(raw));
    fs.writeFileSync(f, JSON.stringify(s, null, raw.startsWith('{\n ') ? (raw[3] === ' ' ? 2 : 1) : 0) + (raw.endsWith('\n') ? '\n' : ''));
    console.log(t, s.layers.filter(l => l['source-layer'] === 'poi').map(l => `${l.id}@${l.minzoom}`).join(' '));
  }
}
