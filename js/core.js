// Shared state + sheet + marker helpers
import { setPoiSelected } from './poi.js';
import { pickNameFor } from './names.js';
import { $, esc } from './util.js';
import { ic, P } from './icons.js';
import { t, getLang } from './i18n.js';

export const App = { map: null, me: null, heading: null, mode: 'browse', markers: [], selMarker: null, history: [] };

// ---------- bottom sheet (DESIGN §4.2: JS detents, velocity, spring) ----------
const sheet = () => $('#sheet');
let sheetCloseCb = null, curY = null, anim = 0;
export const desktop = () => innerWidth >= 900;
const safeB = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k-safe-bottom')) || 0;
function detentPx(state) {
  const vh = innerHeight, H = sheet().offsetHeight || vh;
  if (state === 'hidden') return 0;
  if (state === 'peek') return Math.min(H, (App.peekH || 150) + safeB());
  if (state === 'half') return Math.min(H, Math.max(360, Math.round(vh * 0.5)));
  return H;
}
function setVisible(v, final) {
  const s = sheet(), H = s.offsetHeight || innerHeight;
  curY = v;
  s.style.transform = `translateY(${Math.round(H - v)}px)`;
  document.documentElement.style.setProperty('--sheet-visible', (desktop() ? 0 : Math.max(0, Math.round(Math.min(v, innerHeight * 0.6)))) + 'px');
  if (final) syncPadding();
}
export function mapPadding() {
  const st = sheet().dataset.state, top = App.topPad ?? 120;
  if (desktop()) { const side = st !== 'hidden' ? 432 : 0; return document.dir === 'rtl' ? { top: 20, bottom: 20, left: 20, right: side } : { top: 20, bottom: 20, left: side, right: 20 }; }
  const v = st === 'hidden' ? 0 : Math.min(detentPx(st), innerHeight * 0.5);
  return { top, bottom: Math.round(v), left: 0, right: 0 };
}
// fitBounds padding is ADDED to the map's own padding (sheet), so pass only the difference
export function fitTo(bounds, pad, opts = {}) {
  const m = App.map, cur = m.getPadding(), r = {};
  for (const k of ['top', 'bottom', 'left', 'right']) r[k] = Math.max(0, (pad[k] || 0) - (cur[k] || 0));
  const H = m.getContainer().clientHeight, W = m.getContainer().clientWidth;
  if (cur.top + cur.bottom + r.top + r.bottom > H - 60) { const ex = cur.top + cur.bottom + r.top + r.bottom - (H - 60); r.bottom = Math.max(0, r.bottom - ex); }
  if (cur.left + cur.right + r.left + r.right > W - 60) { r.left = r.right = 0; }
  // opts.minZoom: never zoom out further than this (a city bbox would otherwise end up at ~z9); keep the bounds' centre
  const { minZoom, ...o } = opts;
  if (minZoom != null) { const cam = m.cameraForBounds(bounds, { padding: r, maxZoom: o.maxZoom }); if (cam && cam.zoom < minZoom) { const lb = maplibregl.LngLatBounds.convert(bounds).getCenter(); m.easeTo({ center: lb, zoom: minZoom, offset: [(r.left - r.right) / 2, (r.top - r.bottom) / 2] /* bounds' centre in the middle of the free area (above the sheet), at any zoom */, bearing: cam.bearing ?? m.getBearing(), duration: o.duration ?? 500 }); return; } }
  m.fitBounds(bounds, { ...o, padding: r });
}
let padWait = false;
// Apply the sheet padding without moving the visible map (keeps what is on screen in place)
export function syncPadding() {
  const m = App.map; if (!m || App.navMode) return;
  if (m.isMoving()) { if (!padWait) { padWait = true; m.once('moveend', () => { padWait = false; syncPadding(); }); } return; }
  const p = mapPadding(), cur = m.getPadding();
  if (['top', 'bottom', 'left', 'right'].every(k => Math.abs((cur[k] || 0) - p[k]) < 1)) return;
  const W = m.getContainer().clientWidth, H = m.getContainer().clientHeight;
  const c = m.unproject([(W + p.left - p.right) / 2, (H + p.top - p.bottom) / 2]);
  m.jumpTo({ padding: p, center: c });
}
function spring(to, v0 = 0) {
  cancelAnimationFrame(anim);
  const k = 400, c = 38, m = 1; let x = curY ?? 0, v = -v0 * 1000; // px/s, upward positive visible
  let last = performance.now();
  const step = now => {
    const dt = Math.min(0.032, (now - last) / 1000); last = now;
    const a = (-k * (x - to) - c * v) / m; v += a * dt; x += v * dt;
    if (Math.abs(x - to) < 0.5 && Math.abs(v) < 5) { setVisible(to, true); document.body.classList.remove('dragging-sheet'); return; }
    setVisible(x, false); anim = requestAnimationFrame(step);
  };
  document.body.classList.add('dragging-sheet');
  anim = requestAnimationFrame(step);
}
function goState(state, v0 = 0, instant = false) {
  const s = sheet(); s.dataset.state = state; syncPadding();
  document.body.classList.toggle('sheet-up', state === 'half' || state === 'full');
  const target = detentPx(state);
  if (desktop()) { setVisible(target, true); return; }
  if (instant || curY == null || matchMedia('(prefers-reduced-motion: reduce)').matches) setVisible(target, true);
  else spring(target, v0);
}
export function openSheet(html, state = 'half', onClose, peekH = 150) {
  const body = $('#sheetBody');
  if (sheetCloseCb && sheetCloseCb !== onClose) { const cb = sheetCloseCb; sheetCloseCb = null; cb(); }
  body.innerHTML = html; body.scrollTop = 0;
  sheetCloseCb = onClose || null;
  App.sheetKind = null; App.peekH = peekH; App.onSheetDismiss = null;
  goState(state);
  return body;
}
export function setSheet(state) { goState(state); }
export function syncFabs() { goState(sheet().dataset.state, 0, true); }
export function sheetState() { return sheet().dataset.state; }
export function closeSheet() {
  goState('hidden');
  if (sheetCloseCb) { const cb = sheetCloseCb; sheetCloseCb = null; cb(); }
  if (App.onSheetClosed) setTimeout(App.onSheetClosed, 0);
}
export function initSheetDrag() {
  const s = sheet(), body = $('#sheetBody');
  s.style.transform = 'translateY(100%)'; curY = null; // first sheet appears without a spring: no per-frame map repaints during startup
  let y0 = null, v0 = 0, samples = [], mode = null, startState;
  const order = ['peek', 'half', 'full'];
  const down = e => {
    if (desktop() || e.button > 0) return;
    const st = s.dataset.state; if (st === 'hidden') return;
    const inBody = body.contains(e.target);
    if (inBody && st === 'full' && body.scrollTop > 0) return; // let it scroll
    if (e.target.closest('input,textarea,select,.photos,.favs,.actions,.chips')) { if (st !== 'full') { /* horizontal scrollers */ } else return; }
    y0 = e.clientY; v0 = curY; samples = [[performance.now(), e.clientY]]; mode = null; startState = st;
    cancelAnimationFrame(anim);
  };
  const move = e => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
    if (!mode) {
      if (Math.abs(dy) < 6) return;
      if (startState === 'full' && dy < 0 && body.contains(e.target)) { y0 = null; return; } // scroll up content
      mode = 'drag'; document.body.classList.add('dragging-sheet');
      try { s.setPointerCapture(e.pointerId); } catch {}
    }
    const H = s.offsetHeight; let v = v0 - dy;
    const min = detentPx('peek'), max = H;
    if (v > max) v = max + (v - max) * 0.55; if (v < min) v = min - (min - v) * 0.55;
    setVisible(Math.max(0, v), false);
    samples.push([performance.now(), e.clientY]); const now = performance.now(); samples = samples.filter(x => now - x[0] < 80);
    e.preventDefault();
  };
  const up = e => {
    if (y0 == null) return; y0 = null;
    if (mode !== 'drag') return;
    mode = null;
    const sm = samples, vel = sm.length > 1 ? -(sm[sm.length - 1][1] - sm[0][1]) / Math.max(1, sm[sm.length - 1][0] - sm[0][0]) : 0; // px/ms, + = up
    let i = order.indexOf(startState);
    let target;
    if (Math.abs(vel) > 1.6) target = vel > 0 ? 'full' : (startState === 'full' ? 'peek' : 'dismiss');
    else if (Math.abs(vel) > 0.5) { i += vel > 0 ? 1 : -1; target = i < 0 ? 'dismiss' : order[Math.min(2, i)]; }
    else {
      const proj = curY + vel * 120;
      target = order.reduce((b, st) => Math.abs(detentPx(st) - proj) < Math.abs(detentPx(b) - proj) ? st : b, 'peek');
      if (proj < detentPx('peek') * 0.5) target = 'dismiss';
    }
    if (target === 'dismiss') { if (App.onSheetDismiss) { App.onSheetDismiss(); return; } closeSheet(); return; }
    s.dataset.state = target; syncPadding(); spring(detentPx(target), vel);
  };
  s.addEventListener('pointerdown', down);
  addEventListener('pointermove', move, { passive: false });
  addEventListener('pointerup', up); addEventListener('pointercancel', up);
  s.querySelector('.grab').addEventListener('click', () => { const i = order.indexOf(s.dataset.state); if (i >= 0) goState(order[(i + 1) % 3]); });
  s.querySelector('.grab').addEventListener('keydown', e => { const i = order.indexOf(s.dataset.state); if (e.key === 'ArrowUp' && i < 2) goState(order[i + 1]); if (e.key === 'ArrowDown' && i > 0) goState(order[i - 1]); });
  addEventListener('resize', () => goState(s.dataset.state, 0, true));
}

// ---------- names & categories ----------
export function pickName(tags = {}) { return pickNameFor(tags, getLang()); }

const CAT = {
  restaurant: ['Restaurant', 'مطعم', 'Restaurant'], fast_food: ['Fast food', 'وجبات سريعة', 'Schnellimbiss'], cafe: ['Café', 'مقهى', 'Café'],
  fuel: ['Petrol station', 'محطة وقود', 'Tankstelle'], pharmacy: ['Pharmacy', 'صيدلية', 'Apotheke'], hospital: ['Hospital', 'مستشفى', 'Krankenhaus'],
  clinic: ['Clinic', 'عيادة', 'Klinik'], doctors: ['Doctor', 'طبيب', 'Arztpraxis'], dentist: ['Dentist', 'طبيب أسنان', 'Zahnarzt'], atm: ['ATM', 'صراف آلي', 'Geldautomat'],
  bank: ['Bank', 'بنك', 'Bank'], bureau_de_change: ['Currency exchange', 'صرافة', 'Wechselstube'], place_of_worship: ['Place of worship', 'دار عبادة', 'Gotteshaus'],
  mosque: ['Mosque', 'مسجد', 'Moschee'], church: ['Church', 'كنيسة', 'Kirche'], hotel: ['Hotel', 'فندق', 'Hotel'], hostel: ['Hostel', 'نُزُل', 'Hostel'],
  guest_house: ['Guest house', 'دار ضيافة', 'Pension'], supermarket: ['Supermarket', 'سوبرماركت', 'Supermarkt'], convenience: ['Grocery', 'بقالة', 'Lebensmittelladen'],
  bakery: ['Bakery', 'فرن / مخبز', 'Bäckerei'], pastry: ['Sweets & pastry', 'حلويات', 'Konditorei'], parking: ['Parking', 'موقف سيارات', 'Parkplatz'], school: ['School', 'مدرسة', 'Schule'],
  university: ['University', 'جامعة', 'Universität'], police: ['Police', 'شرطة', 'Polizei'], toilets: ['Toilets', 'دورات مياه', 'Toiletten'], museum: ['Museum', 'متحف', 'Museum'],
  attraction: ['Attraction', 'معلم سياحي', 'Sehenswürdigkeit'], viewpoint: ['Viewpoint', 'مطل', 'Aussichtspunkt'], castle: ['Castle', 'قلعة', 'Burg'], ruins: ['Ruins', 'آثار', 'Ruinen'],
  monument: ['Monument', 'نصب تذكاري', 'Denkmal'], archaeological_site: ['Archaeological site', 'موقع أثري', 'Ausgrabungsstätte'], park: ['Park', 'حديقة', 'Park'],
  marketplace: ['Market', 'سوق', 'Markt'], mall: ['Shopping centre', 'مركز تسوق', 'Einkaufszentrum'], clothes: ['Clothing store', 'ملابس', 'Bekleidung'], mobile_phone: ['Phone shop', 'محل هواتف', 'Handyladen'],
  bus_station: ['Bus station', 'محطة حافلات', 'Busbahnhof'], bus_stop: ['Bus stop', 'موقف حافلات', 'Bushaltestelle'], station: ['Station', 'محطة', 'Bahnhof'], aerodrome: ['Airport', 'مطار', 'Flughafen'],
  city: ['City', 'مدينة', 'Stadt'], town: ['Town', 'بلدة', 'Kleinstadt'], village: ['Village', 'قرية', 'Dorf'], suburb: ['District', 'حي', 'Stadtteil'], neighbourhood: ['Neighbourhood', 'حي', 'Viertel'], quarter: ['Quarter', 'حي', 'Viertel'],
  residential: ['Street', 'شارع', 'Straße'], primary: ['Main road', 'طريق رئيسي', 'Hauptstraße'], secondary: ['Road', 'طريق', 'Straße'], tertiary: ['Road', 'طريق', 'Straße'], motorway: ['Motorway', 'طريق سريع', 'Autobahn'], trunk: ['Highway', 'طريق سريع', 'Schnellstraße'],
  house: ['Building', 'مبنى', 'Gebäude'], yes: ['Building', 'مبنى', 'Gebäude'], ice_cream: ['Ice cream', 'بوظة', 'Eisdiele'], butcher: ['Butcher', 'لحّام', 'Metzger'], greengrocer: ['Greengrocer', 'خضار وفواكه', 'Gemüseladen'],
  car_repair: ['Car repair', 'تصليح سيارات', 'Autowerkstatt'], post_office: ['Post office', 'مكتب بريد', 'Postamt'], townhall: ['Town hall', 'دار البلدية', 'Rathaus'], embassy: ['Embassy', 'سفارة', 'Botschaft'],
  library: ['Library', 'مكتبة', 'Bibliothek'], cinema: ['Cinema', 'سينما', 'Kino'], theatre: ['Theatre', 'مسرح', 'Theater'], hairdresser: ['Hairdresser', 'حلاق', 'Friseur'], books: ['Bookshop', 'مكتبة', 'Buchhandlung'],
};
export function catLabel(tags = {}) {
  const k = tags.religion === 'muslim' && tags.amenity === 'place_of_worship' ? 'mosque' : tags.religion === 'christian' && tags.amenity === 'place_of_worship' ? 'church' : null;
  const v = k || tags.amenity || tags.shop || tags.tourism || tags.historic || tags.leisure || tags.office || tags.craft || tags.healthcare || tags.place || tags.railway || tags.aeroway || tags.highway || tags.building || tags.natural || tags.landuse || '';
  const i = getLang() === 'ar' ? 1 : getLang() === 'de' ? 2 : 0;
  if (CAT[v]) return CAT[v][i];
  return v ? (v.charAt(0).toUpperCase() + v.slice(1)).replace(/_/g, ' ') : '';
}
export const POI = { food: '#E8710A', shopping: '#B4529A', lodging: '#7B61D9', health: '#E5484D', nature: '#2E9E5B', culture: '#A8741A', worship: '#138A82', transport: '#4C6A9E', civic: '#6E7781', pin: '#E5484D' };
export function catIcon(tags = {}) {
  const a = tags.amenity, s = tags.shop, tr = tags.tourism;
  if (a === 'restaurant' || a === 'fast_food' || a === 'food_court') return ['restaurant', POI.food];
  if (a === 'cafe' || s === 'coffee' || a === 'ice_cream') return ['cafe', POI.food];
  if (a === 'fuel') return ['fuel', POI.transport];
  if (a === 'pharmacy' || s === 'chemist') return ['pharmacy', POI.health];
  if (a === 'hospital' || a === 'clinic' || a === 'doctors' || a === 'dentist') return ['hospital', POI.health];
  if (a === 'atm' || a === 'bureau_de_change') return ['atm', POI.civic];
  if (a === 'bank') return ['bank', POI.civic];
  if (a === 'place_of_worship') return [tags.religion === 'christian' ? 'church' : 'mosque', POI.worship];
  if (tr === 'hotel' || tr === 'hostel' || tr === 'guest_house' || tr === 'motel') return ['hotel', POI.lodging];
  if (s === 'bakery' || s === 'pastry' || s === 'confectionery') return ['bakery', POI.food];
  if (s === 'supermarket' || s === 'convenience' || s === 'greengrocer' || s === 'grocery' || s === 'butcher') return ['supermarket', POI.shopping];
  if (a === 'parking') return ['parking', POI.transport];
  if (a === 'school' || a === 'university' || a === 'college') return ['school', POI.civic];
  if (a === 'police') return ['police', POI.civic];
  if (a === 'toilets') return ['toilets', POI.civic];
  if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.leisure === 'playground') return ['outdoor', POI.nature];
  if (tr || tags.historic) return ['tourism', POI.culture];
  if (s) return ['shop', POI.shopping];
  return ['pin', POI.pin];
}

export function markerEl(icon, color, label, big) {
  const w = document.createElement('div'); w.style.position = 'relative';
  w.innerHTML = `<div class="mk" style="background:${color}">${ic(icon)}</div>${label ? `<div class="mklabel" style="color:${color}">${esc(label)}</div>` : ''}`;
  return w;
}
export function pinEl(color = '#E5484D', icon = null) {
  const d = document.createElement('div');
  const glyph = icon ? `<g transform="translate(10 9)" fill="#fff"><path d="${P[icon] || P.pin}"/></g>` : `<circle cx="22" cy="21" r="7" fill="#fff"/>`;
  d.innerHTML = `<svg class="selpin" viewBox="0 0 44 56"><path d="M22 2.5C11.5 2.5 3.2 10.7 3.2 21c0 13.6 15.4 29.3 17.6 31.5a1.7 1.7 0 0 0 2.4 0C25.4 50.3 40.8 34.6 40.8 21 40.8 10.7 32.5 2.5 22 2.5z" fill="${color}" stroke="#fff" stroke-width="2.5"/>${glyph}</svg>`;
  return d.firstChild;
}
export function clearMarkers() { App.markers.forEach(m => m.remove()); App.markers = []; }
const poiFilters = {};
export function applySelFilter(name) {
  const map = App.map;
  // hide the matching map icon while the DOM pin is shown (§3.5)
  for (const id of ['poi', 'poi-z15', 'poi-dot']) {
    if (!map.getLayer(id)) continue;
    if (!(id in poiFilters)) poiFilters[id] = map.getFilter(id) || null;
    const base = poiFilters[id];
    const f = name ? (base ? ['all', base, ['!=', ['get', 'name'], name]] : ['!=', ['get', 'name'], name]) : base;
    try { map.setFilter(id, f); } catch {}
  }
}
export function setSelMarker(lnglat, color, icon, name) {
  App.selMarker?.remove();
  App.selName = lnglat ? name : null;
  applySelFilter(App.selName);
  try { setPoiSelected(App.map, lnglat ? (App.selPoi ?? null) : null); } catch {}
  if (!lnglat) { App.selMarker = null; return; }
  App.selMarker = new maplibregl.Marker({ element: pinEl(color, icon), anchor: 'bottom' }).setLngLat(lnglat).addTo(App.map);
}
export function resetPoiFilters() { for (const k in poiFilters) delete poiFilters[k]; }
export function center() { const c = App.map.getCenter(); return [c.lng, c.lat]; }
export function refPoint() { return App.me || center(); }
