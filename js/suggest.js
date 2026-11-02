// Shared search ranking (Syria first, settlements before POIs) + accessible combobox for search inputs.
// OSM-only: Photon (komoot) – no keys.
import { fetchJSON } from './util.js';

export const SY_BBOX = [35.6, 32.3, 42.4, 37.4]; // W,S,E,N
const SY_CENTER = [38.5, 35.0];
const SETTLE = ['city', 'town', 'village'];
const LAST = ['sa', 'jo', 'tr']; // neighbours that used to crowd out Syrian hits

export function inSyria(lon, lat) { return lon >= SY_BBOX[0] && lon <= SY_BBOX[2] && lat >= SY_BBOX[1] && lat <= SY_BBOX[3]; }
// Bias point for Photon: the map centre if it is in Syria, otherwise the centre of Syria
export function biasPoint(c, z = 7) { return c && inSyria(c[0], c[1]) ? { lon: c[0], lat: c[1], zoom: Math.round(Math.max(6, z)) } : { lon: SY_CENTER[0], lat: SY_CENTER[1], zoom: 7 }; }

const norm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u0300-\u036f]/g, '').replace(/^(al|el|ال)[- ]?/, '').trim();
const arabic = s => /[\u0600-\u06FF]/.test(s || '');
// 0 = Syria (country code, or no code but inside the Syria bbox), 1 = other countries, 2 = SA/JO/TR (never excluded)
export function countryTier(cc, lon, lat) {
  cc = (cc || '').toLowerCase();
  if (!cc) return lon == null || inSyria(lon, lat) ? 0 : 1;
  return cc === 'sy' ? 0 : LAST.includes(cc) ? 2 : 1;
}
// 0 = name starts with the query, 1 = city/town hit across scripts (حمص → Homs), -1 = no settlement match
function settleRank(it, q) {
  const place = it.tags?.place; if (!SETTLE.includes(place)) return -1;
  if (it.cc && it.cc.toLowerCase() !== 'sy') return -1;
  const n = norm(it.name), qq = norm(q);
  if (qq && n.startsWith(qq)) return 0;
  if (it.placeHit && arabic(q) !== arabic(it.name) && place !== 'village') return 1;
  return -1;
}
// Settlements that match the query first (city > town > village), then everything else by country tier, stable.
export function rank(list, q) {
  const pr = { city: 0, town: 1, village: 2 };
  const a = list.map((it, i) => ({ it, i, s: settleRank(it, q), c: countryTier(it.cc, it.lon, it.lat) }));
  const set = a.filter(x => x.s >= 0).sort((x, y) => x.s - y.s || pr[x.it.tags.place] - pr[y.it.tags.place] || x.i - y.i);
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
// Photon: one biased general query + two Syria-bbox queries (settlements, any hit), in parallel. The bbox
// queries make sure Syrian hits are always fetched even if a same-named place abroad ranks higher worldwide
// (QA: "دمشق" → Iran/Tunisia before Syrian streets); other countries stay in the list, rank() puts them after Syria.
export async function photonSearch(q, { lang = 'default', center, zoom, limit = 8, signal } = {}) {
  const b = biasPoint(center, zoom);
  const base = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=${lang}`;
  const general = fetchJSON(`${base}&limit=${limit}&lat=${b.lat.toFixed(4)}&lon=${b.lon.toFixed(4)}&zoom=${b.zoom}&location_bias_scale=0.4`, { signal }, 8000);
  const places = fetchJSON(`${base}&limit=4&bbox=${SY_BBOX.join(',')}&osm_tag=place:city&osm_tag=place:town&osm_tag=place:village`, { signal }, 8000);
  const syria = fetchJSON(`${base}&limit=${Math.min(limit, 8)}&bbox=${SY_BBOX.join(',')}&lat=${b.lat.toFixed(4)}&lon=${b.lon.toFixed(4)}`, { signal }, 8000);
  const [g, p, sy] = await Promise.allSettled([general, places, syria]);
  if (signal?.aborted) throw Object.assign(new Error('abort'), { name: 'AbortError' });
  if (g.status === 'rejected' && p.status === 'rejected' && sy.status === 'rejected') throw g.reason;
  const pf = (p.value?.features || []).map(f => (f.properties.placeHit = true, f));
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
