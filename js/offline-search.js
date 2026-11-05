// Local search (works without network): saved places, recent searches and the bundled OSM gazetteer of Syrian
// cities/towns/districts (data/gazetteer-sy.json, precached by sw.js). Searched before Photon/Nominatim.
import { lsGet } from './util.js';
import { t, getLang } from './i18n.js';
import { buildIndex, searchIndex, gazetteerEntries } from './search-core.js';
import { savedList, savedIcon } from './saved.js';

export const GAZ_URL = './data/gazetteer-sy.json';
let gz = null, gzIndex = null;
const idle = () => new Promise(r => (globalThis.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 0)));
export function loadGazetteer() {
  return gz || (gz = fetch(GAZ_URL).then(r => { if (!r.ok) throw new Error('gaz ' + r.status); return r.json(); })
    .then(async j => { await idle(); gzIndex = buildIndex(gazetteerEntries(j)); return gzIndex; })
    .catch(e => { gz = null; throw e; }));
}
const TYPE = { city: 'gzCity', town: 'gzTown', suburb: 'gzDistrict', quarter: 'gzDistrict', neighbourhood: 'gzDistrict', village: 'gzVillage' };
function gzItem(e) {
  const ar = getLang() === 'ar', name = ar ? e.ar : (e.en || e.ar), other = ar ? e.en : (e.en ? e.ar : '');
  return { id: e.id, name, sub: [t(TYPE[e.place] || 'gzVillage'), other].filter(Boolean).join(' · '), lon: e.lon, lat: e.lat, full: true, gz: true, score: e.score,
    tags: { place: e.place, name: e.ar, 'name:ar': e.ar, ...(e.en ? { 'name:en': e.en } : {}) }, icon: ['pin', '#8E8E93'] };
}
// → { mine: saved + recent hits, places: gazetteer hits } (both already in search-item shape)
export async function localSearch(text, { limit = 6, wait = true } = {}) {
  const saved = savedList().map(s => ({ ...s, name: s.label || s.name, alt: s.label ? [s.name] : [], icon: savedIcon(s), kind2: 'saved' }));
  const recent = lsGet('kh.recent', []).map(r => ({ ...r, icon: ['history', '#8E8E93'], kind2: 'recent' }));
  const mine = searchIndex(buildIndex([...saved.map(x => ({ ...x, w: 10 })), ...recent]), text, { limit: 4, minScore: 50 })
    .filter((x, i, a) => a.findIndex(y => y.id === x.id) === i).map(({ score, alt, w, kind2, ...x }) => x);
  if (!gzIndex && wait) { try { await loadGazetteer(); } catch {} }
  const places = gzIndex ? searchIndex(gzIndex, text, { limit }).map(gzItem) : [];
  return { mine, places };
}
