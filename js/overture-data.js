// Overture Places layer – pure data helpers (no DOM, no map): tile maths, row → place item, category labels.
// Used by js/overture.js and tests/overture. Data: data/overture/index.json + t<x>_<y>.json (scripts/overture/build_overture.py).
// Overture data is untrusted: links are validated by js/links.js when the place sheet renders them.
export const OV_DIR = './data/overture/';
export const OV_MINZOOM = 14;
export const OV_BBOX = [35.5, 32.2, 42.5, 37.5]; // Syria incl. margin (W, S, E, N)
export const OV_MAX_TILES = 40; // tiles loaded for one view at most
export const OV_LICENSE_URL = 'https://cdla.dev/permissive-2-0/';
export const OV_ATTR_URL = 'https://docs.overturemaps.org/attribution/';

// tile keys ("x_y", 1/scale degree) intersecting [w, s, e, n] that exist in the index
export function tilesFor(bounds, index) {
  if (!index || !index.tiles) return [];
  const k = Math.round(1 / index.tile), [w, s, e, n] = bounds, out = [];
  if (e < OV_BBOX[0] || w > OV_BBOX[2] || n < OV_BBOX[1] || s > OV_BBOX[3]) return out;
  for (let x = Math.floor(Math.max(w, OV_BBOX[0]) * k); x <= Math.floor(Math.min(e, OV_BBOX[2]) * k); x++)
    for (let y = Math.floor(Math.max(s, OV_BBOX[1]) * k); y <= Math.floor(Math.min(n, OV_BBOX[3]) * k); y++) {
      const key = x + '_' + y; if (index.tiles[key]) out.push(key);
      if (out.length >= OV_MAX_TILES) return out;
    }
  return out;
}
// layer is shown: setting on, zoom >= 14 and the view touches Syria
export function ovActive(on, zoom, bounds) {
  if (!on || zoom < OV_MINZOOM) return false;
  const [w, s, e, n] = bounds;
  return !(e < OV_BBOX[0] || w > OV_BBOX[2] || n < OV_BBOX[1] || s > OV_BBOX[3]);
}
// one compact row → place item for js/place.js (tags in OSM style so links.js can validate phone/website/socials)
export function ovItem(row, index, key = '') {
  const [lon, lat, name = '', ci = -1, phone = '', web = '', fb = '', ig = ''] = row;
  const cat = index.cats[ci] || '';
  const tags = { name: String(name) };
  if (phone) tags.phone = String(phone);
  if (web) tags.website = String(web);
  if (fb) tags['contact:facebook'] = String(fb);
  if (ig) tags['contact:instagram'] = String(ig);
  return { id: 'ov' + key + ':' + lon + ',' + lat, ov: true, ovCat: cat, lon, lat, name: tags.name, tags, full: true };
}
export function ovFeature(row, index, i) {
  const [lon, lat, name = '', ci = -1] = row, [g, sp] = (index.groups && index.groups[ci]) || ['civic', 'generic'];
  return { type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { i, name: String(name), g, sp } };
}
// Overture category → label in the UI language (common ones translated, otherwise "Dental clinic" style English)
const CAT_L = {
  restaurant: ['Restaurant', 'مطعم', 'Restaurant'], cafe: ['Café', 'مقهى', 'Café'], coffee_shop: ['Coffee shop', 'مقهى', 'Café'],
  hotel: ['Hotel', 'فندق', 'Hotel'], lodging: ['Lodging', 'نزل', 'Unterkunft'], hospital: ['Hospital', 'مستشفى', 'Krankenhaus'],
  dental_clinic: ['Dental clinic', 'عيادة أسنان', 'Zahnarztpraxis'], casual_eatery: ['Eatery', 'مطعم شعبي', 'Imbiss'],
  fast_food_restaurant: ['Fast food', 'وجبات سريعة', 'Fast Food'], bar: ['Bar', 'بار', 'Bar'], gym: ['Gym', 'نادٍ رياضي', 'Fitnessstudio'],
  personal_or_beauty_service: ['Beauty service', 'خدمات تجميل', 'Kosmetik'], fashion_and_apparel_store: ['Clothing store', 'متجر ألبسة', 'Bekleidungsgeschäft'],
  shopping: ['Shop', 'متجر', 'Geschäft'], shopping_mall: ['Shopping mall', 'مركز تسوق', 'Einkaufszentrum'],
  pharmacy_and_drug_store: ['Pharmacy', 'صيدلية', 'Apotheke'], electronics_store: ['Electronics store', 'متجر إلكترونيات', 'Elektronikgeschäft'],
  hardware_home_and_garden_store: ['Hardware store', 'متجر أدوات', 'Baumarkt'], health_care: ['Health care', 'رعاية صحية', 'Gesundheit'],
  diagnostics_imaging_or_lab_service: ['Medical lab', 'مختبر طبي', 'Labor'], professional_service: ['Professional service', 'خدمات مهنية', 'Dienstleistung'],
  travel_service: ['Travel agency', 'مكتب سفر', 'Reisebüro'], food_and_beverage_store: ['Food store', 'متجر أغذية', 'Lebensmittelgeschäft'],
  corporate_or_business_office: ['Office', 'مكتب', 'Büro'], flowers_and_gifts_store: ['Flowers & gifts', 'زهور وهدايا', 'Blumen & Geschenke'],
  financial_service: ['Financial service', 'خدمات مالية', 'Finanzdienst'], real_estate_service: ['Real estate', 'مكتب عقاري', 'Immobilien'],
  automotive_service: ['Car service', 'خدمات سيارات', 'Autoservice'], bakery: ['Bakery', 'مخبز', 'Bäckerei'],
};
export function ovCatLabel(cat, lang = 'en') {
  const l = CAT_L[cat]; if (l) return l[lang === 'ar' ? 1 : lang === 'de' ? 2 : 0];
  const s = String(cat || '').replace(/_/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : '';
}
