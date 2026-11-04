// Overture Places layer – pure data helpers (no DOM, no map): tile maths, row → place item, category labels.
// Used by js/overture.js and tests/overture. Data: data/overture/index.json + t<x>_<y>.json (scripts/overture/build_overture.py).
// Overture data is untrusted: links are validated by js/links.js when the place sheet renders them.
export const OV_DIR = './data/overture/';
export const OV_MINZOOM = 14;
// simplified Syria outline (Natural Earth 1:110m, coast moved a little offshore so Latakia/Tartus/Jableh/Baniyas are inside; lon/lat). The layer, index.json and the attribution only load inside it:
// Beirut or Gaziantep never fetch anything. scripts/overture/build_overture.py reads this same list.
export const OV_SY = [[38.792,33.379],[36.834,32.313],[35.72,32.709],[35.701,32.716],[35.836,32.868],[35.821,33.277],[36.066,33.825],[36.612,34.202],[36.448,34.594],[35.98,34.64],[35.84,34.76],[35.78,35.0],[35.74,35.3],[35.66,35.55],[35.72,35.85],[35.92,35.93],[36.15,35.822],[36.418,36.041],[36.685,36.26],[36.739,36.818],[37.067,36.623],[38.168,36.901],[38.7,36.713],[39.523,36.716],[40.673,37.091],[41.212,37.074],[42.35,37.23],[41.837,36.606],[41.29,36.359],[41.384,35.628],[41.006,34.419],[38.792,33.379]];
export const OV_BBOX = [35.66, 32.31, 42.35, 37.23]; // bbox of OV_SY (W, S, E, N)
export const OV_HIDE_KEY = 'kh.ovHidden';
export const OV_REASONS = ['private', 'wrong', 'closed'];
export function inSyria(lon, lat) {
  let ins = false;
  for (let i = 0, j = OV_SY.length - 1; i < OV_SY.length; j = i++) {
    const [xi, yi] = OV_SY[i], [xj, yj] = OV_SY[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
// view [w, s, e, n] overlaps the outline: a corner/centre inside, or an outline vertex inside the view
export function touchesSyria([w, s, e, n]) {
  if (e < OV_BBOX[0] || w > OV_BBOX[2] || n < OV_BBOX[1] || s > OV_BBOX[3]) return false;
  const pts = [[w, s], [w, n], [e, s], [e, n], [(w + e) / 2, (s + n) / 2]];
  return pts.some(([x, y]) => inSyria(x, y)) || OV_SY.some(([x, y]) => x >= w && x <= e && y >= s && y <= n);
}
export const OV_MAX_TILES = 40; // tiles loaded for one view at most
export const OV_LICENSE_URL = 'https://cdla.dev/permissive-2-0/';
export const OV_ATTR_URL = 'https://docs.overturemaps.org/attribution/';

// tile keys ("x_y", 1/scale degree) intersecting [w, s, e, n] that exist in the index
export function tilesFor(bounds, index) {
  if (!index || !index.tiles) return [];
  const k = Math.round(1 / index.tile), [w, s, e, n] = bounds, out = [];
  if (!touchesSyria(bounds)) return out;
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
  return touchesSyria(bounds);
}
// one compact row → place item for js/place.js (tags in OSM style so links.js can validate phone/website/socials)
export function ovItem(row, index, key = '') {
  const [lon, lat, oid = '', name = '', ci = -1, phone = '', web = '', fb = '', ig = ''] = row;
  const cat = index.cats[ci] || '';
  const tags = { name: String(name) };
  if (phone) tags.phone = String(phone);
  if (web) tags.website = String(web);
  if (fb) tags['contact:facebook'] = String(fb);
  if (ig) tags['contact:instagram'] = String(ig);
  return { id: 'ov' + key + ':' + lon + ',' + lat, ovId: String(oid), ov: true, ovCat: cat, lon, lat, name: tags.name, tags, full: true };
}
export function ovFeature(row, index, i) {
  const [lon, lat, , name = '', ci = -1] = row, [g, sp] = (index.groups && index.groups[ci]) || ['civic', 'generic'];
  return { type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { i, name: String(name), g, sp } };
}
// Overture category → label [EN, AR, DE]; covers every category on the build allowlist (tests check this)
const CAT_L = {
  restaurant: ['Restaurant', 'مطعم', 'Restaurant'], cafe: ['Café', 'مقهى', 'Café'], coffee_shop: ['Coffee shop', 'مقهى', 'Café'],
  casual_eatery: ['Eatery', 'مطعم شعبي', 'Imbiss'], fast_food_restaurant: ['Fast food', 'وجبات سريعة', 'Fast Food'], bar: ['Bar', 'بار', 'Bar'],
  lounge: ['Lounge', 'صالة استراحة', 'Lounge'], dance_club: ['Nightclub', 'ملهى ليلي', 'Club'], smoothie_juice_bar: ['Juice bar', 'محل عصائر', 'Saftbar'],
  non_alcoholic_beverage_venue: ['Drinks', 'مشروبات', 'Getränke'], alcoholic_beverage_venue: ['Drinks bar', 'حانة', 'Kneipe'],
  food_and_drink: ['Food & drink', 'طعام وشراب', 'Essen & Trinken'], food_service: ['Food service', 'خدمات طعام', 'Gastronomie'],
  food_truck_stand: ['Food stand', 'كشك طعام', 'Imbissstand'], bakery: ['Bakery', 'مخبز', 'Bäckerei'],
  food_and_beverage_store: ['Food store', 'متجر أغذية', 'Lebensmittelgeschäft'], grocery_store: ['Grocery', 'بقالية', 'Lebensmittel'],
  supermarket: ['Supermarket', 'سوبرماركت', 'Supermarkt'], convenience_store: ['Convenience store', 'بقالية', 'Späti'],
  shopping: ['Shop', 'متجر', 'Geschäft'], shopping_mall: ['Shopping mall', 'مركز تسوق', 'Einkaufszentrum'], market: ['Market', 'سوق', 'Markt'],
  specialty_store: ['Specialty store', 'متجر متخصص', 'Fachgeschäft'], department_store: ['Department store', 'متجر متعدد الأقسام', 'Kaufhaus'],
  discount_store: ['Discount store', 'متجر تخفيضات', 'Discounter'], warehouse_club_store: ['Wholesale store', 'متجر جملة', 'Großmarkt'],
  fashion_and_apparel_store: ['Clothing store', 'متجر ألبسة', 'Bekleidungsgeschäft'], electronics_store: ['Electronics store', 'متجر إلكترونيات', 'Elektronikgeschäft'],
  hardware_home_and_garden_store: ['Hardware store', 'متجر أدوات', 'Baumarkt'], flowers_and_gifts_store: ['Flowers & gifts', 'زهور وهدايا', 'Blumen & Geschenke'],
  books_music_and_video_store: ['Bookshop', 'مكتبة', 'Buchhandlung'], personal_care_and_beauty_store: ['Cosmetics store', 'متجر مستحضرات تجميل', 'Drogerie'],
  arts_crafts_and_hobby_store: ['Craft store', 'متجر حرف وهوايات', 'Bastelladen'], animal_and_pet_store: ['Pet shop', 'متجر حيوانات أليفة', 'Tierhandlung'],
  toys_and_games_store: ['Toy store', 'متجر ألعاب', 'Spielwarengeschäft'], office_supply_store: ['Stationery', 'قرطاسية', 'Schreibwaren'],
  sporting_goods_store: ['Sports store', 'متجر رياضة', 'Sportgeschäft'], vehicle_parts_store: ['Car parts', 'قطع سيارات', 'Autoteile'],
  musical_instrument_and_pro_audio_store: ['Music store', 'متجر آلات موسيقية', 'Musikgeschäft'],
  hotel: ['Hotel', 'فندق', 'Hotel'], lodging: ['Lodging', 'نزل', 'Unterkunft'], resort: ['Resort', 'منتجع', 'Resort'],
  personal_or_beauty_service: ['Beauty salon', 'صالون تجميل', 'Kosmetiksalon'], automotive_service: ['Car service', 'خدمات سيارات', 'Autoservice'],
  vehicle_service: ['Car service', 'خدمات سيارات', 'Autoservice'], auto_dealer: ['Car dealer', 'معرض سيارات', 'Autohaus'],
  vehicle_dealer: ['Vehicle dealer', 'معرض مركبات', 'Fahrzeughändler'], printing_service: ['Print shop', 'مطبعة', 'Druckerei'],
  laundry_service: ['Laundry', 'مغسلة', 'Wäscherei'], rental_service: ['Rental', 'تأجير', 'Verleih'], bank_or_credit_union: ['Bank', 'مصرف', 'Bank'],
  financial_service: ['Money service', 'خدمات مالية', 'Finanzdienst'], real_estate_service: ['Real estate', 'مكتب عقاري', 'Immobilien'],
  travel_service: ['Travel agency', 'مكتب سفر', 'Reisebüro'], taxi_or_ride_share_service: ['Taxi', 'تكسي', 'Taxi'],
  shipping_or_delivery_service: ['Delivery service', 'خدمة توصيل', 'Lieferdienst'], gym: ['Gym', 'نادٍ رياضي', 'Fitnessstudio'],
  sport_or_fitness_facility: ['Fitness', 'مركز لياقة', 'Fitness'], swimming_pool: ['Swimming pool', 'مسبح', 'Schwimmbad'],
  animal_or_pet_service: ['Pet service', 'خدمات حيوانات أليفة', 'Tierservice'], movie_theater: ['Cinema', 'سينما', 'Kino'],
  gas_station: ['Fuel station', 'محطة وقود', 'Tankstelle'], fueling_station: ['Fuel station', 'محطة وقود', 'Tankstelle'],
  amusement_park: ['Amusement park', 'مدينة ملاهٍ', 'Freizeitpark'], arcade: ['Arcade', 'صالة ألعاب', 'Spielhalle'],
  hospital: ['Hospital', 'مستشفى', 'Krankenhaus'], emergency_department: ['Emergency', 'إسعاف', 'Notaufnahme'],
  dental_clinic: ['Dental clinic', 'عيادة أسنان', 'Zahnarztpraxis'], pharmacy_and_drug_store: ['Pharmacy', 'صيدلية', 'Apotheke'],
  diagnostics_imaging_or_lab_service: ['Medical lab', 'مختبر طبي', 'Labor'], surgery: ['Surgery', 'جراحة', 'Chirurgie'],
  outpatient_care_facility: ['Outpatient clinic', 'عيادات خارجية', 'Ambulanz'], vision_or_eye_care_clinic: ['Eye clinic', 'عيادة عيون', 'Augenarzt'],
  pediatric_clinic: ['Paediatric clinic', 'عيادة أطفال', 'Kinderarzt'], specialized_medical_facility: ['Medical centre', 'مركز طبي', 'Medizinisches Zentrum'],
  health_care: ['Health care', 'رعاية صحية', 'Gesundheit'], specialized_health_care: ['Specialist care', 'رعاية تخصصية', 'Facharzt'],
  medical_service: ['Medical service', 'خدمات طبية', 'Medizinischer Dienst'], reproductive_perinatal_and_womens_care: ["Women's health", 'صحة المرأة', 'Frauenarzt'],
  physical_medicine_and_rehabilitation: ['Physiotherapy', 'علاج فيزيائي', 'Physiotherapie'], behavioral_or_mental_health_clinic: ['Mental health', 'صحة نفسية', 'Psychotherapie'],
};
export const OV_CATS = Object.keys(CAT_L);
export function ovCatLabel(cat, lang = 'en') {
  const l = CAT_L[cat]; if (l) return l[lang === 'ar' ? 1 : lang === 'de' ? 2 : 0];
  const s = String(cat || '').replace(/_/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : '';
}

// "Report / remove": hidden ids live only on this device (localStorage); the report is one anonymous analytics event
// through the existing Supabase path (js/analytics.js track(): publishable insert-only key, off with kh.noTrack / DNT / GPC).
export function ovHidden(store = globalThis.localStorage) {
  try { return new Set(JSON.parse(store?.getItem(OV_HIDE_KEY) || '[]')); } catch { return new Set(); }
}
export function ovReport(id, reason, { store = globalThis.localStorage, track } = {}) {
  if (!id || !OV_REASONS.includes(reason)) return false;
  const h = ovHidden(store); h.add(String(id));
  try { store?.setItem(OV_HIDE_KEY, JSON.stringify([...h].slice(-500))); } catch {}
  // kh_events.type has a check constraint, so the report rides on the allowed 'layer' type with k = 'ov_report'
  try { track?.('layer', { k: 'ov_report', id: String(id).slice(0, 40), r: reason }); } catch {}
  return true;
}
