// Khareeta – main entry
import { $, esc, settings, saveSettings, lsGet, lsSet, toast, debounce, fmtDist, nf, overpass, haversine, VERSION } from './util.js';
import { t, applyDir, getLang } from './i18n.js';
import { ic } from './icons.js';
import { App, initSheetDrag, closeSheet, sheetState, syncFabs, pickName, center, openSheet, catIcon, resetPoiFilters, applySelFilter } from './core.js';
import { buildStyle, prefetchStyles, relabel, getTheme, isDark } from './mapstyle.js';
import { initRTL } from './map-i18n.js';
import { initSearch, renderChips, toggleChip, fullSearch, filterActive, showFilterSheet } from './search.js';
import { loadPois, addPoiLayers, setPoiVisible, LAYERS as POI_LAYERS, P as POIS, toItem } from './poi.js';
import { mapIsDark } from './mapstyle.js';
import { openPlace, openPoint, weatherRaw, wmo, currentPlace } from './place.js';
import { showSaved } from './ui.js';
import { ensureRouteLayers, initRouteMapEvents, routeFromUrl, navActive, openDirections, routeState } from './route.js';
import { initDrawer, openDrawer, toggleLayers, hooks, measureActive, measureClick, startMeasure } from './ui.js';
import { initAnalytics, track } from './analytics.js';

applyDir();
const syncDarkClass = () => document.documentElement.classList.toggle('dark', isDark());
syncDarkClass();
window.KH = { App, VERSION, setSheet: s => import('./core.js').then(m => m.setSheet(s)) };

// ---------- static UI ----------
function renderUI() {
  $('#btnMenu').innerHTML = ic('settings'); $('#btnClear').innerHTML = ic('close');
  $('#btnLayers').innerHTML = ic('layers'); $('#btn3d').innerHTML = ic('cube');
  $('#btnCompass').innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2l4 10h-8z" fill="#E5484D"/><path d="M12 22l-4-10h8z" fill="currentColor" opacity=".55"/></svg>`;
  renderLocBtn();
  $('#q').placeholder = navigator.onLine ? t('search') : t('searchOffline');
  ['btnMenu:settings', 'btnLayers:layers', 'btn3d:threeD', 'btnLocate:myLoc', 'btnCompass:north'].forEach(s => { const [id, k] = s.split(':'); $('#' + id).setAttribute('aria-label', t(k)); $('#' + id).title = t(k); });
  renderChips();
  document.title = getLang() === 'ar' ? 'خريطة · Khareeta' : 'Khareeta · خريطة';
}

// ---------- locate button: off → follow → follow + heading (§4.7) ----------
App.locMode = 0;
function renderLocBtn() {
  const b = $('#btnLocate'); if (!b) return;
  b.innerHTML = ic(App.locDenied ? 'locateOff' : App.locMode === 2 ? 'compass' : 'locate');
  b.classList.toggle('on', App.locMode > 0);
}
renderUI();

// ---------- map ----------
const DEFAULT = { center: [36.2919, 33.5132], zoom: 12.5 }; // Damascus
const view = lsGet('kh.view', null);
initRTL('vendor/rtl-text/mapbox-gl-rtl-text.js'); // eager: Syrian labels are Arabic in every UI language

async function initialStyle() {
  try { return await buildStyle(settings.style); }
  catch (e) {
    console.warn('style failed, raster fallback', e);
    return { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] };
  }
}

const map = App.map = new maplibregl.Map({
  container: 'map', style: await initialStyle(),
  center: view?.c || DEFAULT.center, zoom: view?.z ?? DEFAULT.zoom, bearing: 0, pitch: 0,
  hash: 'map', attributionControl: false, maxPitch: 75,
  pixelRatio: settings.lowData ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 3),
  fadeDuration: 200, dragRotate: true, touchPitch: true, cooperativeGestures: false,
  maxTileCacheZoomLevels: 5, refreshExpiredTiles: false,
});
map.touchZoomRotate.enableRotation();
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
map.once('load', () => document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
const scale = new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' });
map.addControl(scale, 'bottom-left');
function poiLayers() { if (!POIS.geo || map.getSource('kh-poi')) return; addPoiLayers(map, mapIsDark()); relabel(map); if (navActive()) setPoiVisible(map, false); }
loadPois().then(function tryAdd() { if (map.getSource('kh-poi')) return; if (map.isStyleLoaded()) poiLayers(); else setTimeout(tryAdd, 250); }).catch(e => console.warn('poi data', e));
map.on('style.load', () => {
  if (POIS.geo) addPoiLayers(map, mapIsDark());
  if (navActive()) setPoiVisible(map, false);
  relabel(map); ensureRouteLayers(); resetPoiFilters();
  if (App.selName) applySelFilter(App.selName);
  if (navActive()) for (const id of ['label-housenumber']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
});
map.on('styleimagemissing', e => { if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) }); });
map.on('moveend', debounce(() => { const c = map.getCenter(); lsSet('kh.view', { c: [c.lng, c.lat], z: map.getZoom() }); }, 500));
function syncCompass() {
  const b = map.getBearing(), p = map.getPitch();
  $('#btnCompass svg').style.transform = `rotate(${-b}deg)`;
  $('#btnCompass').classList.toggle('hide', Math.abs(b) <= 2 && p <= 0.5);
  $('#btn3d').classList.toggle('on', p > 10);
}
map.on('rotate', syncCompass); map.on('pitch', syncCompass); map.once('load', syncCompass);
// scale bar only for 2 s after a zoom (§4.7)
let scT; map.on('zoom', () => { document.body.classList.add('show-scale'); clearTimeout(scT); scT = setTimeout(() => document.body.classList.remove('show-scale'), 2000); });
map.on('error', e => { if (e?.error?.status === 404) return; console.warn('map error', e?.error?.message || e); });

hooks.restyle = async () => {
  syncDarkClass();
  try {
    const st = await buildStyle(settings.style);
    const el = $('#map'); el.style.transition = 'none'; el.style.opacity = '0.4';
    map.setStyle(st, { diff: false });
    map.once('idle', () => { el.style.transition = 'opacity .24s'; el.style.opacity = '1'; });
    setTimeout(() => { el.style.transition = 'opacity .24s'; el.style.opacity = '1'; }, 1500);
  } catch { toast(t('serviceDown')); }
};
hooks.relabel = () => relabel(map);
hooks.set3d = on => {
  if (map.getLayer('building-3d')) map.setLayoutProperty('building-3d', 'visibility', on ? 'visible' : 'none');
  map.easeTo({ pitch: on ? 55 : 0, duration: 600 });
};
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (getTheme() === 'system') hooks.restyle(); });
hooks.rerenderUI = () => { renderUI(); const p = currentPlace(); if (p && sheetState() !== 'hidden') openPlace(p, { noFly: true }); else if (App.sheetKind === 'home') showHome(true); };

// ---------- POI clicks on base map ----------
const ptype = { 1: 'node', 2: 'way', 3: 'relation' };
map.on('click', async e => {
  if (navActive()) return;
  if (measureActive()) { measureClick([e.lngLat.lng, e.lngLat.lat]); return; }
  $('#layersPop').classList.add('hidden');
  const kp = map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], { layers: POI_LAYERS.filter(id => map.getLayer(id)) });
  if (kp.length) {
    const rec = POIS.all[kp[0].properties.i];
    if (rec) { const it = toItem(rec); it.name = pickName(it.tags).primary || ''; openPlace(it, { noFly: true }); return; }
  }
  const feats = map.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]]).filter(f => f.layer.type === 'symbol' && ['poi', 'place', 'aerodrome_label', 'mountain_peak', 'water_name', 'park'].includes(f.sourceLayer) && f.properties.name);
  if (feats.length) {
    const f = feats[0], p = f.properties, ll = f.geometry.type === 'Point' ? f.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
    const tags = { name: p.name, 'name:ar': p['name:ar'], 'name:en': p['name:en'] || p.name_en, 'name:de': p['name:de'] || p.name_de };
    if (f.sourceLayer === 'poi') { tags[p.class === 'shop' ? 'shop' : 'amenity'] = p.subclass || p.class; }
    else if (f.sourceLayer === 'place') tags.place = p.class;
    let osm = null;
    if (f.id && f.sourceLayer === 'poi') { const id = Number(f.id); osm = { osm_type: ptype[id % 10], osm_id: Math.floor(id / 10) }; if (!osm.osm_type) osm = null; }
    const item = { id: osm ? osm.osm_type[0].toUpperCase() + osm.osm_id : 'f' + ll.join(), name: pickName(tags).primary, lon: ll[0], lat: ll[1], tags, ...(osm || {}) };
    if (!osm) {
      // resolve the OSM object by name near the click
      try {
        const nm = p.name.replace(/"/g, '\\"');
        const j = await overpass(`[out:json][timeout:10];nwr(around:${f.sourceLayer === 'place' ? 3000 : 80},${ll[1]},${ll[0]})["name"="${nm}"];out tags center 1;`, 10000);
        const el = j.elements[0]; if (el) Object.assign(item, { osm_type: el.type, osm_id: el.id, id: el.type[0].toUpperCase() + el.id, tags: el.tags, full: true });
      } catch {}
    }
    openPlace(item, { noFly: true }); return;
  }
  if (!$('#dirPanel').offsetParent && App.sheetKind !== 'home') { if (sheetState() !== 'hidden') closeSheet(); else showHome(); }
});
map.on('contextmenu', e => { if (!navActive()) openPoint([e.lngLat.lng, e.lngLat.lat]); });
map.on('mouseenter', 'route-alt', () => map.getCanvas().style.cursor = 'pointer');
for (const id of POI_LAYERS) { map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer'); map.on('mouseleave', id, () => map.getCanvas().style.cursor = ''); }
// long-press ("what's here") for touch devices
{
  let tm = null, sx = 0, sy = 0;
  const el = map.getCanvasContainer();
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { clearTimeout(tm); return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    clearTimeout(tm); tm = setTimeout(() => { if (navActive() || measureActive()) return; const r = el.getBoundingClientRect(); const ll = map.unproject([sx - r.left, sy - r.top]); navigator.vibrate?.(20); openPoint([ll.lng, ll.lat]); }, 550);
  }, { passive: true });
  el.addEventListener('touchmove', e => { if (Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 10) clearTimeout(tm); }, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(tm));
  el.addEventListener('touchcancel', () => clearTimeout(tm));
}

// ---------- my location (puck §3.7) ----------
function meEl() {
  const d = document.createElement('div'); d.className = 'me-wrap';
  d.innerHTML = '<div class="me-halo"></div><div class="me-cone hidden"></div><div class="me"></div>'; return d;
}
let watchId = null, firstFix = true, lastFix = 0, lastAcc = 0;
function onHeading(ev) {
  let h = ev.webkitCompassHeading ?? (ev.absolute && ev.alpha != null ? 360 - ev.alpha : null);
  if (h == null) return;
  if (ev.webkitCompassAccuracy != null && ev.webkitCompassAccuracy > 45) return;
  App.heading = h;
  const cone = App.meMarker?.getElement().querySelector('.me-cone');
  if (cone) { cone.classList.remove('hidden'); cone.style.transform = `rotate(${h - map.getBearing()}deg)`; }
  if (App.locMode === 2 && !navActive()) map.rotateTo(h, { duration: 300 });
}
function halo() {
  const el = App.meMarker?.getElement().querySelector('.me-halo'); if (!el || !App.me) return;
  const mpp = 156543.03392 * Math.cos(App.me[1] * Math.PI / 180) / Math.pow(2, map.getZoom()) / 2; // 512px tiles
  let d = 2 * lastAcc / mpp; if (d < 24) d = 0; d = Math.min(400, d);
  el.style.width = el.style.height = d + 'px';
}
map.on('zoom', halo);
setInterval(() => App.meMarker?.getElement().classList.toggle('stale', Date.now() - lastFix > 30000), 5000);
function startHeading() {
  try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().then(s => { if (s === 'granted') addEventListener('deviceorientation', onHeading); }).catch(() => {}); else addEventListener('deviceorientationabsolute', onHeading); } catch {}
}
function locate(fly = true) {
  if (!('geolocation' in navigator)) return toast(t('locErr'));
  startHeading();
  firstFix = fly;
  if (fly) App.locMode = Math.max(1, App.locMode);
  renderLocBtn();
  if (App.me && fly) map.flyTo({ center: App.me, zoom: Math.max(map.getZoom(), 16), duration: 800, padding: undefined });
  else if (fly) toast(t('locating'), 1500);
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(p => {
    App.me = [p.coords.longitude, p.coords.latitude]; lastFix = Date.now(); lastAcc = p.coords.accuracy || 0; App.locDenied = false;
    if (!App.meMarker) App.meMarker = new maplibregl.Marker({ element: meEl() }).setLngLat(App.me).addTo(map);
    else App.meMarker.setLngLat(App.me);
    App.meMarker.getElement().classList.remove('stale'); halo();
    if (firstFix) { firstFix = false; map.flyTo({ center: App.me, zoom: Math.max(map.getZoom(), 15.5), duration: 900 }); track('locate', { lat: p.coords.latitude, lon: p.coords.longitude }); }
    else if (App.locMode > 0 && !navActive() && !map.isMoving()) map.easeTo({ center: App.me, duration: 600 });
    renderLocBtn();
  }, err => { if (err.code === 1) { App.locDenied = true; App.locMode = 0; } toast(t('locErr')); watchId = null; renderLocBtn(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
map.on('rotate', () => { if (App.heading != null) { const cone = App.meMarker?.getElement().querySelector('.me-cone'); if (cone) cone.style.transform = `rotate(${App.heading - map.getBearing()}deg)`; } });
map.on('dragstart', () => { if (App.locMode) { App.locMode = 0; renderLocBtn(); } });

// ---------- home peek: Saved row (mockup 01) ----------
function showHome(keep) {
  if (navActive() || $('#dirPanel').offsetParent || measureActive()) return;
  const saved = lsGet('kh.saved', []);
  const home = saved.find(s => s.kind === 'home'), work = saved.find(s => s.kind === 'work');
  const favs = saved.filter(s => s.kind === 'fav').slice(0, 6);
  const dist = s => App.me && s ? fmtDist(haversine(App.me, [s.lon, s.lat])) : '';
  const fav = (k, icn, col, label, s) => `<button class="fav" data-k="${k}"><span class="b" style="background:${col}">${ic(icn)}</span><span dir="auto">${esc(label)}</span><small>${s ? (App.me ? dist(s) : t('saved')) : t('add')}</small></button>`;
  const html = `<div class="hhead"><h3>${t('saved')}</h3><button id="hAll">${t('seeAll')}</button></div>
  <div class="favs">
    ${fav('home', 'home', 'var(--k-accent)', t('home'), home)}
    ${fav('work', 'work', '#6E7781', t('work'), work)}
    ${favs.map((s, i) => { const [icn, col] = catIcon(s.tags || {}); return fav('f' + i, icn, col, s.name, s); }).join('')}
    <button class="fav" data-k="add"><span class="b add">${ic('plus')}</span><span>${t('add')}</span><small>&nbsp;</small></button>
  </div>`;
  const body = openSheet(html, keep && sheetState() !== 'hidden' ? sheetState() : 'peek', null, 196);
  App.sheetKind = 'home'; App.onSheetDismiss = () => setSheetPeek();
  body.querySelector('#hAll').onclick = () => showSaved();
  body.querySelector('.favs').onclick = e => {
    const b = e.target.closest('.fav'); if (!b) return;
    const k = b.dataset.k;
    const s = k === 'home' ? home : k === 'work' ? work : k.startsWith('f') ? favs[+k.slice(1)] : null;
    if (s) { openPlace({ ...s }); return; }
    toast(k === 'add' ? t('addHint') : t('setHint', { k: t(k) }), 3500); $('#q').focus();
  };
}
function setSheetPeek() { import('./core.js').then(m => m.setSheet('peek')); }
App.onSheetClosed = () => { if (sheetState() === 'hidden' && !App.navMode) setTimeout(() => { if (sheetState() === 'hidden') { if (filterActive()) showFilterSheet(false); else showHome(); } }, 50); };

// ---------- buttons ----------
$('#btnMenu').onclick = openDrawer;
$('#btnLayers').onclick = toggleLayers;
$('#btnZin').innerHTML = ic('plus'); $('#btnZout').innerHTML = ic('minus');
$('#btnZin').onclick = () => map.zoomIn(); $('#btnZout').onclick = () => map.zoomOut();
$('#btnCompass').onclick = () => { if (App.locMode === 2) App.locMode = 1; renderLocBtn(); map.easeTo({ bearing: 0, pitch: 0, duration: 400 }); if (settings.b3dOn) { settings.b3dOn = false; saveSettings(); hooks.set3d(false); } };
$('#btn3d').onclick = () => { settings.b3dOn = !(map.getPitch() > 10); saveSettings(); hooks.set3d(settings.b3dOn); };
$('#btnLocate').onclick = () => {
  if (App.locDenied) { openSheet(`<div class="phead"><div><h2 class="ptitle" style="font-size:20px">${t('locDeniedT')}</h2><p class="psub">${t('locDeniedB')}</p></div></div><div style="height:16px"></div>`, 'half'); return; }
  if (!App.me || App.locMode === 0) { locate(true); return; }
  if (App.locMode === 1) { App.locMode = 2; startHeading(); if (App.heading != null) map.rotateTo(App.heading, { duration: 400 }); else toast(t('noHeading'), 2500); }
  else { App.locMode = 1; map.easeTo({ bearing: 0, duration: 400 }); }
  renderLocBtn();
};
$('#chips').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; toggleChip(c.dataset.cat); };

// weather chip (map centre)
const updWx = debounce(async () => {
  const chip = $('#weatherChip');
  if (settings.lowData || map.getZoom() < 8 || navActive() || !navigator.onLine) { chip.classList.add('hidden'); return; }
  const c = center();
  try { const j = await weatherRaw(Math.round(c[1] * 10) / 10, Math.round(c[0] * 10) / 10); const [e] = wmo(j.current.weather_code, j.current.is_day); chip.innerHTML = `${e} ${nf(Math.round(j.current.temperature_2m))}°`; chip.classList.remove('hidden'); } catch { chip.classList.add('hidden'); }
}, 1500);
map.on('moveend', updWx);
$('#weatherChip').onclick = () => openPoint(center());

// ---------- network state ----------
function net() {
  const off = !navigator.onLine; const el = $('#netState');
  el.innerHTML = ic('offline', 'xs') + ' ' + t('offline'); el.classList.toggle('hidden', !off); document.body.classList.toggle('offline', off);
  if (off) $('#q').placeholder = t('searchOffline');
}
addEventListener('online', () => { net(); toast(t('online')); $('#q').placeholder = t('search'); });
addEventListener('offline', net); net();
addEventListener('resize', syncFabs);
addEventListener('beforeinstallprompt', e => { e.preventDefault(); App.installPrompt = e; });

initSheetDrag(); initSearch(); initDrawer(); initRouteMapEvents(); initAnalytics();
prefetchStyles();

// ---------- deep links ----------
map.once('load', () => {
  const sp = new URLSearchParams(location.search);
  if (sp.get('r')) {
    const stops = sp.get('r').split(';').map(s => s.split(',').map(Number)).filter(a => a.length === 2 && !a.some(isNaN)).map(([la, lo], i) => ({ name: `${la.toFixed(4)}, ${lo.toFixed(4)}`, lat: la, lon: lo }));
    if (stops.length >= 2) routeFromUrl(stops, sp.get('m') || 'car');
  } else if (sp.get('ll')) {
    const [la, lo] = sp.get('ll').split(',').map(Number);
    const p = sp.get('p'); const types = { n: 'node', w: 'way', r: 'relation' };
    const item = { id: p || 'pt', lon: lo, lat: la, name: sp.get('n') || t('whatsHere'), tags: {}, coord: !p };
    if (p) { item.osm_type = types[p[0]]; item.osm_id = +p.slice(1); }
    map.jumpTo({ center: [lo, la], zoom: 17 });
    openPlace(item, { noFly: true });
  } else if (sp.get('q')) { $('#q').value = sp.get('q'); fullSearch(sp.get('q')); }
  else showHome();
  updWx();
  if (sp.has('debug')) { const d = document.createElement('div'); d.style.cssText = 'position:fixed;bottom:4px;left:50%;transform:translateX(-50%);font:11px monospace;background:#000a;color:#fff;padding:2px 6px;z-index:999;border-radius:4px'; document.body.appendChild(d); setInterval(() => d.textContent = `v${VERSION} z${map.getZoom().toFixed(1)} dpr${devicePixelRatio} ${navigator.onLine ? 'on' : 'off'}`, 1000); }
});
// remember geolocation permission: if granted, show position silently
try { navigator.permissions?.query({ name: 'geolocation' }).then(s => { if (s.state === 'granted') locate(false); }); } catch {}

// ---------- service worker ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // app.js awaits the style at top level, so the window 'load' event may already have fired here
  const regSW = () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));
  if (document.readyState === 'complete') regSW(); else addEventListener('load', regSW);
}
track('visit', {});
