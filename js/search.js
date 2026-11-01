// Search: Photon autocomplete (komoot, key-free) + Nominatim full search (1 req/s) + coordinates / plus codes,
// recent searches & saved places, category search via Overpass.
import { $, esc, fetchJSON, nominatim, overpass, debounce, parseCoords, plusDecode, haversine, fmtDist, lsGet, lsSet, toast } from './util.js';
import { t, getLang } from './i18n.js';
import { ic } from './icons.js';
import { App, center, refPoint, catIcon, catLabel, pickName, openSheet, clearMarkers, markerEl, closeSheet, POI, mapPadding, fitTo } from './core.js';
import { ohStatus } from './hours.js';
import { openPlace } from './place.js';
import { track } from './analytics.js';

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
  $('#chips').innerHTML = CATS.map(([k, icn, col]) => `<button class="chip" data-cat="${k}" style="--chip-ic:${col}">${ic(icn)}<span>${esc(t(k))}</span></button>`).join('');
}
// ---------- normalisation ----------
function fromPhoton(f) {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  const tags = { name: p.name, [p.osm_key]: p.osm_value };
  const sub = [p.street && (p.street + (p.housenumber ? ' ' + p.housenumber : '')), p.district, p.city || p.town || p.village, p.state, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i && v !== p.name).join(', ');
  return { id: (p.osm_type || 'N') + p.osm_id, osm_type: { N: 'node', W: 'way', R: 'relation' }[p.osm_type] || 'node', osm_id: p.osm_id, name: p.name || sub, sub, lon, lat, tags, extent: p.extent };
}
function fromNominatim(r) {
  const tags = Object.assign({}, r.extratags || {}, r.namedetails || {}, { [r.category || r.class]: r.type });
  const name = r.name || (r.display_name || '').split(',')[0];
  const sub = (r.display_name || '').split(',').slice(1, 4).join(',').trim();
  const bb = r.boundingbox ? [+r.boundingbox[2], +r.boundingbox[0], +r.boundingbox[3], +r.boundingbox[1]] : null;
  return { id: (r.osm_type || 'n')[0].toUpperCase() + r.osm_id, osm_type: r.osm_type, osm_id: r.osm_id, name: pickName(tags).primary || name, sub, lon: +r.lon, lat: +r.lat, tags, extent: bb };
}

// ---------- recents ----------
export function addRecent(item) {
  const list = lsGet('kh.recent', []).filter(r => r.id !== item.id);
  list.unshift({ id: item.id, osm_type: item.osm_type, osm_id: item.osm_id, name: item.name, sub: item.sub, lon: item.lon, lat: item.lat, tags: item.tags ? { amenity: item.tags.amenity, shop: item.tags.shop, tourism: item.tags.tourism, place: item.tags.place } : {} });
  lsSet('kh.recent', list.slice(0, 15));
}

function row(item, i, extra = '') {
  const [icn, col] = item.icon || catIcon(item.tags || {});
  const d = item.lon != null ? fmtDist(haversine(refPoint(), [item.lon, item.lat])) : '';
  return `<div class="srow" data-i="${i}"><div class="sic badge" style="background:${col}">${ic(icn)}</div><div class="st"><div class="t1" dir="auto">${esc(item.name)}</div><div class="t2">${esc(item.sub || catLabel(item.tags || {}))}${extra}</div></div><div class="dist">${d}</div></div>`;
}

// ---------- suggest UI ----------
let items = [], seq = 0, sel = -1;
let photonCtl;
export function initSearch() {
  const q = $('#q'), box = $('#suggest');
  q.placeholder = navigator.onLine ? t('search') : t('searchOffline');
  const show = () => box.classList.toggle('hidden', !box.innerHTML);
  const renderIdle = () => {
    const saved = lsGet('kh.saved', []), recent = lsGet('kh.recent', []);
    items = [...saved.map(s => ({ ...s, icon: s.kind === 'home' ? ['home', '#1A73E8'] : s.kind === 'work' ? ['work', '#6E7781'] : ['bookmark', '#E8710A'] })), ...recent.map(r => ({ ...r, icon: ['history', '#8E8E93'] }))];
    let h = '';
    if (saved.length) h += `<div class="shead">${t('saved')}</div>` + saved.map((s, i) => row(items[i], i)).join('');
    if (recent.length) h += `<div class="shead">${t('recent')}</div>` + recent.map((r, j) => row(items[saved.length + j], saved.length + j)).join('');
    box.innerHTML = h; show();
  };
  const runPhoton = debounce(async (text) => {
    const my = ++seq;
    const c = center(), z = App.map.getZoom();
    const lang = getLang() === 'de' ? 'de' : getLang() === 'en' ? 'en' : 'default';
    photonCtl?.abort(); photonCtl = new AbortController();
    let res = []; $('#searchProg').classList.remove('hidden');
    const local = localMatches(text);
    try {
      const j = await fetchJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=8&lang=${lang}&lat=${c[1].toFixed(4)}&lon=${c[0].toFixed(4)}&zoom=${Math.round(Math.max(6, z))}&location_bias_scale=0.4`, { signal: photonCtl.signal }, 8000);
      res = j.features.map(fromPhoton);
    } catch (e) { if (e.name === 'AbortError') return; if (!navigator.onLine) { box.innerHTML = `<div class="shead">${t('offlineSearch')}</div>`; } }
    if (my !== seq) return;
    $('#searchProg').classList.add('hidden');
    // settlements whose name matches the query beat regions/bus lines with the same word (Photon ranks "Latakia Governorate" first)
    const ql = text.toLowerCase();
    const isTown = r => ['city', 'town', 'village'].includes(r.tags?.place) && (r.name || '').toLowerCase().startsWith(ql);
    res = [...res.filter(isTown), ...res.filter(r => !isTown(r))];
    items = [...local, ...res.filter(r => !local.some(l => l.id === r.id))];
    const coord = parseCoords(text) || plusDecode(text);
    if (coord) items.unshift({ id: 'c', name: text, sub: t('coords'), lon: coord[0], lat: coord[1], icon: ['pin', '#E5484D'], coord: true });
    box.innerHTML = items.length ? items.map((it, i) => row(it, i)).join('') : `<div class="srow muted">${t('noResults')}</div>`;
    sel = -1; show();
  }, 250);
  q.addEventListener('focus', () => { if (!q.value) renderIdle(); });
  q.addEventListener('input', () => {
    $('#btnClear').classList.toggle('hidden', !q.value);
    if (!q.value.trim()) return renderIdle();
    if (q.value.trim().length < 2) return;
    runPhoton(q.value.trim());
  });
  q.addEventListener('keydown', e => {
    const rows = [...box.querySelectorAll('.srow[data-i]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(-1, Math.min(rows.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); rows.forEach((r, i) => r.classList.toggle('sel', i === sel)); }
    if (e.key === 'Enter') { e.preventDefault(); if (sel >= 0 && items[sel]) choose(items[sel]); else fullSearch(q.value.trim()); }
    if (e.key === 'Escape') { box.innerHTML = ''; show(); q.blur(); }
  });
  box.addEventListener('pointerdown', e => e.preventDefault());
  box.addEventListener('click', e => { const r = e.target.closest('.srow[data-i]'); if (r) choose(items[+r.dataset.i]); });
  q.addEventListener('blur', () => setTimeout(() => { box.innerHTML = ''; show(); }, 150));
  $('#btnClear').addEventListener('click', () => { q.value = ''; $('#btnClear').classList.add('hidden'); clearMarkers(); closeSheet(); q.focus(); renderIdle(); });
}

function localMatches(text) {
  const s = text.toLowerCase();
  return [...lsGet('kh.saved', []).map(x => ({ ...x, icon: ['star', '#f9ab00'] })), ...lsGet('kh.recent', []).map(x => ({ ...x, icon: ['history', '#8E8E93'] }))]
    .filter(x => (x.name || '').toLowerCase().includes(s)).slice(0, 3);
}

export function choose(item) {
  cancelCategory();
  $('#suggest').innerHTML = ''; $('#suggest').classList.add('hidden');
  const q = $('#q'); q.value = item.name; q.blur(); $('#btnClear').classList.remove('hidden');
  track('search', { kind: item.coord ? 'coord' : 'place', cat: catLabelKey(item.tags) });
  if (!item.coord) addRecent(item);
  clearMarkers();
  openPlace(item);
}
function catLabelKey(tags = {}) { return tags.amenity || tags.shop || tags.tourism || tags.place || tags.highway || null; }

export async function fullSearch(text) {
  if (!text) return;
  const coord = parseCoords(text) || plusDecode(text);
  if (coord) return choose({ id: 'c', name: text, lon: coord[0], lat: coord[1], coord: true });
  const box = $('#suggest'); box.innerHTML = `<div class="srow muted">${t('searching')}</div>`; box.classList.remove('hidden');
  const b = App.map.getBounds();
  const vb = [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map(v => v.toFixed(4)).join(',');
  let res = [];
  try {
    const j = await nominatim(`search?q=${encodeURIComponent(text)}&format=jsonv2&limit=12&addressdetails=0&extratags=1&namedetails=1&accept-language=${getLang()},ar,en&viewbox=${vb}`);
    res = j.map(fromNominatim);
  } catch {
    try { const j = await fetchJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=12`); res = j.features.map(fromPhoton); } catch { toast(t('serviceDown')); }
  }
  box.innerHTML = ''; box.classList.add('hidden');
  track('search', { kind: 'full', n: res.length });
  if (!res.length) { toast(t('noResults')); return; }
  if (res.length === 1) return choose(res[0]);
  showResultList(res, t('results') + ': ' + text);
}

export function showResultList(res, title, fit = true) {
  clearMarkers();
  res.forEach((r, i) => {
    const [icn, col] = catIcon(r.tags || {});
    const m = new maplibregl.Marker({ element: markerEl(icn, col, App.map.getZoom() > 14 && res.length < 40 ? r.name : '') }).setLngLat([r.lon, r.lat]).addTo(App.map);
    m.getElement().addEventListener('click', e => { e.stopPropagation(); addRecent(r); openPlace(r); });
    App.markers.push(m);
  });
  const body = openSheet(`<div class="sec"><h2 class="ptitle" style="font-size:18px">${esc(title)}</h2><p class="psub">${res.length} · OpenStreetMap</p></div><div class="list">${res.map((r, i) => row(r, i, r.status ? ` · <span class="${r.status.cls}">${esc(r.status.text.split(' · ')[0])}</span>` : '')).join('')}</div>`, 'half', () => clearMarkers());
  body.querySelector('.list').addEventListener('click', e => { const el = e.target.closest('.srow'); if (el) { const r = res[+el.dataset.i]; addRecent(r); openPlace(r); } });
  if (fit && res.length > 1) {
    const b = new maplibregl.LngLatBounds(); res.forEach(r => b.extend([r.lon, r.lat]));
    { const mp = mapPadding(); fitTo(b, { top: mp.top + 20, bottom: Math.max(mp.bottom, innerWidth < 900 ? innerHeight * 0.5 : 0) + 20, left: mp.left + 30, right: mp.right + 30 }, { maxZoom: 16, duration: 600 }); }
  }
}

// ---------- categories (Overpass) ----------
let catSeq = 0;
export function cancelCategory() { catSeq++; document.querySelectorAll('.chip.on').forEach(c => c.classList.remove('on')); }
export async function searchCategory(key) {
  const mySeq = ++catSeq;
  const cat = CATS.find(c => c[0] === key); if (!cat) return;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.cat === key));
  track('category', { cat: key });
  const map = App.map, c = center();
  let b = map.getBounds();
  let s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast();
  const maxd = 0.06; // ~6 km
  if (n - s > maxd * 2 || e - w > maxd * 2) { s = c[1] - maxd; n = c[1] + maxd; w = c[0] - maxd; e = c[0] + maxd; }
  const bbox = [s, w, n, e].map(v => v.toFixed(5)).join(',');
  const qs = cat[3].split(';').map(x => `${x}(${bbox});`).join('');
  const q = `[out:json][timeout:20];(${qs});out center tags 150;`;
  openSheet(`<div class="sec"><h2 class="ptitle" style="font-size:18px">${t(key)}</h2><div class="skel" style="width:60%"></div><div class="skel"></div><div class="skel" style="width:80%"></div></div>`, 'peek');
  try {
    let j;
    try { j = await overpass(q, 9000, 2500); }
    catch (opErr) { // fallback: Nominatim special phrase search in the view box
      const word = { restaurants: 'restaurant', cafes: 'cafe', fuel: 'fuel', pharmacy: 'pharmacy', hospital: 'hospital', atm: 'atm', mosque: 'mosque', church: 'church', hotel: 'hotel', supermarket: 'supermarket', bakery: 'bakery', tourism: 'attraction', parking: 'parking', police: 'police', toilets: 'toilets' }[key];
      const r = await nominatim(`search?q=${encodeURIComponent('[' + word + ']')}&format=jsonv2&limit=40&bounded=1&viewbox=${w},${n},${e},${s}&extratags=1&namedetails=1&accept-language=${getLang()}`);
      j = { elements: r.map(x => ({ type: x.osm_type, id: x.osm_id, lat: +x.lat, lon: +x.lon, tags: Object.assign({}, x.extratags, x.namedetails, { [x.category]: x.type }) })) };
    }
    if (mySeq !== catSeq || !document.querySelector('.chip.on')) return;
    const ref = refPoint();
    let res = j.elements.map(el => {
      const lon = el.lon ?? el.center?.lon, lat = el.lat ?? el.center?.lat;
      const tags = el.tags || {};
      const nm = pickName(tags).primary || catLabel(tags);
      const addr = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
      return { id: el.type[0].toUpperCase() + el.id, osm_type: el.type, osm_id: el.id, name: nm, sub: [catLabel(tags), addr].filter(Boolean).join(' · '), lon, lat, tags, full: true, status: ohStatus(tags.opening_hours), d: haversine(ref, [lon, lat]) };
    }).filter(r => r.lon != null);
    res.sort((a, b) => (b.tags.name ? 1 : 0) - (a.tags.name ? 1 : 0) || a.d - b.d);
    res = res.slice(0, 100).sort((a, b) => a.d - b.d);
    if (!res.length) { openSheet(`<div class="sec"><h2 class="ptitle" style="font-size:18px">${t(key)}</h2><p class="psub">${t('noResults')}</p></div>`, 'peek'); return; }
    showResultList(res, t(key), false);
  } catch (err) {
    if (mySeq !== catSeq) return;
    openSheet(`<div class="sec"><h2 class="ptitle" style="font-size:18px">${t(key)}</h2><p class="psub">${t('serviceDown')}</p><div class="actions"><button class="act" id="retryCat">${t('tryAgain')}</button></div></div>`, 'peek');
    $('#retryCat').onclick = () => searchCategory(key);
  }
}
