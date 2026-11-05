// Saved places (favourites) – pure CRUD over a Storage-like object (localStorage in the app, a Map in tests).
// Local only: no account, no server. Export/import as a JSON file. Kinds: 'fav' | 'home' | 'work' (home/work unique).
export const KEY = 'kh.saved';
export const KINDS = ['fav', 'home', 'work'];
export const MAX = 500, MAX_NAME = 120;
const fin = v => typeof v === 'number' && Number.isFinite(v);
const clip = (s, n = MAX_NAME) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
export const coordId = (lat, lon) => `c:${(+lat).toFixed(5)},${(+lon).toFixed(5)}`;
const SLIM = ['name', 'name:ar', 'name:en', 'amenity', 'shop', 'tourism', 'place', 'historic', 'leisure', 'religion', 'opening_hours', 'phone', 'contact:phone', 'website', 'addr:street', 'addr:housenumber', 'addr:city', 'cuisine'];
export function slimTags(tg = {}) { const o = {}; for (const k of SLIM) if (tg && typeof tg[k] === 'string') o[k] = tg[k].slice(0, 200); return o; }

// one valid record or null
export function clean(x) {
  if (!x || typeof x !== 'object') return null;
  const lat = +x.lat, lon = +x.lon;
  if (!fin(lat) || !fin(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const r = { id: clip(x.id || coordId(lat, lon), 80), name: clip(x.name) || clip(x.label) || coordId(lat, lon).slice(2), lat, lon, kind: KINDS.includes(x.kind) ? x.kind : 'fav' };
  if (x.label && clip(x.label)) r.label = clip(x.label);
  if (x.sub) r.sub = clip(x.sub, 200);
  if (['node', 'way', 'relation'].includes(x.osm_type)) r.osm_type = x.osm_type;
  if (x.osm_id != null && /^\d+$/.test(String(x.osm_id))) r.osm_id = +x.osm_id;
  if (x.tags) r.tags = slimTags(x.tags);
  for (const k of ['coord', 'ov', 'full']) if (x[k]) r[k] = true;
  for (const k of ['ovId', 'ovCat']) if (typeof x[k] === 'string') r[k] = x[k].slice(0, 80);
  r.t = fin(+x.t) && +x.t > 0 ? +x.t : Date.now();
  return r;
}
export function load(st) {
  let v; try { v = JSON.parse(st.getItem(KEY) || '[]'); } catch { v = []; }
  return Array.isArray(v) ? v.map(clean).filter(Boolean) : [];
}
export function store(st, list) { try { st.setItem(KEY, JSON.stringify(list.slice(0, MAX))); return true; } catch { return false; } }
export const displayName = s => s.label || s.name;
export function find(list, id, kind) { return list.find(s => s.id === id && (!kind || s.kind === kind)); }
export function isSaved(st, id) { return load(st).some(s => s.id === id); }

// add (or move to the top); home/work replace the previous home/work
export function add(st, item, { kind = 'fav', label } = {}) {
  const r = clean({ ...item, kind, label: label ?? item.label, t: Date.now() }); if (!r) return null;
  let list = load(st).filter(s => !(s.id === r.id && s.kind === r.kind));
  if (kind !== 'fav') list = list.filter(s => s.kind !== kind);
  list.unshift(r); store(st, list); return r;
}
export function remove(st, id, kind) { const list = load(st); const n = list.filter(s => !(s.id === id && (!kind || s.kind === kind))); store(st, n); return n.length !== list.length; }
// toggle a favourite; returns true when it is saved afterwards
export function toggle(st, item) { if (find(load(st), item.id || coordId(item.lat, item.lon), 'fav')) { remove(st, item.id || coordId(item.lat, item.lon), 'fav'); return false; } return !!add(st, item); }
// rename / relabel / change kind. patch: { label?, kind? }  (label '' = back to the original name)
export function update(st, id, kind, patch = {}) {
  const list = load(st), cur = list.find(s => s.id === id && s.kind === kind); if (!cur) return null;
  const r = { ...cur };
  if ('label' in patch) { const l = clip(patch.label); if (l && l !== r.name) r.label = l; else delete r.label; }
  if (patch.kind && KINDS.includes(patch.kind)) r.kind = patch.kind;
  // drop the old record, a duplicate with the same id+kind, and (for home/work) the previous home/work
  const rest = list.filter(s => s !== cur && !(s.id === r.id && s.kind === r.kind) && (r.kind === 'fav' || s.kind !== r.kind));
  rest.splice(Math.min(list.indexOf(cur), rest.length), 0, r);
  store(st, rest); return r;
}
// sort for the list: home, work, then newest favourites
export function sorted(list) { const o = { home: 0, work: 1, fav: 2 }; return [...list].sort((a, b) => o[a.kind] - o[b.kind] || b.t - a.t); }

// ---------- export / import ----------
export function exportJson(list, now = new Date()) {
  return JSON.stringify({ app: 'khareeta', type: 'saved-places', v: 1, exported: now.toISOString(), places: list.map(clean).filter(Boolean) }, null, 1);
}
// merge an exported file into the list; returns { list, added, updated, skipped } or throws Error('format')
export function importJson(text, list) {
  let j; try { j = JSON.parse(text); } catch { throw new Error('format'); }
  const arr = Array.isArray(j) ? j : j && j.type === 'saved-places' && Array.isArray(j.places) ? j.places : null;
  if (!arr) throw new Error('format');
  let out = list.map(clean).filter(Boolean), added = 0, updated = 0, skipped = 0;
  for (const x of arr.slice(0, MAX)) {
    const r = clean(x); if (!r) { skipped++; continue; }
    const i = out.findIndex(s => s.id === r.id && s.kind === r.kind);
    if (i >= 0) { out[i] = { ...out[i], ...r }; updated++; continue; }
    if (r.kind !== 'fav') out = out.filter(s => s.kind !== r.kind);
    out.push(r); added++;
  }
  return { list: out.slice(0, MAX), added, updated, skipped };
}
