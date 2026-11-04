// Transit lines (Servis / microbus / bus) – pure helpers, no DOM / map (unit-tested in tests/transit).
// Data: data/transit/<city>.json, built from OpenStreetMap by scripts/transit/build_transit.py (ODbL).
export const TRANSIT_DIR = 'data/transit/';
export const TRANSIT_CITIES = ['damascus', 'aleppo'];
export const OSM_WIKI_URL = 'https://wiki.openstreetmap.org/wiki/Public_transport';
export const OSM_EDIT_URL = 'https://www.openstreetmap.org/edit';

// Arabic/Latin search normalisation: strip tashkeel/tatweel, unify alef/yeh/teh-marbuta, lower-case, fold digits
export function normT(s) {
  return String(s || '').toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0))
    .replace(/[\s\-–_/.,:;()]+/g, ' ').trim();
}
// display name of a line or stop for a UI language: ar → name:ar first; en/de → name:en first
export function tName(o, lang) {
  if (!o) return '';
  const ar = o.name_ar, en = o.name_en, n = o.name;
  return (lang === 'ar' ? ar || n || en : en || n || ar) || '';
}
export function tAlt(o, lang) { // the other script, when different
  const p = tName(o, lang), q = lang === 'ar' ? (o.name_en || o.name) : (o.name_ar || o.name);
  return q && q !== p ? q : '';
}
export function lineLabel(l, lang) {
  const n = tName(l, lang);
  if (n) return n;
  if (l.from || l.to) return [l.from, l.to].filter(Boolean).join(' → ');
  return l.ref ? String(l.ref) : '#' + l.id;
}
// search lines by ref / names / from / to / operator / served stop names
export function searchLines(data, q) {
  const lines = data?.lines || [];
  const n = normT(q); if (!n) return lines.slice();
  const words = n.split(' ');
  const hay = l => normT([l.ref, l.name, l.name_ar, l.name_en, l.from, l.to, l.operator, ...(l.stops || []).map(i => { const s = data.stops[i]; return s && [s.name, s.name_ar, s.name_en].join(' '); })].filter(Boolean).join(' '));
  return lines.map(l => [l, hay(l)]).filter(([, h]) => words.every(w => h.includes(w)))
    .map(([l, h]) => [l, (normT(l.ref) === n ? 0 : 1) + (normT(tName(l, 'ar') + ' ' + tName(l, 'en')).includes(n) ? 0 : 1)])
    .sort((a, b) => a[1] - b[1]).map(([l]) => l);
}
export function sortLines(lines) {
  const key = l => String(l.ref || l.name || l.name_ar || l.name_en || '');
  // named/numbered lines first (alphabetical, numeric-aware); unnamed OSM relations last
  return lines.slice().sort((a, b) => (!key(a)) - (!key(b)) || key(a).localeCompare(key(b), 'ar', { numeric: true }));
}
// stop index → lines serving it
export function linesAtStop(data, stopIdx) { return (data?.lines || []).filter(l => (l.stops || []).includes(stopIdx)); }
export function stopCounts(data) {
  const c = new Array((data?.stops || []).length).fill(0);
  for (const l of data?.lines || []) for (const i of l.stops || []) c[i]++;
  return c;
}
// GeoJSON for the map
export function linesGeoJSON(data) {
  return { type: 'FeatureCollection', features: (data?.lines || []).filter(l => l.geom?.length).map(l => ({ type: 'Feature', id: l.id, properties: { id: l.id, mode: l.mode || 'bus' }, geometry: { type: 'MultiLineString', coordinates: l.geom } })) };
}
export function stopsGeoJSON(data, only) {
  const c = stopCounts(data);
  return { type: 'FeatureCollection', features: (data?.stops || []).map((s, i) => [s, i]).filter(([, i]) => (only ? only.includes(i) : c[i] > 0))
    .map(([s, i]) => ({ type: 'Feature', properties: { i, n: c[i] }, geometry: { type: 'Point', coordinates: s.c } })) };
}
export function lineBounds(l, data) {
  let w = 180, s = 90, e = -180, n = -90;
  const add = ([x, y]) => { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; };
  for (const g of l.geom || []) g.forEach(add);
  for (const i of l.stops || []) if (data?.stops?.[i]) add(data.stops[i].c);
  return w <= e ? [[w, s], [e, n]] : null;
}
// which city's data to show for a map centre: nearest bbox (within ~30 km), else null
export function cityFor(lng, lat, index) {
  let best = null, bd = Infinity;
  for (const [k, c] of Object.entries(index?.cities || {})) {
    const b = c.bbox; if (!b) continue;
    const dx = Math.max(b[0] - lng, 0, lng - b[2]), dy = Math.max(b[1] - lat, 0, lat - b[3]), d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = k; }
  }
  return bd <= 0.3 ? best : null;
}
// osm link for a relation / node
export const osmUrl = (type, id) => `https://www.openstreetmap.org/${type}/${+id}`;
