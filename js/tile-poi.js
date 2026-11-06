// Worldwide POIs straight from the OpenMapTiles vector tiles (layer "poi", already cached with the base map →
// no extra requests). Pure helpers (no DOM) → unit-tested in tests/poi. Syria keeps its own GeoJSON (js/poi.js);
// the style filters tile POIs inside the Syria border polygon out (js/syria-poly.js + tools/poi/style-poi.mjs); these helpers skip them as well. SY_BBOX stays for non-POI uses.
import { inBox } from './world-core.js';
import { inSyria } from './syria-poly.js';

/** style layers that draw tile POIs (z14 badges, z15 labelled, z16+ all) */
export const TILE_POI_LAYERS = ['poi-dot', 'poi-z15', 'poi'];
const SHOP_CLASSES = new Set(['shop', 'grocery', 'clothing_store', 'hairdresser', 'bakery', 'alcohol_shop', 'florist', 'furniture', 'hardware', 'doityourself', 'jewelry', 'mobile_phone', 'electronics', 'gift', 'shoes', 'butcher', 'greengrocer', 'convenience', 'supermarket', 'beauty', 'books', 'car', 'bicycle', 'optician']);
const TOURISM = new Set(['lodging', 'museum', 'attraction', 'campsite', 'zoo', 'information', 'art_gallery']);
const HISTORIC = new Set(['castle', 'monument', 'memorial', 'ruins', 'archaeological_site']);
const LEISURE = new Set(['park', 'garden', 'playground', 'pitch', 'stadium', 'sports_centre', 'swimming', 'swimming_pool', 'golf', 'water_park', 'nature_reserve']);
const AMENITY_FIX = { doctors: 'doctors', clinic: 'clinic', town_hall: 'townhall', post: 'post_office', bus: 'bus_station', college: 'college' };

/** OpenMapTiles poi properties (class/subclass/name*) → OSM-like tags for the place sheet, catIcon and catLabel */
export function tileTags(p = {}) {
  const tags = {};
  for (const k of ['name', 'name:ar', 'name:en', 'name:de', 'name:latin', 'name_int']) if (p[k]) tags[k === 'name_int' ? 'int_name' : k] = p[k];
  const c = p.class || '', s = p.subclass || c;
  if (c === 'place_of_worship') { tags.amenity = 'place_of_worship'; if (s && s !== 'place_of_worship') tags.religion = s; }
  else if (c === 'office') tags.office = s;
  else if (c === 'lodging') tags.tourism = s === 'lodging' ? 'hotel' : s;
  else if (c === 'art_gallery') tags.tourism = s === 'gallery' ? 'gallery' : s === 'artwork' ? 'artwork' : 'gallery';
  else if (TOURISM.has(c)) tags.tourism = s;
  else if (HISTORIC.has(c)) tags.historic = s;
  else if (LEISURE.has(c)) tags.leisure = s;
  else if (SHOP_CLASSES.has(c)) tags.shop = s === 'clothing_store' ? 'clothes' : s;
  else tags.amenity = AMENITY_FIX[s] || s;
  if (p.level != null) tags.level = String(p.level);
  return tags;
}
/** OpenMapTiles feature id → OSM object (OpenFreeMap encodes osm_id*10 + 1 node / 2 way / 3 relation) */
export function tileOsm(id) {
  const n = Number(id); if (!Number.isFinite(n) || n <= 0) return null;
  const t = { 1: 'node', 2: 'way', 3: 'relation' }[n % 10];
  return t ? { osm_type: t, osm_id: Math.floor(n / 10) } : null;
}
/** category chip (js/search.js CATS keys) → test on tile properties */
const CHIP = {
  restaurants: p => ['restaurant', 'fast_food'].includes(p.class) || p.subclass === 'food_court',
  cafes: p => ['cafe', 'ice_cream'].includes(p.class),
  fuel: p => p.class === 'fuel' && p.subclass !== 'charging_station',
  pharmacy: p => p.class === 'pharmacy' && p.subclass !== 'chemist', // shop=chemist = drugstore, not a pharmacy
  mosque: p => p.class === 'place_of_worship' && p.subclass === 'muslim',
  church: p => p.class === 'place_of_worship' && p.subclass === 'christian',
  hotel: p => p.class === 'lodging' && ['hotel', 'hostel', 'guest_house', 'motel'].includes(p.subclass),
  atm: p => ['atm', 'bank'].includes(p.class) || p.subclass === 'bureau_de_change',
  supermarket: p => ['supermarket', 'convenience', 'greengrocer', 'grocery'].includes(p.subclass),
  hospital: p => p.class === 'hospital' || p.class === 'doctors',
  parking: p => p.class === 'parking',
  tourism: p => ['attraction', 'museum', 'castle', 'monument'].includes(p.class) || p.subclass === 'viewpoint',
  bakery: p => p.class === 'bakery' || ['bakery', 'pastry', 'confectionery'].includes(p.subclass),
  police: p => p.class === 'police',
  school: p => ['school', 'kindergarten', 'university', 'college'].includes(p.class) || ['school', 'kindergarten', 'university', 'college'].includes(p.subclass),
  toilets: p => p.class === 'toilets',
};
export function tileMatchesChip(key, p) { const f = CHIP[key]; return !!(f && p && p.name && f(p)); }

const R = 6371008.8, rad = Math.PI / 180;
function dist(a, b) { const x = (b[0] - a[0]) * rad * Math.cos((a[1] + b[1]) / 2 * rad), y = (b[1] - a[1]) * rad; return Math.hypot(x, y) * R; }
/**
 * Features from map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi' }) → result items for a chip.
 * Deduplicates tile-boundary copies (same id or same name ≤ 30 m), skips Syria (bundled data there), sorts by distance.
 */
export function tileCategoryItems(features, key, ref, nameOf = t => t.name, max = 100, box = null) { // box: [W,S,E,N]
  const out = [], seen = new Set();
  for (const f of features || []) {
    const p = f.properties || {}, c = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    if (!c || !tileMatchesChip(key, p) || inSyria(c[0], c[1]) || (box && !inBox(c[0], c[1], box))) continue;
    const osm = tileOsm(f.id), k = osm ? osm.osm_type[0] + osm.osm_id : '';
    if (k && seen.has(k)) continue;
    if (out.some(o => o.tags.name === p.name && dist([o.lon, o.lat], c) < 30)) continue;
    if (k) seen.add(k);
    const tags = tileTags(p);
    out.push({ id: osm ? osm.osm_type[0].toUpperCase() + osm.osm_id : 't' + c.join(), ...(osm || {}), name: nameOf(tags), lon: c[0], lat: c[1], tags, d: ref ? dist(ref, c) : 0, tile: true });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max);
}
/** live (Overpass) results win; tile items are added when no live item has the same OSM id or name within 60 m */
export function mergeTileItems(live, tile) {
  const ids = new Set(live.map(x => x.id));
  const extra = tile.filter(t => !ids.has(t.id) && !live.some(l => l.tags?.name && l.tags.name === t.tags.name && dist([l.lon, l.lat], [t.lon, t.lat]) < 60));
  return [...live, ...extra].sort((a, b) => a.d - b.d);
}
