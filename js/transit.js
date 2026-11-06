// "Lines" layer: Servis (microbus) and bus routes for Damascus and Aleppo from OpenStreetMap (static data/transit/*.json).
// Off by default. Data is fetched only while the layer is on (with data saving: only when the list is opened);
// sw.js caches it (stale-while-revalidate) so it works offline afterwards.
import { esc, settings, saveSettings, toast, nf, fmtDist } from './util.js';
import { t, tN, getLang } from './i18n.js';
import { ic } from './icons.js';
import { App, openSheet, closeSheet, fitTo, desktop } from './core.js';
import { TRANSIT_DIR, OSM_WIKI_URL, tName, tAlt, lineLabel, shortRef, badgeRef, cityFitBounds, searchLines, sortLines, linesAtStop, linesGeoJSON, stopsGeoJSON, lineBounds, cityFor, osmUrl, nearbyCity, nearestStops } from './transit-core.js';

export const TR_LAYERS = ['kh-tr-line', 'kh-tr-sel-case', 'kh-tr-sel', 'kh-tr-stop'];
const S = { index: null, ix: null, data: {}, city: null, sel: null, stop: null, near: null, q: '' };
let dataRequest = 0; // discard stale city loads when another transit action wins
const EMPTY = { type: 'FeatureCollection', features: [] };
const COL = dark => ({ line: dark ? '#7FB4FF' : '#2F6FDB', sel: dark ? '#FFB347' : '#D9480F', case: dark ? '#1B1D21' : '#FFFFFF' });

export const transitOn = () => settings.transit === true;
function loadIndex() {
  return S.ix ||= fetch(TRANSIT_DIR + 'index.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(j => (S.index = j)).catch(e => { S.ix = null; throw e; });
}
function loadCity(c) {
  return S.data[c] ||= fetch(`${TRANSIT_DIR}${c}.json?v=${S.index?.v || ''}`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(e => { delete S.data[c]; throw e; });
}
async function cityData(c) { await loadIndex(); return loadCity(c); }

export function addTransitLayers(map, dark) {
  if (map.getSource('kh-tr')) return;
  const c = COL(dark);
  map.addSource('kh-tr', { type: 'geojson', data: EMPTY, attribution: '' });
  map.addSource('kh-tr-sel', { type: 'geojson', data: EMPTY, attribution: '' });
  map.addSource('kh-tr-stops', { type: 'geojson', data: EMPTY, attribution: '' });
  const before = ['kh-ov-dot', 'kh-poi-1', 'kh-poi-0', 'poi-transit'].find(id => map.getLayer(id));
  const vis = transitOn() ? 'visible' : 'none';
  map.addLayer({ id: 'kh-tr-line', type: 'line', source: 'kh-tr', layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.line, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 3], 'line-opacity': ['case', ['boolean', ['feature-state', 'dim'], false], 0.15, 0.55] } }, before);
  map.addLayer({ id: 'kh-tr-sel-case', type: 'line', source: 'kh-tr-sel', layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.case, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 7, 13, 10, 16, 15] } }, before);
  map.addLayer({ id: 'kh-tr-sel', type: 'line', source: 'kh-tr-sel', layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.sel, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 13, 6, 16, 9] } }, before);
  map.addLayer({ id: 'kh-tr-stop', type: 'circle', source: 'kh-tr-stops', minzoom: 11, layout: { visibility: vis },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 16, 6], 'circle-color': c.case, 'circle-stroke-color': S.sel ? c.sel : c.line, 'circle-stroke-width': 2 } }, before);
  draw(map);
}
function draw(map) {
  const d = S.data[S.city] && S.cur;
  map.getSource('kh-tr')?.setData(d ? linesGeoJSON(d) : EMPTY);
  const l = S.sel && d ? d.lines.find(x => x.id === S.sel) : null;
  const selected = l ? [l] : d && S.stop !== null ? linesAtStop(d, S.stop) : [];
  map.getSource('kh-tr-sel')?.setData(linesGeoJSON({ lines: selected }));
  map.getSource('kh-tr-stops')?.setData(d ? stopsGeoJSON(d, l ? l.stops : S.stop !== null ? [S.stop] : null) : EMPTY);
  if (map.getLayer('kh-tr-stop')) map.setPaintProperty('kh-tr-stop', 'circle-stroke-color', selected.length ? COL(document.documentElement.classList.contains('dark')).sel : COL(document.documentElement.classList.contains('dark')).line);
  if (map.getLayer('kh-tr-line')) map.setPaintProperty('kh-tr-line', 'line-opacity', selected.length ? 0.18 : 0.55);
}
function setVis(map, on) { for (const id of TR_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); }
function pill() {
  const b = document.getElementById('trPill'); if (!b) return;
  b.classList.toggle('hidden', !transitOn()); b.innerHTML = `${ic('bus')}<span>${esc(t('trOpenList'))}</span>`; b.setAttribute('aria-label', t('trTitle'));
}
// moveend / toggle: pick the city for the view and load its data (not in data-saving mode until the list is opened)
export async function syncTransit(map, { force = false } = {}) {
  pill(); setVis(map, transitOn());
  if (!transitOn()) return;
  if (App.sheetKind === 'transit' && S.cur && !force) return;
  if (settings.lowData && !force && !S.cur) return;
  try {
    await loadIndex();
    if (App.sheetKind === 'transit' && S.cur && !force) return;
    const c = map.getCenter(), city = cityFor(c.lng, c.lat, S.index) || S.city || (force ? 'damascus' : null);
    if (!city || (city === S.city && S.cur)) return;
    const request = ++dataRequest, data = await loadCity(city);
    if (request !== dataRequest || !transitOn()) return;
    S.city = city; S.cur = data; S.sel = null; S.stop = null; S.near = null; draw(map);
  } catch (e) { console.warn('transit', e); if (force) toast(t('trLoadErr')); }
}
export function toggleTransit(map) {
  ++dataRequest;
  settings.transit = !transitOn(); saveSettings();
  if (!transitOn()) { S.sel = null; S.stop = null; draw(map); if (App.sheetKind === 'transit') closeSheet(); }
  syncTransit(map);
}
const srcNote = () => `<p class="tr-src">${ic('info')}<span>${esc(t('trSrc'))} <a href="${OSM_WIKI_URL}" target="_blank" rel="noopener">${esc(t('trImprove'))}</a> · <span dir="ltr">© OpenStreetMap contributors (ODbL)</span></span></p>`;
const modeLbl = m => t(m === 'bus' ? 'trBus' : 'trServis');
const refBadge = l => `<span class="tr-ref ${l.mode === 'bus' ? 'bus' : 'servis'}"><bdi>${esc(badgeRef(l.ref) || (l.mode === 'bus' ? 'B' : 'S'))}</bdi></span>`;

export async function openLines(map) {
  if (!transitOn()) { settings.transit = true; saveSettings(); }
  await syncTransit(map, { force: true });
  const d = S.cur; if (!d) return;
  S.sel = null; S.stop = null; S.near = null; draw(map); renderList(map);
}
// "13 stops" with real plural forms (AR: موقف واحد / موقفان / 3–10 مواقف / 11–99 موقفًا / 100+ موقف)
// P3: plural category AND the strings AND the number all follow `lang` (was: only the rule; text from the UI language, raw digits)
const numFor = lang => lang === getLang() ? nf : undefined;
export function stopsN(n, lang = getLang()) { return tN('trStopsN', n, { lang, num: numFor(lang) }); }
export function linesN(n, lang = getLang()) { return tN('trLinesN', n, { lang, num: numFor(lang) }); }
function listHtml(d) {
  const lang = getLang(), res = sortLines(searchLines(d, S.q));
  if (!d.lines.length) return `<p class="tr-empty">${esc(t('trEmpty'))}</p>`;
  if (!res.length) return `<p class="tr-empty">${esc(t('trNone'))}</p>`;
  return res.map(l => `<button class="irow click tr-line" data-l="${l.id}">${refBadge(l)}<div class="iv"><div class="val" dir="auto">${esc(lineLabel(l, lang) || t('trNoName'))}</div><label>${esc([modeLbl(l.mode), l.from && l.to ? `${l.from} → ${l.to}` : '', (l.stops || []).length ? stopsN(l.stops.length) : ''].filter(Boolean).join(' · '))}</label></div></button>`).join('');
}
function renderList(map) {
  const d = S.cur, lang = getLang(), cities = Object.keys(S.index?.cities || {});
  // UI language names (EN/AR/DE) from i18n; the data file's name/name_ar only as a fallback for new cities
  const cname = c => { const k = 'trC_' + c, v = t(k); return v !== k ? v : (lang === 'ar' ? S.index.cities[c].name_ar : S.index.cities[c].name); };
  const html = `<div class="phead"><div><h2 class="ptitle">${esc(t('trTitle'))}</h2>
    <p class="psub">${esc(linesN(d.lines.length) + ' · ' + stopsN(d.stops.length))}</p></div><button class="pclose" id="trClose" aria-label="${t('close')}">${ic('close')}</button></div>
    <div class="seg tr-city" role="group" aria-label="${esc(t('trCity'))}">${cities.map(c => `<button data-c="${c}" class="${c === S.city ? 'on' : ''}" aria-pressed="${c === S.city}">${esc(cname(c))}</button>`).join('')}</div>
    <div class="arow"><button class="abtn" id="trNearMe">${ic('locate')}<span>${esc(t('trNearbyMe'))}</span></button></div>
    <div class="tr-q"><input id="trQ" type="search" dir="auto" placeholder="${esc(t('trSearch'))}" value="${esc(S.q)}" autocomplete="off"></div>
    ${srcNote()}
    <div class="igroup" id="trList">${listHtml(d)}</div><div style="height:16px"></div>`;
  const body = openSheet(html, 'half', trSheetClosed);
  document.body.classList.add('tr-line-open'); // pill would cover the zoom buttons while the list sheet is open
  App.sheetKind = 'transit';
  body.querySelector('#trClose').onclick = () => closeSheet();
  body.querySelector('#trNearMe').onclick = () => nearbyFromGPS(map);
  const q = body.querySelector('#trQ');
  q.oninput = () => { S.q = q.value; body.querySelector('#trList').innerHTML = listHtml(S.cur); };
  body.onclick = async e => {
    const c = e.target.closest('[data-c]');
    if (c && c.dataset.c !== S.city) {
      const city = c.dataset.c, request = ++dataRequest;
      try {
        const data = await cityData(city);
        if (request !== dataRequest || !c.isConnected) return;
        S.city = city; S.cur = data; S.near = null; S.sel = null; S.stop = null; draw(map);
        const b = S.index.cities[city].bbox; if (b) fitArea(cityFitBounds(city, b), 500); renderList(map);
      } catch { if (request === dataRequest) toast(t('trLoadErr')); }
      return;
    }
    const li = e.target.closest('[data-l]'); if (li) showLine(map, +li.dataset.l);
  };
}
// Fit the selected line into the map area above the sheet. fitTo() subtracts the map's own (sheet) padding,
// so these are total insets; left/right are symmetric, so LTR and RTL frame the same.
export const TR_MIN_Z = 12; // a whole city / long line must not zoom out to ~z9 (Aleppo was 9.4)
const trSheetClosed = () => document.body.classList.remove('tr-line-open');
// Shared by the city switch and a selected line: the bottom inset is the visible sheet, so on iPhone the city /
// line lands above the sheet (city switch used 30px and ended at z8.75 under the sheet); minZoom keeps it ≥ z12.
function fitArea(bb, duration = 600) {
  // desktop: the sheet is a side panel (already in the map padding) – equal extra inset on every side keeps the line / city centred in the free area
  if (desktop()) { const map = App.map, c = map.getPadding(), e = 60; fitTo(bb, { top: c.top + e, bottom: c.bottom + e, left: c.left + e, right: c.right + e }, { minZoom: TR_MIN_Z, maxZoom: 15.5, duration }); return; }
  const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sheet-visible')); // 0 on desktop (side panel)
  const sh = Number.isFinite(v) ? v : Math.round(innerHeight * 0.5);
  fitTo(bb, { top: (App.topPad ?? 120) + 16, bottom: sh ? sh + 72 : 40, left: 76, right: 76 } /* clears the FAB column on either side (LTR right, RTL left) */, { minZoom: TR_MIN_Z, maxZoom: 15.5, duration });
}
const fitLine = (map, bb) => fitArea(bb, 600);
export function showLine(map, id, fly = true) {
  const d = S.cur, l = d?.lines.find(x => x.id === id); if (!l) return;
  const lang = getLang(); S.sel = id; S.stop = null; draw(map);
  const bb = lineBounds(l, d);
  const alt = tAlt(l, lang), row = (k, v) => v ? `<div class="irow"><div class="iv"><label>${esc(t(k))}</label><div class="val" dir="auto">${esc(v)}</div></div></div>` : '';
  const stops = (l.stops || []).map((i, n) => { const s = d.stops[i]; return `<button class="irow click tr-stop" data-s="${i}"><span class="tr-dot">${n + 1}</span><div class="iv"><div class="val" dir="auto">${esc(tName(s, lang) || t('trUnnamed'))}</div>${tAlt(s, lang) ? `<label dir="auto">${esc(tAlt(s, lang))}</label>` : ''}</div></button>`; }).join('');
  const html = `<div class="phead"><div style="display:flex;gap:10px;align-items:flex-start">${refBadge(l)}<div><h2 class="ptitle" dir="auto">${esc(lineLabel(l, lang) || t('trNoName'))}</h2>
    ${alt ? `<p class="psub" dir="auto">${esc(alt)}</p>` : ''}<p class="psub">${esc(modeLbl(l.mode))}${shortRef(l.ref) ? ` · ${esc(t('trRef'))} <bdi>${esc(shortRef(l.ref))}</bdi>` : ''}</p></div></div>
    <button class="pclose" id="trBack" aria-label="${t('back')}">${ic('close')}</button></div>
    <div class="arow">${nearBack()}<button class="abtn" id="trAll">${ic('back')}<span>${esc(t('trTitle'))}</span></button><a class="abtn" href="${osmUrl('relation', l.id)}" target="_blank" rel="noopener">${ic('web')}<span>${esc(t('trOsmView'))}</span></a></div>
    <div class="igroup">${row('trFrom', l.from)}${row('trTo', l.to)}${row('trOperator', l.operator)}</div>
    <div class="dlabel">${esc(t('trStops')).toUpperCase()} · ${(l.stops || []).length}</div>
    <div class="igroup">${stops || `<p class="tr-empty">${esc(t('trNoStops'))}</p>`}</div>
    ${srcNote()}<div style="height:16px"></div>`;
  const body = openSheet(html, 'half', trSheetClosed); App.sheetKind = 'transit';
  document.body.classList.add('tr-line-open'); // hides the "Show lines" pill so it can't cover the highlighted path
  if (fly && bb) setTimeout(() => fitLine(map, bb), 380); // after the sheet settled at half height
  body.querySelector('#trBack').onclick = () => { S.sel = null; S.stop = null; draw(map); closeSheet(); };
  wireNearBack(body, map);
  body.querySelector('#trAll').onclick = () => { S.sel = null; S.stop = null; draw(map); renderList(map); };
  body.onclick = e => { const s = e.target.closest('[data-s]'); if (s) showStop(map, +s.dataset.s); };
}
export function showStop(map, i) {
  const d = S.cur, s = d?.stops[i]; if (!s) return;
  const lang = getLang(), ls = sortLines(linesAtStop(d, i));
  S.sel = null; S.stop = i; draw(map); // highlight only OSM relations actually serving this stop
  map.easeTo({ center: s.c, zoom: Math.max(map.getZoom(), 15), duration: 500 });
  const html = `<div class="phead"><div><h2 class="ptitle" dir="auto">${esc(tName(s, lang) || t('trUnnamed'))}</h2>${tAlt(s, lang) ? `<p class="psub" dir="auto">${esc(tAlt(s, lang))}</p>` : ''}<p class="psub">${esc(t('trStop'))}</p></div>
    <button class="pclose" id="trClose" aria-label="${t('close')}">${ic('close')}</button></div>
    <div class="arow">${nearBack()}<a class="abtn" href="${osmUrl('node', s.id)}" target="_blank" rel="noopener">${ic('web')}<span>${esc(t('trOsmView'))}</span></a></div>
    <div class="dlabel">${esc(t('trAtStop')).toUpperCase()} · ${ls.length}</div>
    <div class="igroup">${ls.map(l => `<button class="irow click tr-line" data-l="${l.id}">${refBadge(l)}<div class="iv"><div class="val" dir="auto">${esc(lineLabel(l, lang) || t('trNoName'))}</div><label>${esc(modeLbl(l.mode))}</label></div></button>`).join('')}</div>
    ${srcNote()}<div style="height:16px"></div>`;
  const body = openSheet(html, 'half', trSheetClosed); App.sheetKind = 'transit';
  document.body.classList.add('tr-line-open');
  wireNearBack(body, map);
  body.querySelector('#trClose').onclick = () => { S.sel = null; S.stop = null; draw(map); closeSheet(); };
  body.onclick = e => { const li = e.target.closest('[data-l]'); if (li) showLine(map, +li.dataset.l); };
}
// GPS is requested only on an explicit tap, never when opening a place or the layer.
async function nearbyFromGPS(map) {
  const button = document.getElementById('trNearMe');
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  try {
    const point = App.me || await new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('geolocation'));
      navigator.geolocation.getCurrentPosition(p => resolve([p.coords.longitude, p.coords.latitude]), reject,
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 });
    });
    // Do not replace a different sheet if the user navigated away while permission was pending.
    if (button && !button.isConnected) return;
    await openNearbyStops(map, { lon: point[0], lat: point[1], name: t('myLoc') });
  } catch { toast(t('locErr')); }
  finally { if (button) { button.disabled = false; button.removeAttribute('aria-busy'); } }
}
export async function openNearbyStops(map, place) {
  const request = ++dataRequest, point = [Number(place.lon), Number(place.lat)];
  const origin = document.querySelector('#sheetBody .phead');
  const current = () => request === dataRequest && (!origin || (origin.isConnected && document.getElementById('sheet')?.dataset.state !== 'hidden'));
  try {
    await loadIndex();
    if (!current()) return;
    const city = nearbyCity(point, S.index);
    if (!city) { toast(t('trNearbyCoverage')); return; }
    const data = await cityData(city);
    if (!current()) return;
    settings.transit = true; saveSettings(); pill(); setVis(map, true);
    S.city = city; S.cur = data; S.sel = null; S.stop = null;
    S.near = { point, name: place.name || t('trNearbyPlace') };
    draw(map); renderNearby(map);
  } catch { if (current()) toast(t('trLoadErr')); }
}
const nearBack = () => S.near ? `<button class="abtn" id="trNearBack">${ic('back')}<span>${esc(t('trNearby'))}</span></button>` : '';
function wireNearBack(body, map) {
  body.querySelector('#trNearBack')?.addEventListener('click', () => { S.sel = null; S.stop = null; draw(map); renderNearby(map); });
}
function renderNearby(map) {
  const lang = getLang(), rows = nearestStops(S.cur, S.near.point);
  const html = `<div class="phead"><div><h2 class="ptitle">${esc(t('trNearby'))}</h2><p class="psub" dir="auto">${esc(S.near.name)}</p></div>
    <button class="pclose" id="trClose" aria-label="${esc(t('close'))}">${ic('close')}</button></div>
    <p class="tr-src">${esc(t('trNearbyDistance'))}</p>${srcNote()}
    <div class="igroup">${rows.map(({ stop, i, distance, lines }) => `<button class="irow click tr-stop" data-s="${i}"><span class="tr-dot">${ic('bus')}</span><div class="iv"><div class="val" dir="auto">${esc(tName(stop, lang) || t('trUnnamed'))}</div>
      <label dir="auto">${esc(sortLines(lines).map(l => [shortRef(l.ref), lineLabel(l, lang) || t('trNoName')].filter(Boolean).join(' · ')).join(' / '))}</label><label>${esc(fmtDist(distance))}</label></div></button>`).join('') || `<p class="tr-empty">${esc(t('trNearbyEmpty'))}</p>`}</div>
    <div class="arow"><button class="abtn" id="trAll">${ic('bus')}<span>${esc(t('trTitle'))}</span></button></div><div style="height:16px"></div>`;
  const body = openSheet(html, 'half', trSheetClosed); App.sheetKind = 'transit';
  document.body.classList.add('tr-line-open');
  body.querySelector('#trClose').onclick = () => closeSheet();
  body.querySelector('#trAll').onclick = () => renderList(map);
  body.onclick = e => { const stop = e.target.closest('[data-s]'); if (stop) showStop(map, +stop.dataset.s); };
}
// map click: stop first, then a line; returns true when handled
export function transitClick(map, e) {
  if (!transitOn() || !S.cur) return false;
  const box = [[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]];
  const st = map.queryRenderedFeatures(box, { layers: ['kh-tr-stop'].filter(id => map.getLayer(id)) });
  if (st.length) { showStop(map, st[0].properties.i); return true; }
  const ln = map.queryRenderedFeatures(box, { layers: ['kh-tr-sel', 'kh-tr-line'].filter(id => map.getLayer(id)) });
  if (ln.length) { showLine(map, +ln[0].properties.id, false); return true; }
  return false;
}
export const _state = S; // tests / debugging
