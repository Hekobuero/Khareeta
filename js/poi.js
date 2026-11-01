// Bundled Syria POI layer (OpenStreetMap, ODbL) – rendered as Khareeta's own GeoJSON source so hotels, ATMs,
// restaurants … are visible at city zooms (the OpenMapTiles poi layer is sparse and only shown from z14.5–16).
// Also provides the local search index (Arabic/Latin normalisation, category words in EN/AR/DE) and the
// multi-select category filter.
import { haversine } from './util.js';
import { ohStatus } from './hours.js';

export const DATA_URL = './data/poi-syria.json';
// data category -> colour group (DESIGN §3.5), importance (3 = from z12.5, 2 = z14, 1 = z15.5, 0 = z16.5 unnamed)
export const CAT = {
  hotel: ['lodging', 3], money: ['civic', 3], hospital: ['health', 3], sight: ['culture', 3], fuel: ['transport', 3], transport: ['transport', 3],
  food: ['food', 2], cafe: ['food', 2], pharmacy: ['health', 2], grocery: ['shopping', 2], bakery: ['food', 2], mosque: ['worship', 2], church: ['worship', 2],
  police: ['civic', 2], clinic: ['health', 2], gov: ['civic', 2], fun: ['culture', 2], park: ['nature', 2],
  shop: ['shopping', 1], edu: ['civic', 1], parking: ['transport', 1], worship: ['worship', 1], car: ['transport', 1], toilets: ['civic', 1],
};
const GROUP_TEXT = {
  light: { food: '#A84F04', shopping: '#8F3B7A', lodging: '#5B43B8', health: '#B8262B', nature: '#1D7342', culture: '#83570C', worship: '#0C6862', transport: '#38507D', civic: '#535A63' },
  dark: { food: '#F5A55C', shopping: '#E08FCB', lodging: '#B3A3F0', health: '#F58A8D', nature: '#6FCB93', culture: '#DDB05E', worship: '#5CC7BE', transport: '#9DB4DA', civic: '#B4BBC3' },
};
const SPRITE = {
  restaurant: 'restaurant', food_court: 'restaurant', fast_food: 'fast_food', cafe: 'cafe', ice_cream: 'ice_cream',
  hotel: 'lodging', motel: 'lodging', hostel: 'lodging', guest_house: 'lodging', apartment: 'lodging', chalet: 'lodging',
  atm: 'atm', bank: 'bank', exchange: 'exchange', fuel: 'fuel', charging_station: 'charging', pharmacy: 'pharmacy', hospital: 'hospital',
  clinic: 'doctor', doctors: 'doctor', doctor: 'doctor', centre: 'doctor', dentist: 'dentist', veterinary: 'veterinary',
  supermarket: 'grocery', convenience: 'grocery', grocery: 'grocery', greengrocer: 'grocery', general: 'grocery', butcher: 'grocery', deli: 'grocery', mall: 'shop', department_store: 'shop',
  bakery: 'bakery', pastry: 'bakery', confectionery: 'bakery', mosque: 'mosque', church: 'church', worship: 'worship', parking: 'parking', police: 'police',
  museum: 'museum', attraction: 'attraction', viewpoint: 'viewpoint', zoo: 'zoo', theme_park: 'attraction', gallery: 'theatre',
  castle: 'castle', fort: 'castle', ruins: 'castle', archaeological_site: 'castle', citadel: 'castle', city_gate: 'castle', monument: 'monument', memorial: 'monument', tomb: 'monument',
  marketplace: 'shop', clothes: 'clothing', shoes: 'clothing', hairdresser: 'hairdresser', beauty: 'hairdresser',
  school: 'school', kindergarten: 'school', university: 'college', college: 'college', post: 'post', townhall: 'town_hall', courthouse: 'town_hall', embassy: 'town_hall',
  fire_station: 'fire_station', library: 'library', bus: 'bus', airport: 'airport', toilets: 'toilets', park: 'park', water_park: 'swimming', stadium: 'pitch',
  cinema: 'cinema', theatre: 'theatre', bar: 'bar', pub: 'bar', nightclub: 'bar', car_rental: 'car', car_repair: 'car', car_wash: 'car', car: 'car', car_parts: 'car', tyres: 'car',
};
// OSM-like tags for the place card (catIcon/catLabel in core.js understand these)
const TAGS = {
  hotel: s => ({ tourism: s }), money: s => ({ amenity: s === 'exchange' ? 'bureau_de_change' : s }), food: s => ({ amenity: s }), cafe: s => ({ amenity: s }),
  fuel: s => ({ amenity: s }), pharmacy: () => ({ amenity: 'pharmacy' }), hospital: () => ({ amenity: 'hospital' }), clinic: s => ({ amenity: s === 'dentist' ? 'dentist' : s === 'veterinary' ? 'veterinary' : 'clinic' }),
  grocery: s => ({ shop: s }), bakery: s => ({ shop: s }), mosque: () => ({ amenity: 'place_of_worship', religion: 'muslim' }), church: () => ({ amenity: 'place_of_worship', religion: 'christian' }),
  worship: () => ({ amenity: 'place_of_worship' }), parking: () => ({ amenity: 'parking' }), police: () => ({ amenity: 'police' }), toilets: () => ({ amenity: 'toilets' }),
  sight: s => (['museum', 'attraction', 'viewpoint', 'zoo', 'theme_park', 'gallery'].includes(s) ? { tourism: s } : { historic: s }),
  shop: s => (s === 'marketplace' ? { amenity: 'marketplace' } : { shop: s }), edu: s => ({ amenity: s }), gov: s => ({ amenity: s === 'post' ? 'post_office' : s }),
  transport: s => (s === 'airport' ? { aeroway: 'aerodrome' } : { amenity: 'bus_station' }), park: s => ({ leisure: s }), car: s => ({ amenity: s }), fun: s => ({ amenity: s }),
};
// filter chips (search.js CATS keys) -> data categories
export const CHIP_CATS = {
  restaurants: ['food'], cafes: ['cafe'], fuel: ['fuel'], pharmacy: ['pharmacy'], mosque: ['mosque'], hotel: ['hotel'], atm: ['money'], supermarket: ['grocery'],
  hospital: ['hospital', 'clinic'], parking: ['parking'], tourism: ['sight'], church: ['church'], bakery: ['bakery'], police: ['police'], toilets: ['toilets'],
};
// category words (EN / AR / DE, singular + plural, common colloquial forms) -> chip key
const WORDS = {
  hotel: 'hotel hotels hostel hostels motel guesthouse guest lodging inn فندق فنادق نزل اوتيل أوتيل لوكندة موتيل استراحة unterkunft pension herberge',
  atm: 'atm atms cash bank banks money exchange cashpoint صراف صرافه صرافة صراف_آلي مصرف مصارف بنك بنوك صيرفة صيرفه تحويل geldautomat geldautomaten bankautomat banken wechselstube',
  restaurants: 'restaurant restaurants food eat dining fastfood shawarma falafel مطعم مطاعم اكل أكل شاورما فلافل وجبات essen imbiss',
  cafes: 'cafe cafes café coffee tea قهوة مقهى مقاهي كافيه كافتيريا كوفي kaffee café',
  fuel: 'fuel gas petrol station diesel benzin tankstelle tankstellen كازية كازيات محطة وقود بنزين مازوت محروقات',
  pharmacy: 'pharmacy pharmacies chemist drugstore صيدلية صيدليات apotheke apotheken',
  hospital: 'hospital hospitals clinic clinics doctor emergency مستشفى مشفى مستشفيات مشافي عيادة عيادات طبيب طوارئ krankenhaus klinik arzt notaufnahme',
  supermarket: 'supermarket grocery groceries market shop store سوبرماركت بقالية بقالة سمانة ماركت supermarkt lebensmittel',
  mosque: 'mosque mosques masjid jami مسجد مساجد جامع جوامع moschee moscheen',
  church: 'church churches cathedral كنيسة كنائس كاتدرائية kirche kirchen',
  bakery: 'bakery bakeries bread فرن افران أفران مخبز مخابز خبز bäckerei baeckerei bäcker',
  parking: 'parking park موقف مواقف كراج parkplatz parken',
  tourism: 'attraction attractions museum sight sights castle citadel ruins متحف معلم معالم قلعة اثار آثار sehenswürdigkeit museum burg',
  police: 'police قسم شرطة مخفر polizei',
  toilets: 'toilet toilets wc restroom حمام حمامات تواليت toilette',
};

// ---------- normalisation ----------
export function norm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')             // Latin diacritics
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')       // tashkeel, superscript alef, tatweel
    .replace(/[أإآٱ]/g, 'ا').replace(/[ىی]/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ک/g, 'ك')
    .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const tokens = s => { const out = []; for (const w of norm(s).split(' ')) if (w) { out.push(w); if (w.startsWith('ال') && w.length > 3) out.push(w.slice(2)); } return out; };
const WORD2CHIP = new Map();
for (const [k, v] of Object.entries(WORDS)) for (const w of v.split(' ')) for (const tk of tokens(w.replace(/_/g, ' '))) if (!WORD2CHIP.has(tk)) WORD2CHIP.set(tk, k);

// ---------- data ----------
export const P = { all: [], geo: null, meta: null, ready: null, byOsm: new Map() };
export function loadPois() {
  if (P.ready) return P.ready;
  P.ready = fetch(DATA_URL).then(r => r.json()).then(j => {
    P.meta = { date: j.date, source: j.source, counts: j.counts };
    const feats = [];
    for (const r of j.f) {
      const [lon, lat, ci, si, osm, name = '', ar = '', en = '', oh = '', ph = '', w = '', st = '', ex = ''] = r;
      const c = j.cats[ci], s = j.subs[si], [grp, imp0] = CAT[c] || ['civic', 1];
      const named = !!(name || ar || en);
      const rec = { lon, lat, c, s, osm, name, ar, en, oh, ph, w, st, ex, grp, sp: SPRITE[s] || (c === 'shop' ? 'shop' : 'generic') };
      rec.tok = [...new Set([...tokens(name), ...tokens(ar), ...tokens(en)])];
      rec.i = P.all.length; P.all.push(rec); P.byOsm.set(osm, rec.i);
      const props = { i: rec.i, c, g: grp, sp: rec.sp, imp: named ? imp0 : 0, rank: (3 - imp0) * 10 + (st ? 0 : 5) + (named ? 0 : 9) };
      if (name) props.name = name; if (ar) props['name:ar'] = ar; if (en) props['name:en'] = en;
      if (!name && (ar || en)) props.name = ar || en;
      feats.push({ type: 'Feature', id: rec.i, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props });
    }
    P.geo = { type: 'FeatureCollection', features: feats };
    return P;
  });
  return P.ready;
}
export function toItem(rec) {
  const tags = Object.assign({}, (TAGS[rec.c] || (() => ({})))(rec.s));
  if (rec.name) tags.name = rec.name; if (rec.ar) tags['name:ar'] = rec.ar; if (rec.en) tags['name:en'] = rec.en;
  if (!tags.name && (rec.ar || rec.en)) tags.name = rec.ar || rec.en;
  if (rec.oh) tags.opening_hours = rec.oh; if (rec.ph) tags.phone = rec.ph; if (rec.w) tags.website = rec.w; if (rec.st) tags.stars = rec.st;
  if (rec.ex) tags[rec.c === 'food' || rec.c === 'cafe' ? 'cuisine' : 'brand'] = rec.ex;
  const t = { n: 'node', w: 'way', r: 'relation' }[rec.osm[0]], id = +rec.osm.slice(1);
  return { id: t[0].toUpperCase() + id, osm_type: t, osm_id: id, lon: rec.lon, lat: rec.lat, tags, poi: rec.i };
}

// ---------- map layers ----------
let state = { cats: new Set(), openNow: false };
export const LAYERS = ['kh-poi-1', 'kh-poi-2', 'kh-poi-3', 'kh-poi-0', 'kh-poi-f'];
export function poiLayerIds() { return LAYERS; }
export function addPoiLayers(map, dark) {
  if (!P.geo || map.getSource('kh-poi')) return;
  map.addSource('kh-poi', { type: 'geojson', data: P.geo, buffer: 32, maxzoom: 16 });
  const before = map.getLayer('poi-transit') ? 'poi-transit' : map.getLayer('label-airport') ? 'label-airport' : undefined;
  const tc = GROUP_TEXT[dark ? 'dark' : 'light'];
  const textColor = ['match', ['get', 'g'], ...Object.entries(tc).flat(), tc.civic];
  const halo = (map.getLayer('poi') && map.getPaintProperty('poi', 'text-halo-color')) || (dark ? 'rgba(28,28,30,0.92)' : 'rgba(244,242,238,0.92)');
  const lay = (id, minzoom, filter, size, textFrom) => ({
    id, type: 'symbol', source: 'kh-poi', minzoom, filter, metadata: { 'khareeta:label': true },
    layout: {
      'icon-image': ['get', 'sp'], 'icon-size': ['interpolate', ['linear'], ['zoom'], minzoom, size, 17, 1], 'icon-padding': 3,
      'text-field': ['step', ['zoom'], '', textFrom, ['coalesce', ['get', 'name:en'], ['get', 'name']]],
      'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 17, 12.5], 'text-max-width': 8, 'text-line-height': 1.2,
      'text-variable-anchor': ['right', 'left', 'top', 'bottom'], 'text-radial-offset': 1.1, 'text-justify': 'auto', 'text-optional': true,
      'symbol-sort-key': ['get', 'rank'],
    },
    paint: { 'text-color': textColor, 'text-halo-color': halo, 'text-halo-width': 1.5, 'text-halo-blur': 0.5, 'icon-opacity': ['interpolate', ['linear'], ['zoom'], minzoom, 0, minzoom + 0.4, 1] },
  });
  map.addLayer(lay('kh-poi-1', 12.5, ['==', ['get', 'imp'], 3], 0.72, 14), before);
  map.addLayer(lay('kh-poi-2', 14, ['==', ['get', 'imp'], 2], 0.8, 15), before);
  map.addLayer(lay('kh-poi-3', 15.5, ['==', ['get', 'imp'], 1], 0.85, 16), before);
  map.addLayer(lay('kh-poi-0', 16.5, ['==', ['get', 'imp'], 0], 0.85, 22), before);
  map.addLayer(lay('kh-poi-f', 8, ['==', ['get', 'c'], '__none__'], 0.8, 13), before);
  map.setLayoutProperty('kh-poi-f', 'icon-allow-overlap', ['step', ['zoom'], false, 15, true]);
  // our layer supersedes the sparse OpenMapTiles POIs (transit/airport stay)
  for (const id of ['poi', 'poi-dot']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  applyFilterToMap(map);
}
export function setPoiVisible(map, on) {
  for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  if (on) applyFilterToMap(map);
}
let selIdx = null;
export function setPoiSelected(map, idx) { selIdx = idx; applyFilterToMap(map); }
function withSel(f) { return selIdx == null ? f : ['all', f, ['!=', ['get', 'i'], selIdx]]; }
function applyFilterToMap(map) {
  if (!map.getLayer('kh-poi-f')) return;
  const active = state.cats.size > 0;
  for (const [id, imp] of [['kh-poi-1', 3], ['kh-poi-2', 2], ['kh-poi-3', 1], ['kh-poi-0', 0]]) {
    map.setLayoutProperty(id, 'visibility', active ? 'none' : 'visible');
    map.setFilter(id, withSel(['==', ['get', 'imp'], imp]));
  }
  let f = ['==', ['get', 'c'], '__none__'];
  if (active) {
    const cats = [...state.cats].flatMap(k => CHIP_CATS[k] || []);
    f = ['in', ['get', 'c'], ['literal', cats]];
    if (state.openNow) f = ['all', f, ['in', ['get', 'i'], ['literal', openIdx(cats)]]];
  }
  map.setLayoutProperty('kh-poi-f', 'visibility', active ? 'visible' : 'none');
  map.setFilter('kh-poi-f', withSel(f));
}
let openCache = { k: '', t: 0, v: [] };
function openIdx(cats) {
  const k = cats.join(); if (openCache.k === k && Date.now() - openCache.t < 60000) return openCache.v;
  const v = P.all.filter(r => cats.includes(r.c) && r.oh && ohStatus(r.oh)?.open).map(r => r.i);
  openCache = { k, t: Date.now(), v }; return v;
}
export function getFilter() { return state; }
export function setFilter(map, cats, openNow = state.openNow) { state = { cats: new Set(cats), openNow }; applyFilterToMap(map); }

// results for the current filter, nearest first
export function filterResults(ref, limit = 80) {
  const cats = [...state.cats].flatMap(k => CHIP_CATS[k] || []);
  let list = P.all.filter(r => cats.includes(r.c));
  const withHours = list.filter(r => r.oh).length;
  if (state.openNow) list = list.filter(r => r.oh && ohStatus(r.oh)?.open);
  for (const r of list) r.d = haversine(ref, [r.lon, r.lat]);
  list.sort((a, b) => a.d - b.d);
  return { total: list.length, near: list.filter(r => r.d < 10000).length, withHours, list: list.slice(0, limit) };
}

// ---------- local search ----------
function lev1(a, b) { // edit distance <= 1 ?
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}
/** Returns { chip, items } – chip: matched category key (e.g. 'hotel' for 'فنادق'), items: best local POIs. */
export function searchLocal(text, ref, limit = 6) {
  if (!P.all.length) return { chip: null, items: [] };
  let q = tokens(text).filter((w, i, a) => !(w.length > 3 && a.includes('ال' + w)));
  if (!q.length) return { chip: null, items: [] };
  let chip = null;
  const catTok = q.find(w => WORD2CHIP.has(w));
  if (catTok) chip = WORD2CHIP.get(catTok);
  const rest = chip ? q.filter(w => WORD2CHIP.get(w) !== chip) : q;
  const cats = chip ? CHIP_CATS[chip] : null;
  const out = [];
  if (!rest.length) {
    if (!cats) return { chip, items: [] };
    const near = P.all.filter(r => cats.includes(r.c) && (r.name || r.ar || r.en)).map(r => [haversine(ref, [r.lon, r.lat]), r]).sort((a, b) => a[0] - b[0]).slice(0, Math.min(limit, 4));
    return { chip, items: near.map(([d, r]) => Object.assign(r, { d })) };
  }
  for (const r of P.all) {
    if (!r.tok.length) continue;
    let score = 0, ok = true;
    for (const w of rest) {
      let best = 0;
      for (const tk of r.tok) {
        if (tk === w) { best = 3; break; }
        if (w.length >= 2 && tk.startsWith(w)) best = Math.max(best, 2);
        else if (w.length >= 4 && tk.includes(w)) best = Math.max(best, 1.5);
        else if (w.length >= 4 && (lev1(w, tk) || lev1(w, tk.slice(0, w.length)))) best = Math.max(best, 1);
      }
      if (!best) { ok = false; break; }
      score += best;
    }
    if (!ok) continue;
    if (cats && !cats.includes(r.c)) score -= 1.5;
    const d = haversine(ref, [r.lon, r.lat]);
    score += { 3: 0.6, 2: 0.3, 1: 0, 0: 0 }[CAT[r.c]?.[1] ?? 1] - Math.min(2, Math.log10(1 + d / 1000) * 0.7);
    out.push([score, d, r]);
  }
  out.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return { chip, items: out.slice(0, limit).map(([, d, r]) => Object.assign(r, { d })) };
}
export function poiIndexFor(item) {
  if (!item) return null;
  if (item.poi != null) return item.poi;
  if (!item.osm_type || item.osm_id == null) return null;
  const v = P.byOsm.get(item.osm_type[0] + item.osm_id); return v == null ? null : v;
}
export function poiStatus(rec) { return rec.oh ? ohStatus(rec.oh) : null; }
