// Shared search ranking (near the map view first, settlements before POIs; worldwide, no country limit) + accessible combobox for search inputs.
// OSM-only: Photon (komoot) – no keys.
import { fetchJSON } from './util.js';

// Query clean-up shared by every search field (main search AND route stops): iOS/Arabic keyboards insert tashkeel,
// tatweel, bidi and zero-width marks that Photon does not match ("قَصْر العَظْم" → "قصر العظم").
export function cleanQuery(q) {
  return String(q || '').normalize('NFC')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u061C\uFEFF]/g, '')
    .replace(/\s+/g, ' ').trim();
}
// Photon language for a UI language – identical for the main search and route stops (Arabic → native names)
export const photonLang = l => (l === 'de' || l === 'en' ? l : 'default');
export const SY_BBOX = [35.6, 32.3, 42.4, 37.4]; // W,S,E,N
const SY_CENTER = [38.5, 35.0];
const SETTLE = ['city', 'town', 'village'];

export function inSyria(lon, lat) { return lon >= SY_BBOX[0] && lon <= SY_BBOX[2] && lat >= SY_BBOX[1] && lat <= SY_BBOX[3]; }
// Bias point for Photon: always the map centre (worldwide); Syria's centre only if no view is known
export function biasPoint(c, z = 7) { return c ? { lon: c[0], lat: c[1], zoom: Math.round(Math.max(6, z)) } : { lon: SY_CENTER[0], lat: SY_CENTER[1], zoom: 7 }; }
// Region around the view used for the "nearby" Photon queries and the ranking tier: the view box, at least ±1.5°
export function biasBox(c, view) {
  const m = 1.5; let [w, s, e, n] = view || (c ? [c[0], c[1], c[0], c[1]] : SY_BBOX);
  const cx = (w + e) / 2, cy = (s + n) / 2;
  w = Math.min(w, cx - m); e = Math.max(e, cx + m); s = Math.min(s, cy - m); n = Math.max(n, cy + m);
  return [Math.max(-180, w), Math.max(-85, s), Math.min(180, e), Math.min(85, n)].map(v => +v.toFixed(4));
}
const inBox = (lon, lat, b) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

const norm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u0300-\u036f]/g, '').replace(/^(al|el|ال)[- ]?/, '').trim();
const arabic = s => /[\u0600-\u06FF]/.test(s || '');
// 0 = near the map view (inside the bias box), 1 = elsewhere in the world (never excluded)
export function countryTier(cc, lon, lat, box = SY_BBOX) {
  return lon == null || inBox(lon, lat, box) ? 0 : 1;
}
// Cross-script names of Syria's major cities (governorate capitals + a few large towns). Photon returns only one
// name per hit (the UI language or the local name), so حلب in the EN/DE UI ("Aleppo"/"Aleppo") or "Aleppo" in the AR
// UI ("حلب") could not be matched by text alone (QA #15). Spellings are compared after skey() normalisation.
const ALIASES = [
  ['حلب', 'aleppo', 'halab'], ['دمشق', 'damascus', 'damaskus', 'dimashq'], ['حمص', 'homs', 'hims'], ['حماه', 'hama', 'hamah'],
  ['اللاذقيه', 'latakia', 'lattakia', 'latakieh', 'latakiya', 'ladhiqiyah'], ['طرطوس', 'tartus', 'tartous', 'tortosa'],
  ['ادلب', 'idlib', 'idleb'], ['الرقه', 'raqqa', 'raqqah', 'ar-raqqah', 'rakka', 'ar-rakka'],
  ['دير الزور', 'deir ez-zor', 'deir ezzor', 'deir al-zor', 'dayr az-zawr', 'deir ez zor', 'deir-ez-zor'],
  ['الحسكه', 'hasakah', 'al-hasakah', 'hasaka', 'hassake', 'al-hasaka'], ['القامشلي', 'qamishli', 'qamishlo', 'kamischli'],
  ['درعا', 'daraa', "dar'a", 'deraa'], ['السويداء', 'suwayda', 'as-suwayda', 'sweida', 'suwaida', 'es-suweida'],
  ['القنيطره', 'quneitra', 'kuneitra', 'qunaytirah'], ['تدمر', 'palmyra', 'tadmur'], ['منبج', 'manbij', 'membidsch'],
  ['البوكمال', 'abu kamal', 'al-bukamal', 'albu kamal'], ['الميادين', 'mayadin', 'al-mayadin'], ['جبله', 'jableh', 'jablah', 'dschabla'],
  ['بانياس', 'baniyas', 'banias'], ['الباب', 'al-bab', 'bab'], ['عفرين', 'afrin'], ['اعزاز', 'azaz', 'aazaz'], ['السلميه', 'salamiyah', 'salamiyeh'],
];
const skey = s => norm(s).replace(/[^\p{L}\p{N}]/gu, '');
const ALIAS = new Map(); ALIASES.forEach((v, i) => v.forEach(n => ALIAS.set(skey(n), i)));
/** same place name in any script/spelling (exact after normalisation, or the same alias group) */
export function sameName(a, b) { const x = skey(a), y = skey(b); if (!x || !y) return false; if (x === y) return true; const i = ALIAS.get(x); return i != null && i === ALIAS.get(y); }
// 0 = exact name match in any script (Aleppo ↔ حلب ↔ Aleppo), 1 = name starts with the query,
// 2 = city/town hit of the nearby place query across scripts (حمص → Homs), -1 = no settlement match
function settleRank(it, q) {
  const place = it.tags?.place; if (!SETTLE.includes(place)) return -1;
  const n = norm(it.name), qq = norm(q);
  if (sameName(it.name, q) || [it.tags?.['name:ar'], it.tags?.['name:en'], it.tags?.['name:de']].some(v => v && sameName(v, q))) return 0;
  if (qq && n.startsWith(qq)) return 1;
  if (it.placeHit && arabic(q) !== arabic(it.name) && place !== 'village') return 2;
  return -1;
}
// Settlements that match the query first (city > town > village, then near the view), then everything else by tier, stable.
export function rank(list, q, box = SY_BBOX) {
  const pr = { city: 0, town: 1, village: 2 };
  const a = list.map((it, i) => ({ it, i, s: settleRank(it, q), c: countryTier(it.cc, it.lon, it.lat, box) }));
  // QA P1-2: proximity only breaks ties – a nearby village must never beat the city (حلب from Damascus → Aleppo first)
  const set = a.filter(x => x.s >= 0).sort((x, y) => x.s - y.s || pr[x.it.tags.place] - pr[y.it.tags.place] || x.c - y.c || x.i - y.i);
  const rest = a.filter(x => x.s < 0).sort((x, y) => x.c - y.c || x.i - y.i);
  return { settlements: set.map(x => x.it), rest: rest.map(x => x.it) };
}

// Remove duplicates: the same place from several sources / OSM objects (city node + boundary relation,
// one street split into many ways, local POI + Photon hit). Keeps the first (best-ranked) entry.
function km(a, b) { const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) * r / 2), y = (b.lat - a.lat) * r; return Math.sqrt(x * x + y * y) * 6371; }
export function dedupe(list) {
  const out = [];
  for (const it of list) {
    if (!it || it.chip || it.coord || it.isMe || it.lon == null) { out.push(it); continue; }
    const n = norm(it.name), settle = SETTLE.includes(it.tags?.place);
    const dup = out.some(o => {
      if (!o || o.chip || o.coord || o.isMe || o.lon == null) return false;
      if (it.id && o.id === it.id) return true;
      if (norm(o.name) !== n) return false;
      if ((o.sub || '') === (it.sub || '') && km(o, it) < 5) return true;
      const os = SETTLE.includes(o.tags?.place);
      const area = x => SETTLE.includes(x.tags?.place) || !!x.tags?.boundary || !!x.tags?.place;
      if (settle || os) return area(o) && area(it) && km(o, it) < 25; // city node vs. its boundary/other place object
      return km(o, it) < 0.4; // same-named POI/street pieces next to each other
    });
    if (!dup) out.push(it);
  }
  return out;
}
// Photon: one worldwide query biased to the map view + two queries in the region around the view (settlements,
// any hit), in parallel. The region queries make sure nearby hits are fetched even if a same-named place elsewhere
// ranks higher worldwide (QA: "دمشق" from Damascus → Iran/Tunisia before Syrian streets); far hits stay in the list.
export async function photonSearch(q, { lang = 'default', center, zoom, view, limit = 8, signal } = {}) {
  const b = biasPoint(center, zoom), box = biasBox(center, view);
  const base = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=${lang}`;
  const general = fetchJSON(`${base}&limit=${limit}&lat=${b.lat.toFixed(4)}&lon=${b.lon.toFixed(4)}&zoom=${b.zoom}&location_bias_scale=0.4`, { signal }, 8000);
  const places = fetchJSON(`${base}&limit=4&bbox=${box.join(',')}&osm_tag=place:city&osm_tag=place:town&osm_tag=place:village`, { signal }, 8000);
  const syria = fetchJSON(`${base}&limit=${Math.min(limit, 8)}&bbox=${box.join(',')}&lat=${b.lat.toFixed(4)}&lon=${b.lon.toFixed(4)}`, { signal }, 8000);
  const [g, p, sy] = await Promise.allSettled([general, places, syria]);
  if (signal?.aborted) throw Object.assign(new Error('abort'), { name: 'AbortError' });
  if (g.status === 'rejected' && p.status === 'rejected' && sy.status === 'rejected') throw g.reason;
  const pf = (p.value?.features || []).map(f => (f.properties.placeHit = true, f));
  // city/town boundary relations (e.g. Berlin) → place:<type>, so the ranking treats them as settlements (QA #15)
  for (const f of [...(g.value?.features || []), ...pf, ...(sy.value?.features || [])]) {
    const pp = f.properties; if (pp.osm_key === 'boundary' && SETTLE.includes(pp.type)) { pp.osm_key = 'place'; pp.osm_value = pp.type; }
  }
  const seen = new Set(), out = [];
  for (const f of [...pf, ...(g.value?.features || []), ...(sy.value?.features || [])]) {
    const k = (f.properties.osm_type || '') + f.properties.osm_id;
    if (seen.has(k)) continue; seen.add(k); out.push(f);
  }
  return out;
}

// ---------- combobox (WAI-ARIA 1.2 pattern, list autocomplete) ----------
// input: the text field; box: the popup list; rows have [data-i]. opts.onPick(i), opts.onEnterEmpty(), opts.onClose()
let cbN = 0;
export function combobox(input, box, opts = {}) {
  if (!box.id) box.id = 'cb' + (++cbN);
  box.setAttribute('role', 'listbox');
  if (opts.label) box.setAttribute('aria-label', opts.label);
  const st = { sel: -1 };
  const attach = inp => {
    inp.setAttribute('role', 'combobox'); inp.setAttribute('aria-autocomplete', 'list');
    inp.setAttribute('aria-controls', box.id); inp.setAttribute('aria-expanded', 'false');
  };
  attach(input);
  const rows = () => [...box.querySelectorAll('[data-i]')];
  const open = () => !box.classList.contains('hidden') && rows().length > 0;
  const cur = () => opts.input ? opts.input() : input;
  function setSel(i) {
    const rs = rows(); st.sel = rs.length ? Math.max(-1, Math.min(rs.length - 1, i)) : -1;
    rs.forEach((r, j) => { r.classList.toggle('sel', j === st.sel); r.setAttribute('aria-selected', j === st.sel ? 'true' : 'false'); });
    const inp = cur();
    if (st.sel >= 0) { inp?.setAttribute('aria-activedescendant', rs[st.sel].id); rs[st.sel].scrollIntoView({ block: 'nearest' }); }
    else inp?.removeAttribute('aria-activedescendant');
  }
  // call after the list is (re)rendered
  function refresh() {
    rows().forEach((r, j) => { r.id = `${box.id}-o${j}`; r.setAttribute('role', 'option'); r.setAttribute('aria-selected', 'false'); });
    box.querySelectorAll('.shead,.srow:not([data-i])').forEach(h => h.setAttribute('role', 'presentation'));
    const inp = cur(); inp?.setAttribute('aria-expanded', open() ? 'true' : 'false');
    st.sel = -1; inp?.removeAttribute('aria-activedescendant');
  }
  function close() { const inp = cur(); inp?.setAttribute('aria-expanded', 'false'); inp?.removeAttribute('aria-activedescendant'); st.sel = -1; opts.onClose?.(); }
  async function keydown(e) {
    if (e.isComposing) return;
    // Up/Down are logical (list order) – identical in RTL
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open()) { await opts.flush?.(); }
      if (e.altKey) return;
      const n = rows().length; if (!n) return;
      setSel(e.key === 'ArrowDown' ? (st.sel + 1 >= n ? 0 : st.sel + 1) : (st.sel <= 0 ? n - 1 : st.sel - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (st.sel >= 0 && open()) return opts.onPick(+rows()[st.sel].dataset.i);
      if (opts.onEnterEmpty) return opts.onEnterEmpty();
      await opts.flush?.();
      if (rows().length) opts.onPick(+rows()[0].dataset.i);
    } else if (e.key === 'Escape') {
      if (open()) { e.preventDefault(); e.stopPropagation(); close(); }
      else opts.onEscapeClosed?.(e);
    } else if (e.key === 'Home' || e.key === 'End') {
      // leave caret movement to the text field
    }
  }
  return { attach, refresh, close, keydown, setSel, get sel() { return st.sel; } };
}
