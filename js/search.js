// Search: Photon autocomplete (komoot, key-free) + Nominatim full search (1 req/s) + coordinates / plus codes,
// recent searches & saved places, category search via Overpass.
import { nf, locale, $, esc, fetchJSON, nominatim, overpass, debounce, parseCoords, plusDecode, haversine, fmtDist, lsGet, lsSet, toast } from './util.js';
import { t, getLang } from './i18n.js';
import { ic } from './icons.js';
import { App, center, refPoint, chipRef, catIcon, catLabel, pickName, openSheet, clearMarkers, markerEl, closeSheet, POI, mapPadding, fitTo } from './core.js';
import { ohStatus } from './hours.js';
import { photonSearch, rank, dedupe, inSyria, combobox, biasBox, cleanQuery, photonLang } from './suggest.js';
import { inSyria as inSyriaPoly } from './syria-poly.js';
import { gateByView, fitTargets } from './search-core.js';
const goPlace = (item, opts) => import('./place.js').then(m => m.openPlace(item, opts));
const track = (name, props) => import('./analytics.js').then(m => m.track(name, props)).catch(() => {});
const gzOpen = (c, text) => inSyriaPoly(c[0], c[1]) || /[\u0600-\u06FF]/.test(text);
import { tileCategoryItems, mergeTileItems } from './tile-poi.js';
import { hintCount } from './share-core.js';
import { localSearch, loadGazetteer } from './offline-search.js';
import { isSaved, toggleSaved } from './saved.js';
import { norm, loadPois, searchLocal, toItem, getFilter, setFilter, filterResults, poiStatus, P, CHIP_CATS } from './poi.js';

// Design order (§4.3) first, then extras; colours = --k-poi-* (§3.5)
export const CATS = [
  ['restaurants', 'restaurant', POI.food, 'nwr["amenity"~"^(restaurant|fast_food|food_court)$"]'],
  ['cafes', 'cafe', POI.food, 'nwr["amenity"~"^(cafe|ice_cream)$"]'],
  ['fuel', 'fuel', POI.transport, 'nwr["amenity"="fuel"]'],
  ['pharmacy', 'pharmacy', POI.health, 'nwr["amenity"="pharmacy"]'],
  ['mosque', 'mosque', POI.worship, 'nwr["amenity"="place_of_worship"]["religion"="muslim"]'],
  ['hotel', 'hotel', POI.lodging, 'nwr["tourism"~"^(hotel|hostel|guest_house|motel)$"]'],
  ['atm', 'atm', POI.civic, 'nwr["amenity"~"^(atm|bank|bureau_de_change)$"]'],
  ['supermarket', 'supermarket', POI.shopping, 'nwr["shop"~"^(supermarket|convenience|greengrocer|grocery)$"]'],
  ['hospital', 'hospital', POI.health, 'nwr["amenity"~"^(hospital|clinic|doctors)$"]'],
  ['parking', 'parking', POI.transport, 'nwr["amenity"="parking"]'],
  ['tourism', 'tourism', POI.culture, 'nwr["tourism"~"^(attraction|museum|viewpoint)$"];nwr["historic"~"^(castle|monument|ruins|archaeological_site|citadel)$"]["name"]'],
  ['church', 'church', POI.worship, 'nwr["amenity"="place_of_worship"]["religion"="christian"]'],
  ['bakery', 'bakery', POI.food, 'nwr["shop"~"^(bakery|pastry|confectionery)$"]'],
  ['police', 'police', POI.civic, 'nwr["amenity"="police"]'],
  ['toilets', 'toilets', POI.civic, 'nwr["amenity"="toilets"]'],
];

export function renderChips() {
  const em = `<button class="chip chip-em" data-health="1" style="--chip-ic:${POI.health}">${ic('hospital')}<span>${esc(t('emChip'))}</span></button>`;
  $('#chips').innerHTML = em + CATS.map(([k, icn, col]) => `<button class="chip" data-cat="${k}" style="--chip-ic:${col}">${ic(icn)}<span>${esc(t(k))}</span></button>`).join('');
}
function viewBox() { const b = App.map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }
// ---------- normalisation ----------
function fromPhoton(f) {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  const tags = { name: p.name, [p.osm_key]: p.osm_value };
  if (!p.name && p.brand) tags.brand = p.brand;
  const sub = [p.street && (p.street + (p.housenumber ? ' ' + p.housenumber : '')), p.district, p.city || p.town || p.village, p.state, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i && v !== (p.name || p.brand)).join(', ');
  return { id: (p.osm_type || 'N') + p.osm_id, osm_type: { N: 'node', W: 'way', R: 'relation' }[p.osm_type] || 'node', osm_id: p.osm_id, name: p.name || p.brand || sub, sub, lon, lat, tags, extent: p.extent, cc: p.countrycode, placeHit: !!p.placeHit };
}
function fromNominatim(r) {
  const tags = Object.assign({}, r.extratags || {}, r.namedetails || {}, { [r.category || r.class]: r.type });
  const name = r.name || tags.brand || (r.display_name || '').split(',')[0];
  const sub = (r.display_name || '').split(',').slice(1, 4).join(',').trim();
  const at = r.addresstype;
  if (!tags.place && ['city', 'town', 'village'].includes(at) && (r.category === 'boundary' || r.category === 'place')) tags.place = at;
  const bb = r.boundingbox ? [+r.boundingbox[2], +r.boundingbox[0], +r.boundingbox[3], +r.boundingbox[1]] : null;
  return { id: (r.osm_type || 'n')[0].toUpperCase() + r.osm_id, osm_type: r.osm_type, osm_id: r.osm_id, name: pickName(tags).primary || name, sub, lon: +r.lon, lat: +r.lat, tags, extent: bb, cc: r.address?.country_code, placeHit: !!tags.place };
}

// ---------- recents ----------
export function addRecent(item) {
  const list = lsGet('kh.recent', []).filter(r => r.id !== item.id);
  list.unshift({ id: item.id, osm_type: item.osm_type, osm_id: item.osm_id, name: item.name, sub: item.sub, lon: item.lon, lat: item.lat, tags: item.tags ? { amenity: item.tags.amenity, shop: item.tags.shop, tourism: item.tags.tourism, place: item.tags.place } : {} });
  lsSet('kh.recent', list.slice(0, 15));
}

function row(item, i, extra = '') {
  const [icn, col] = item.icon || catIcon(item.tags || {});
  const d = item.d != null ? fmtDist(item.d) : item.lon != null ? fmtDist(haversine(refPoint(), [item.lon, item.lat])) : ''; // item.d: same reference point as the sort
  return `<div class="srow" data-i="${i}"><div class="sic badge" style="background:${col}">${ic(icn)}</div><div class="st"><div class="t1" dir="auto">${esc(item.name)}</div><div class="t2" dir="auto">${esc(item.sub || catLabel(item.tags || {}))}${extra}</div></div><div class="dist">${d}</div></div>`;
}

// ---------- suggest UI ----------
let items = [], seq = 0, sel = -1;
let photonCtl;
export function initSearch() {
  const q = $('#q'), box = $('#suggest');
  q.placeholder = navigator.onLine ? t('search') : t('searchOffline');
  const show = () => { box.classList.toggle('hidden', !box.innerHTML); document.body.classList.toggle('sugg-open', !!box.innerHTML); cb.refresh(); };
  const renderIdle = () => {
    const saved = lsGet('kh.saved', []).map(s => ({ ...s, name: s.label || s.name })), recent = lsGet('kh.recent', []);
    items = [...saved.map(s => ({ ...s, icon: s.kind === 'home' ? ['home', '#1A73E8'] : s.kind === 'work' ? ['work', '#6E7781'] : ['bookmark', '#E8710A'] })), ...recent.map(r => ({ ...r, icon: ['history', '#8E8E93'] }))];
    let h = '';
    if (saved.length) h += `<div class="shead">${t('saved')}</div>` + saved.map((s, i) => row(items[i], i)).join('');
    if (recent.length) h += `<div class="shead">${t('recent')}</div>` + recent.map((r, j) => row(items[saved.length + j], saved.length + j)).join('');
    box.innerHTML = h; show();
  };
  const doPhoton = async (text) => {
    const my = ++seq;
    photonCtl?.abort(); photonCtl = new AbortController();
    $('#searchProg').classList.remove('hidden');
    let r;
    try { r = await placeSuggest(text, { signal: photonCtl.signal }); } catch (e) { if (e.name === 'AbortError') return; r = { items: [], chip: null }; }
    if (my !== seq) return;
    $('#searchProg').classList.add('hidden');
    items = dedupe([...(r.chip ? [chipItem(r.chip)] : []), ...r.items]).slice(0, 14);
    const coord = parseCoords(text) || plusDecode(text);
    if (coord) items.unshift({ id: 'c', name: text, sub: t('coords'), lon: coord[0], lat: coord[1], icon: ['pin', '#E5484D'], coord: true });
    box.innerHTML = (r.offline ? offlineNotice() : '') + (items.length ? items.map((it, i) => row(it, i)).join('') : `<div class="srow muted">${t('noResults')}</div>`);
    sel = -1; show();
  };
  const runPhoton = debounce(doPhoton, 250);
  const cb = combobox(q, box, {
    label: t('search'),
    onPick: i => items[i] && choose(items[i]),
    onEnterEmpty: () => fullSearch(q.value.trim()),
    flush: () => { const v = q.value.trim(); return v.length >= 2 ? doPhoton(v) : !v ? renderIdle() : null; },
    onClose: () => { box.innerHTML = ''; box.classList.add('hidden'); document.body.classList.remove('sugg-open'); },
    onEscapeClosed: () => q.blur(),
  });
  q.addEventListener('focus', () => { if (!q.value) renderIdle(); });
  q.addEventListener('input', () => {
    $('#btnClear').classList.toggle('hidden', !q.value);
    if (!q.value.trim()) return renderIdle();
    if (q.value.trim().length < 2) return;
    runPhoton(q.value.trim());
  });
  q.addEventListener('keydown', e => cb.keydown(e));
  box.addEventListener('pointerdown', e => e.preventDefault());
  box.addEventListener('click', e => { const r = e.target.closest('.srow[data-i]'); if (r) choose(items[+r.dataset.i]); });
  q.addEventListener('focus', () => { loadPois().catch(() => {}); loadGazetteer().catch(() => {}); });
  const syncPh = () => { q.placeholder = navigator.onLine ? t('search') : t('searchOffline'); };
  addEventListener('online', syncPh); addEventListener('offline', syncPh); // warm the local index as soon as search is used
  q.addEventListener('blur', () => setTimeout(() => { box.innerHTML = ''; show(); }, 150));
  $('#btnClear').addEventListener('click', () => { q.value = ''; $('#btnClear').classList.add('hidden'); clearMarkers(); closeSheet(); q.focus(); renderIdle(); });
}

// The ONE suggestion pipeline used by the main search and by the route start/stop/destination fields:
// cleaned query (tashkeel/tatweel/bidi marks), Photon in the UI language (Arabic → 'default' = native names), the
// bundled local POI index (Arabic/Latin normalisation), saved + recent places, settlement ranking and de-duplication.
// Returns { items, chip } (chip = a category word like "صيدلية"). Throws AbortError if the signal fires.
export async function placeSuggest(raw, { signal, limit = 8 } = {}) {
  const text = cleanQuery(raw);
  if (!text) return { items: [], chip: null };
  const c = center(), z = App.map.getZoom(), view = viewBox(), bbox = biasBox(c, view);
  if (!P.all.length) { try { await loadPois(); } catch {} }
  // local first (saved, recent, offline gazetteer – fuzzy, Arabic/Latin variants), then Photon when online
  const { mine: local, places: gz0 } = await localSearch(text);
  const gzHits = gateByView(gz0, c, { open: gzOpen(c, text) }); // far fuzzy «Kafr…» hits never show for «Café»
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const lp = poiLocal(text);
  const offline = !navigator.onLine;
  let res = [];
  if (!offline) try { res = (await photonSearch(text, { lang: photonLang(getLang()), center: c, zoom: z, view, limit, signal, single: true })).map(fromPhoton); }
  catch (e) { if (e.name === 'AbortError' || signal?.aborted) throw e; } // Photon down: local hits still count
  // Matching cities/towns/villages first (near the view first; QA: "Homs" → Homs city), then saved places and
  // POIs, then the rest – nearby before the rest of the world
  let { settlements, rest } = rank(res, text, bbox);
  if (lp.chip) rest = rest.filter(r => haversine(refPoint(), [r.lon, r.lat]) < 100000);
  const lpItems = lp.items.filter(x => !local.some(l => l.id === x.id) && haversine(c, [x.lon, x.lat]) < 100000); // bundled Syria POIs only near the view
  const top = [...local, ...settlements, ...gzHits, ...lpItems];
  const seen = new Set();
  return { chip: lp.chip, offline, items: dedupe([...top, ...rest].filter(x => !x.id || (!seen.has(x.id) && seen.add(x.id)))) };
}

export function offlineNotice() { return `<div class="soff" role="status" id="offNotice">${ic('offline')}<span>${esc(t('offLocalOnly'))}</span></div>`; }

function poiLocal(text) {
  if (!P.all.length) return { chip: null, items: [] };
  const r = searchLocal(text, refPoint(), 6);
  return { chip: r.chip, items: r.items.map(rec => poiRow(rec)) };
}
function poiRow(rec) {
  const it = toItem(rec);
  const st = poiStatus(rec);
  it.name = pickName(it.tags).primary || catLabel(it.tags);
  it.sub = catLabel(it.tags) + (rec.d != null ? '' : '');
  it.status = st; it.full = false; it.local = true;
  const ui = { food: 'restaurant', cafe: 'cafe', bakery: 'bakery', hotel: 'hotel', money: rec.s === 'bank' ? 'bank' : 'atm', fuel: 'fuel', pharmacy: 'pharmacy', hospital: 'hospital', clinic: 'hospital',
    grocery: 'supermarket', shop: 'shop', mosque: 'mosque', church: 'church', worship: 'mosque', parking: 'parking', police: 'police', sight: 'tourism', fun: 'tourism', edu: 'school',
    gov: 'info', transport: 'bus', park: 'tourism', car: 'car', toilets: 'toilets' }[rec.c] || 'pin';
  it.icon = [ui, POI[rec.grp] || POI.civic];
  return it;
}
function chipItem(key) {
  const c = CATS.find(x => x[0] === key);
  const n = P.all.filter(r => CHIP_CATS[key].includes(r.c) && haversine(refPoint(), [r.lon, r.lat]) < 10000).length;
  // outside Syria the bundled count is always 0 – say where results come from instead of "0 within 10 km"
  const sub = inSyriaPoly(...chipRef()) ? t('nearbyN', { n: nf(n), r: nf(10) }) : t('liveSearch');
  return { id: 'chip:' + key, chip: key, name: t(key), sub, icon: [c[1], c[2]] };
}
export function choose(item) {
  if (item.chip) { $('#suggest').innerHTML = ''; $('#suggest').classList.add('hidden'); const q = $('#q'); q.value = t(item.chip); q.blur(); $('#btnClear').classList.remove('hidden'); track('search', { kind: 'cat', cat: item.chip }); applyChips([item.chip], false); return; }
  cancelCategory();
  $('#suggest').innerHTML = ''; $('#suggest').classList.add('hidden'); document.body.classList.remove('sugg-open');
  const q = $('#q'); q.value = item.name; q.blur(); $('#btnClear').classList.remove('hidden');
  track('search', { kind: item.coord ? 'coord' : 'place', cat: catLabelKey(item.tags) });
  if (!item.coord) addRecent(item);
  clearMarkers();
  goPlace(item);
}
function catLabelKey(tags = {}) { return tags.amenity || tags.shop || tags.tourism || tags.place || tags.highway || null; }

export async function fullSearch(text) {
  text = cleanQuery(text);
  if (!text) return;
  const coord = parseCoords(text) || plusDecode(text);
  if (coord) return choose({ id: 'c', name: text, lon: coord[0], lat: coord[1], coord: true });
  const box = $('#suggest'); box.innerHTML = `<div class="srow muted">${t('searching')}</div>`; box.classList.remove('hidden');
  const b = App.map.getBounds(), c = center(), view = viewBox(), bbox = biasBox(c, view);
  // bias (never bound: no bounded/countrycodes) to the current map view, worldwide
  const vb = [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map(v => (+v).toFixed(4)).join(',');
  const loc0 = await localSearch(text, { limit: 12 }); // local first – answers without network
  loc0.places = gateByView(loc0.places, c, { open: gzOpen(c, text) }); // gazetteer: name matches anywhere, fuzzy hits only near the view
  const offline = !navigator.onLine;
  let res = [];
  if (!offline) try {
    const j = await nominatim(`search?q=${encodeURIComponent(text)}&format=jsonv2&limit=12&addressdetails=1&extratags=1&namedetails=1&accept-language=${getLang()},ar,en&viewbox=${vb}`);
    res = j.map(fromNominatim);
    // Nominatim's viewbox is only a bias: if it found (almost) nothing near the view, add Photon's nearby hits
    if (res.filter(r => r.lon >= bbox[0] && r.lon <= bbox[2] && r.lat >= bbox[1] && r.lat <= bbox[3]).length < 3) try { res = res.concat((await photonSearch(text, { lang: photonLang(getLang()), center: c, zoom: App.map.getZoom(), view, limit: 8 })).map(fromPhoton)); } catch {}
  } catch {
    try { res = (await photonSearch(text, { lang: photonLang(getLang()), center: c, zoom: App.map.getZoom(), view, limit: 12 })).map(fromPhoton); } catch {}
  }
  box.innerHTML = ''; box.classList.add('hidden'); document.body.classList.remove('sugg-open');
  try { await loadPois(); } catch {}
  const lr = searchLocal(text, refPoint(), 30);
  // a pure category word (Café, مقهى, Restaurants) = the chip: current view, worldwide, never a fuzzy place list
  if (lr.chip && (lr.pure || !lr.items.length)) { box.innerHTML = ''; box.classList.add('hidden'); track('search', { kind: 'cat', cat: lr.chip }); applyChips([lr.chip], false); return; }
  const loc = lr.items.filter(x => haversine(c, [x.lon, x.lat]) < 100000).map(poiRow); // bundled Syria POIs only near the view
  const rk = rank(res, text, bbox);
  rk.settlements.forEach(x => { x.place = true; });
  res = dedupe([...loc0.mine, ...rk.settlements, ...loc0.places, ...loc, ...rk.rest.filter(r => !loc.some(l => l.id === r.id))]);
  track('search', { kind: 'full', n: res.length });
  if (!res.length) { toast(offline ? t('offLocalOnly') : t('noResults'), offline ? 4000 : 2600); return; }
  if (res.length === 1 && !offline) return choose(res[0]);
  showResultList(res, t('results') + ': ' + text, true, offline);
}

const starBtn = (r, i) => r.lon == null || r.chip ? '' : `<button class="ib sstar${isSaved(r.id) ? ' on' : ''}" data-star="${i}" aria-pressed="${isSaved(r.id)}" aria-label="${esc(t(isSaved(r.id) ? 'svUnsaveAria' : 'svSaveAria'))}">${ic(isSaved(r.id) ? 'star' : 'starOutline', 'sm')}</button>`;
const withStar = (html, r, i) => html.replace(/<\/div>$/, starBtn(r, i) + '</div>');
export function showResultList(res, title, fit = true, offline = false) {
  clearMarkers();
  res.forEach((r, i) => {
    const [icn, col] = catIcon(r.tags || {});
    const m = new maplibregl.Marker({ element: markerEl(icn, col, App.map.getZoom() > 14 && res.length < 40 ? r.name : '') }).setLngLat([r.lon, r.lat]).addTo(App.map);
    m.getElement().addEventListener('click', e => { e.stopPropagation(); addRecent(r); goPlace(r); });
    App.markers.push(m);
  });
  const body = openSheet(`<div class="sec"><h2 class="ptitle" style="font-size:18px">${esc(title)}</h2><p class="psub">${res.length} · OpenStreetMap</p></div>${offline ? offlineNotice() : ''}<div class="list">${res.map((r, i) => withStar(row(r, i, r.status ? ` · <span class="${r.status.cls}">${esc(r.status.text.split(' · ')[0])}</span>` : ''), r, i)).join('')}</div>`, 'half', () => clearMarkers());
  body.querySelector('.list').addEventListener('click', e => {
    const st = e.target.closest('[data-star]');
    if (st) { e.stopPropagation(); const r = res[+st.dataset.star]; const on = toggleSaved(r); st.outerHTML = starBtn(r, +st.dataset.star); toast(t(on ? 'savedOk' : 'svRemoved')); return; }
    const el = e.target.closest('.srow'); if (el) { const r = res[+el.dataset.i]; addRecent(r); goPlace(r); } });
  if (fit && res.length > 1) {
    // frame only results near the current view (never a Tunisia–Syria box at z2.6); nothing near → camera stays
    const near = fitTargets(res, center()), top = res[0];
    // deliberate place search ("Homs" from Damascus): go to that ONE place, never frame several far points
    if ((top.gz || top.place) && !near.includes(top)) App.map.easeTo({ center: [top.lon, top.lat], zoom: Math.max(CHIP_MIN_Z, Math.min(14, App.map.getZoom())), duration: 600 });
    else if (near.length) {
      const b = new maplibregl.LngLatBounds(); near.forEach(r => b.extend([r.lon, r.lat]));
      const mp = mapPadding(); fitTo(b, { top: mp.top + 20, bottom: Math.max(mp.bottom, innerWidth < 900 ? innerHeight * 0.5 : 0) + 20, left: mp.left + 30, right: mp.right + 30 }, { maxZoom: 16, minZoom: CHIP_MIN_Z, duration: 600 });
    }
  }
}

// ---------- categories: bundled POIs (multi-select + open now), live Overpass as supplement ----------
let catSeq = 0;
export const CHIP_MIN_Z = 12; // chip fit never zooms out below z12
// live search area: fixed radii around the chip reference point (GPS if inside the view, else map centre),
// tried 2.5 km, then 5 km, then 10 km until something is found
export const LIVE_RADII_KM = [2.5, 5, 10];
export function liveBoxes(ref) {
  const [lon, lat] = ref, ky = 1 / 111.195, kx = 1 / (111.195 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
  return LIVE_RADII_KM.map(r => [lat - r * ky, lon - r * kx, lat + r * ky, lon + r * kx]);
}
export function sortByRef(res) { return res.sort((a, b) => a.d - b.d); }
export const CAT_FIT_M = 15000; // fit the map only to category results within 15 km of the view centre
export function cancelCategory() { catSeq++; if (getFilter().cats.size) { setFilter(App.map, []); } document.querySelectorAll('.chip.on').forEach(c => c.classList.remove('on')); }
export function toggleChip(key) {
  const cats = new Set(getFilter().cats);
  cats.has(key) ? cats.delete(key) : cats.add(key);
  applyChips([...cats], getFilter().openNow);
}
export async function applyChips(cats, openNow, fit = true) {
  catSeq++;
  try { await loadPois(); } catch { /* bundled Syria POIs optional outside Syria – still mark live hits */ }
  setFilter(App.map, cats, openNow);
  document.querySelectorAll('.chip[data-cat]').forEach(c => c.classList.toggle('on', cats.includes(c.dataset.cat)));
  if (!cats.length) { clearMarkers(); closeSheet(); return; }
  // Outside Syria the bundled POIs are all far away – never jump there (P1: a chip in Berlin flew to Syria);
  // search live OSM (Overpass) in the current view instead, worldwide, without moving the map.
  // P0: gate on the Syria border polygon (not the old rectangle) and on the reference point the user looks at
  if (!inSyriaPoly(...chipRef())) { searchCategoryLive(cats[cats.length - 1]); return; }
  track('category', { cat: cats.join(',') });
  showFilterSheet(fit);
}
export function filterActive() { return getFilter().cats.size > 0; }
export function showFilterSheet(fit = false) {
  const f = getFilter(), cats = [...f.cats];
  const ref = chipRef(), r = filterResults(ref, 80); // GPS if inside the view, else the view centre – never Syria
  clearMarkers();
  const res = r.list.map(rec => Object.assign(poiRow(rec), { d: rec.d }));
  const title = cats.map(k => t(k)).join(' · ');
  const chipsHtml = `<div class="ochips fchips"><button class="ochip ${f.openNow ? 'on' : ''}" data-open="1">${ic('clock')}<span>${t('openNow')}</span></button>` +
    [...CATS.filter(c => f.cats.has(c[0])), ...CATS.filter(c => !f.cats.has(c[0]))].map(([k, icn, col]) => `<button class="ochip ${f.cats.has(k) ? 'on' : ''}" data-fc="${k}" style="--chip-ic:${col}">${ic(icn)}<span>${esc(t(k))}</span></button>`).join('') + `</div>`;
  const countTxt = `${t('nearbyN', { n: nf(r.near), r: nf(10) })} · ${t('inSyria', { n: nf(r.total) })}` + (inSyriaPoly(...ref) ? '' : ` · ${t('worldPoiLiveHint')}`) + (f.openNow ? ` · ${t('hoursKnown', { n: nf(r.withHours) })}` : '');
  // hidden-without-hours hint: no big numbers (≤ 99 exact, else 99+), locale digits (ar-SY for AR), tappable "Show anyway"
  const hintHtml = r.hiddenNoHours ? `<p class="psub ohhint" id="ohHint"><span>${esc(t('ohHidden', { n: hintCount(r.hiddenNoHours, locale()) }))}</span> <button type="button" class="linkbtn" id="ohShow">${esc(t('ohShowAnyway'))}</button></p>` : '';
  const list = res.length ? `<div class="list">${res.map((x, i) => row(x, i, x.status ? ` · <span class="${x.status.cls}">${esc(x.status.text.split(' · ')[0])}</span>` : '')).join('')}</div>`
    : `<div class="sec"><p class="psub">${t(f.openNow ? 'noOpenNow' : 'noResults')}</p></div>`;
  const body = openSheet(`<div class="sec fhead"><div class="fhrow"><h2 class="ptitle" style="font-size:18px">${esc(title)}</h2><button class="act" id="fClear">${t('clear')}</button></div><p class="psub">${esc(countTxt)}</p>${hintHtml}</div>${chipsHtml}${list}<div class="sec"><button class="act" id="fLive">${ic('search')}<span>${t('liveSearch')}</span></button><p class="psub small">${esc(t('poiData', { d: P.meta?.date || '' }))}</p></div>`, fit ? 'half' : (sheetStateSafe() || 'half'),
    () => { if (sheetStateSafe() === 'hidden') { setFilter(App.map, []); document.querySelectorAll('.chip.on').forEach(c => c.classList.remove('on')); clearMarkers(); } });
  App.sheetKind = 'filter';
  body.querySelector('.list')?.addEventListener('click', e => { const el = e.target.closest('.srow'); if (el) { const x = res[+el.dataset.i]; addRecent(x); goPlace(x); } });
  body.querySelector('.fchips').addEventListener('click', e => {
    const b = e.target.closest('.ochip'); if (!b) return;
    if (b.dataset.open) { applyChips(cats, !f.openNow, false); return; }
    const set = new Set(cats); set.has(b.dataset.fc) ? set.delete(b.dataset.fc) : set.add(b.dataset.fc);
    applyChips([...set], f.openNow, true);
  });
  $('#fClear').onclick = () => { applyChips([], false); const q = $('#q'); if (CATS.some(c => t(c[0]) === q.value)) { q.value = ''; $('#btnClear').classList.add('hidden'); } };
  $('#fLive').onclick = () => searchCategoryLive(cats[0]);
  const show = body.querySelector('#ohShow'); if (show) show.onclick = () => { setFilter(App.map, cats, true, true); showFilterSheet(false); };
  // never leave the user's area: only results that are close to the reference point AND whose box stays near it
  const nearView = res.filter(x => x.d < CAT_FIT_M && haversine(center(), [x.lon, x.lat]) < 2 * CAT_FIT_M);
  if (fit && nearView.length) { // only fit to results near the current view – never to POIs in another city / country
    const near = nearView.slice(0, 12), b = new maplibregl.LngLatBounds(); near.forEach(x => b.extend([x.lon, x.lat]));
    if (App.me && haversine(App.me, [near[0].lon, near[0].lat]) < 20000) b.extend(App.me);
    const mp = mapPadding();
    fitTo(b, { top: mp.top + 30, bottom: Math.max(mp.bottom, innerWidth < 900 ? innerHeight * 0.5 : 0) + 30, left: mp.left + 40, right: mp.right + 40 }, { maxZoom: 15.5, minZoom: CHIP_MIN_Z, duration: 600 });
  }
}
function sheetStateSafe() { return document.getElementById('sheet')?.dataset.state; }
// legacy name used by app.js
export function searchCategory(key) { return toggleChip(key); }
// live OpenStreetMap (Overpass) in the current view – supplement for the newest data
export async function searchCategoryLive(key) {
  const mySeq = ++catSeq;
  const cat = CATS.find(c => c[0] === key); if (!cat) return;
  track('category', { cat: key, live: 1 });
  const ref = chipRef(); // same point for sorting and km display (and the search radii): GPS if inside the view, else the view centre
  const boxes = liveBoxes(ref);
  // named POIs already in the loaded vector tiles (0 requests, offline) – merged with the live answer; same widest radius
  const tileRes = () => { try { const [bs, bw, bn, be] = boxes[boxes.length - 1]; return tileCategoryItems(App.map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi' }), key, ref, tg => pickName(tg).primary || catLabel(tg), 100, [bw, bs, be, bn]).map(x => Object.assign(x, { sub: catLabel(x.tags) })); } catch { return []; } };
  openSheet(`<div class="sec"><h2 class="ptitle" style="font-size:18px">${t(key)} · OSM live</h2><div class="skel" style="width:60%"></div><div class="skel"></div><div class="skel" style="width:80%"></div></div>`, 'peek');
  try {
    let j, opDown = false; // Overpass 5xx/failed once → the wider steps go straight to Nominatim (P3: faster fallback)
    for (const [s, w, n, e] of boxes) { // nothing found: widen the radius automatically (2.5 km, 5 km, 10 km)
      const bbox = [s, w, n, e].map(v => v.toFixed(5)).join(',');
      const qs = cat[3].split(';').map(x => `${x}(${bbox});`).join('');
      const q = `[out:json][timeout:20];(${qs});out center tags 150;`;
      try { if (opDown) throw new Error('overpass down'); j = await overpass(q, 9000, 2500, { tries: 2 }); }
      catch (opErr) { opDown = true; // fallback: Nominatim special phrase search in the box
        const word = { restaurants: 'restaurant', cafes: 'cafe', fuel: 'fuel', pharmacy: 'pharmacy', hospital: 'hospital', atm: 'atm', mosque: 'mosque', church: 'church', hotel: 'hotel', supermarket: 'supermarket', bakery: 'bakery', tourism: 'attraction', parking: 'parking', police: 'police', toilets: 'toilets' }[key];
        const r = await nominatim(`search?q=${encodeURIComponent('[' + word + ']')}&format=jsonv2&limit=40&bounded=1&viewbox=${w},${n},${e},${s}&extratags=1&namedetails=1&accept-language=${getLang()}`);
        j = { elements: r.map(x => ({ type: x.osm_type, id: x.osm_id, lat: +x.lat, lon: +x.lon, tags: Object.assign({}, x.extratags, x.namedetails, { [x.category]: x.type }) })) };
      }
      if (mySeq !== catSeq) return;
      if (j.elements?.length) break;
    }
    let res = j.elements.map(el => {
      const lon = el.lon ?? el.center?.lon, lat = el.lat ?? el.center?.lat;
      const tags = el.tags || {};
      const nm = pickName(tags).primary || catLabel(tags);
      const addr = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
      return { id: el.type[0].toUpperCase() + el.id, osm_type: el.type, osm_id: el.id, name: nm, sub: [catLabel(tags), addr].filter(Boolean).join(' · '), lon, lat, tags, full: true, status: ohStatus(tags.opening_hours), d: haversine(ref, [lon, lat]) };
    }).filter(r => r.lon != null);
    res.sort((a, b) => (b.tags.name || b.tags.brand ? 1 : 0) - (a.tags.name || a.tags.brand ? 1 : 0) || a.d - b.d);
    res = sortByRef(mergeTileItems(res.slice(0, 100), tileRes()).slice(0, 100));
    if (!res.length) { openSheet(`<div class="sec"><h2 class="ptitle" style="font-size:18px">${t(key)}</h2><p class="psub">${t('noResults')}</p></div>`, 'peek'); return; }
    showResultList(res, t(key) + ' · OSM live', false);
  } catch (err) {
    if (mySeq !== catSeq) return;
    const tr = tileRes(); if (tr.length) { showResultList(tr, t(key), false); return; } // live down: map data still answers
    openSheet(`<div class="sec"><h2 class="ptitle" style="font-size:18px">${t(key)}</h2><p class="psub">${t('serviceDown')}</p><div class="actions"><button class="act" id="retryCat">${t('tryAgain')}</button></div></div>`, 'peek');
    $('#retryCat').onclick = () => searchCategoryLive(key);
  }
}
