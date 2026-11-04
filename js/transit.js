// "Lines" layer: Servis (microbus) and bus routes for Damascus and Aleppo from OpenStreetMap (static data/transit/*.json).
// Off by default. Data is fetched only while the layer is on (with data saving: only when the list is opened);
// sw.js caches it (stale-while-revalidate) so it works offline afterwards.
import { esc, settings, saveSettings, toast } from './util.js';
import { t, getLang } from './i18n.js';
import { ic } from './icons.js';
import { App, openSheet, closeSheet, fitTo, desktop } from './core.js';
import { TRANSIT_DIR, OSM_WIKI_URL, tName, tAlt, lineLabel, searchLines, sortLines, linesAtStop, linesGeoJSON, stopsGeoJSON, lineBounds, cityFor, osmUrl } from './transit-core.js';

export const TR_LAYERS = ['kh-tr-line', 'kh-tr-sel-case', 'kh-tr-sel', 'kh-tr-stop'];
const S = { index: null, ix: null, data: {}, city: null, sel: null, q: '' };
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
  map.getSource('kh-tr-sel')?.setData(l ? linesGeoJSON({ lines: [l] }) : EMPTY);
  map.getSource('kh-tr-stops')?.setData(d ? stopsGeoJSON(d, l ? l.stops : null) : EMPTY);
  if (map.getLayer('kh-tr-stop')) map.setPaintProperty('kh-tr-stop', 'circle-stroke-color', l ? COL(document.documentElement.classList.contains('dark')).sel : COL(document.documentElement.classList.contains('dark')).line);
  if (map.getLayer('kh-tr-line')) map.setPaintProperty('kh-tr-line', 'line-opacity', l ? 0.18 : 0.55);
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
  if (settings.lowData && !force && !S.cur) return;
  try {
    await loadIndex();
    const c = map.getCenter(), city = cityFor(c.lng, c.lat, S.index) || S.city || (force ? 'damascus' : null);
    if (!city || (city === S.city && S.cur)) return;
    S.city = city; S.cur = await loadCity(city); draw(map);
  } catch (e) { console.warn('transit', e); if (force) toast(t('trLoadErr')); }
}
export function toggleTransit(map) {
  settings.transit = !transitOn(); saveSettings();
  if (!transitOn()) { S.sel = null; draw(map); if (App.sheetKind === 'transit') closeSheet(); }
  syncTransit(map);
}
const srcNote = () => `<p class="tr-src">${ic('info')}<span>${esc(t('trSrc'))} <a href="${OSM_WIKI_URL}" target="_blank" rel="noopener">${esc(t('trImprove'))}</a> · <span dir="ltr">© OpenStreetMap contributors (ODbL)</span></span></p>`;
const modeLbl = m => t(m === 'bus' ? 'trBus' : 'trServis');
const refBadge = l => `<span class="tr-ref ${l.mode === 'bus' ? 'bus' : 'servis'}"><bdi>${esc(l.ref || (l.mode === 'bus' ? 'B' : 'S'))}</bdi></span>`;

export async function openLines(map) {
  if (!transitOn()) { settings.transit = true; saveSettings(); }
  await syncTransit(map, { force: true });
  const d = S.cur; if (!d) return;
  S.sel = null; draw(map); renderList(map);
}
// "13 stops" with real plural forms (AR: موقف واحد / موقفان / 3–10 مواقف / 11–99 موقفًا / 100+ موقف)
export function stopsN(n, lang = getLang()) {
  const cat = new Intl.PluralRules(lang).select(n), k = 'trStopsN_' + cat, v = t(k, { n });
  return v !== k ? v : t('trStopsN_other', { n });
}
function listHtml(d) {
  const lang = getLang(), res = sortLines(searchLines(d, S.q));
  if (!d.lines.length) return `<p class="tr-empty">${esc(t('trEmpty'))}</p>`;
  if (!res.length) return `<p class="tr-empty">${esc(t('trNone'))}</p>`;
  return res.map(l => `<button class="irow click tr-line" data-l="${l.id}">${refBadge(l)}<div class="iv"><div class="val" dir="auto">${esc(lineLabel(l, lang))}</div><label>${esc([modeLbl(l.mode), l.from && l.to ? `${l.from} → ${l.to}` : '', (l.stops || []).length ? stopsN(l.stops.length) : ''].filter(Boolean).join(' · '))}</label></div></button>`).join('');
}
function renderList(map) {
  const d = S.cur, lang = getLang(), cities = Object.keys(S.index?.cities || {});
  // UI language names (EN/AR/DE) from i18n; the data file's name/name_ar only as a fallback for new cities
  const cname = c => { const k = 'trC_' + c, v = t(k); return v !== k ? v : (lang === 'ar' ? S.index.cities[c].name_ar : S.index.cities[c].name); };
  const html = `<div class="phead"><div><h2 class="ptitle">${esc(t('trTitle'))}</h2>
    <p class="psub">${esc(t('trCount', { n: d.lines.length, s: d.stops.length }).replace(/[\d,.٬]+\s+\S+$/, stopsN(d.stops.length)))}</p></div><button class="pclose" id="trClose" aria-label="${t('close')}">${ic('close')}</button></div>
    <div class="seg tr-city" role="group" aria-label="${esc(t('trCity'))}">${cities.map(c => `<button data-c="${c}" class="${c === S.city ? 'on' : ''}" aria-pressed="${c === S.city}">${esc(cname(c))}</button>`).join('')}</div>
    <div class="tr-q"><input id="trQ" type="search" dir="auto" placeholder="${esc(t('trSearch'))}" value="${esc(S.q)}" autocomplete="off"></div>
    ${srcNote()}
    <div class="igroup" id="trList">${listHtml(d)}</div><div style="height:16px"></div>`;
  const body = openSheet(html, 'half', trSheetClosed);
  document.body.classList.add('tr-line-open'); // pill would cover the zoom buttons while the list sheet is open
  App.sheetKind = 'transit';
  body.querySelector('#trClose').onclick = () => closeSheet();
  const q = body.querySelector('#trQ');
  q.oninput = () => { S.q = q.value; body.querySelector('#trList').innerHTML = listHtml(S.cur); };
  body.onclick = async e => {
    const c = e.target.closest('[data-c]');
    if (c && c.dataset.c !== S.city) {
      try { S.city = c.dataset.c; S.cur = await cityData(S.city); S.sel = null; draw(map); const b = S.index.cities[S.city].bbox; if (b) fitTo([[b[0], b[1]], [b[2], b[3]]], { top: 30, bottom: 30, left: 30, right: 30 }, { minZoom: TR_MIN_Z, maxZoom: 15.5, duration: 500 }); renderList(map); } catch { toast(t('trLoadErr')); }
      return;
    }
    const li = e.target.closest('[data-l]'); if (li) showLine(map, +li.dataset.l);
  };
}
// Fit the selected line into the map area above the sheet. fitTo() subtracts the map's own (sheet) padding,
// so these are total insets; left/right are symmetric, so LTR and RTL frame the same.
export const TR_MIN_Z = 12; // a whole city / long line must not zoom out to ~z9 (Aleppo was 9.4)
const trSheetClosed = () => document.body.classList.remove('tr-line-open');
function fitLine(map, bb) {
  // desktop: the sheet is a side panel (already in the map padding) – equal extra inset on every side keeps the line centred in the free area
  if (desktop()) { const c = map.getPadding(), e = 60; fitTo(bb, { top: c.top + e, bottom: c.bottom + e, left: c.left + e, right: c.right + e }, { minZoom: TR_MIN_Z, maxZoom: 15.5, duration: 600 }); return; }
  const sh = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sheet-visible')) || Math.round(innerHeight * 0.5);
  fitTo(bb, { top: (App.topPad ?? 120) + 16, bottom: sh + 72, left: 76, right: 76 } /* clears the FAB column on either side (LTR right, RTL left) */, { minZoom: TR_MIN_Z, maxZoom: 15.5, duration: 600 });
}
export function showLine(map, id, fly = true) {
  const d = S.cur, l = d?.lines.find(x => x.id === id); if (!l) return;
  const lang = getLang(); S.sel = id; draw(map);
  const bb = lineBounds(l, d);
  const alt = tAlt(l, lang), row = (k, v) => v ? `<div class="irow"><div class="iv"><label>${esc(t(k))}</label><div class="val" dir="auto">${esc(v)}</div></div></div>` : '';
  const stops = (l.stops || []).map((i, n) => { const s = d.stops[i]; return `<button class="irow click tr-stop" data-s="${i}"><span class="tr-dot">${n + 1}</span><div class="iv"><div class="val" dir="auto">${esc(tName(s, lang) || t('trUnnamed'))}</div>${tAlt(s, lang) ? `<label dir="auto">${esc(tAlt(s, lang))}</label>` : ''}</div></button>`; }).join('');
  const html = `<div class="phead"><div style="display:flex;gap:10px;align-items:flex-start">${refBadge(l)}<div><h2 class="ptitle" dir="auto">${esc(lineLabel(l, lang))}</h2>
    ${alt ? `<p class="psub" dir="auto">${esc(alt)}</p>` : ''}<p class="psub">${esc(modeLbl(l.mode))}${l.ref ? ` · ${esc(t('trRef'))} <bdi>${esc(l.ref)}</bdi>` : ''}</p></div></div>
    <button class="pclose" id="trBack" aria-label="${t('back')}">${ic('close')}</button></div>
    <div class="arow"><button class="abtn" id="trAll">${ic('back')}<span>${esc(t('trTitle'))}</span></button><a class="abtn" href="${osmUrl('relation', l.id)}" target="_blank" rel="noopener">${ic('web')}<span>${esc(t('trOsmView'))}</span></a></div>
    <div class="igroup">${row('trFrom', l.from)}${row('trTo', l.to)}${row('trOperator', l.operator)}</div>
    <div class="dlabel">${esc(t('trStops')).toUpperCase()} · ${(l.stops || []).length}</div>
    <div class="igroup">${stops || `<p class="tr-empty">${esc(t('trNoStops'))}</p>`}</div>
    ${srcNote()}<div style="height:16px"></div>`;
  const body = openSheet(html, 'half', trSheetClosed); App.sheetKind = 'transit';
  document.body.classList.add('tr-line-open'); // hides the "Show lines" pill so it can't cover the highlighted path
  if (fly && bb) setTimeout(() => fitLine(map, bb), 380); // after the sheet settled at half height
  body.querySelector('#trBack').onclick = () => { S.sel = null; draw(map); closeSheet(); };
  body.querySelector('#trAll').onclick = () => { S.sel = null; draw(map); renderList(map); };
  body.onclick = e => { const s = e.target.closest('[data-s]'); if (s) showStop(map, +s.dataset.s); };
}
export function showStop(map, i) {
  const d = S.cur, s = d?.stops[i]; if (!s) return;
  const lang = getLang(), ls = sortLines(linesAtStop(d, i));
  map.easeTo({ center: s.c, zoom: Math.max(map.getZoom(), 15), duration: 500 });
  const html = `<div class="phead"><div><h2 class="ptitle" dir="auto">${esc(tName(s, lang) || t('trUnnamed'))}</h2>${tAlt(s, lang) ? `<p class="psub" dir="auto">${esc(tAlt(s, lang))}</p>` : ''}<p class="psub">${esc(t('trStop'))}</p></div>
    <button class="pclose" id="trClose" aria-label="${t('close')}">${ic('close')}</button></div>
    <div class="arow"><a class="abtn" href="${osmUrl('node', s.id)}" target="_blank" rel="noopener">${ic('web')}<span>${esc(t('trOsmView'))}</span></a></div>
    <div class="dlabel">${esc(t('trAtStop')).toUpperCase()} · ${ls.length}</div>
    <div class="igroup">${ls.map(l => `<button class="irow click tr-line" data-l="${l.id}">${refBadge(l)}<div class="iv"><div class="val" dir="auto">${esc(lineLabel(l, lang))}</div><label>${esc(modeLbl(l.mode))}</label></div></button>`).join('')}</div>
    ${srcNote()}<div style="height:16px"></div>`;
  const body = openSheet(html, 'half', null); App.sheetKind = 'transit';
  body.querySelector('#trClose').onclick = () => { S.sel = null; draw(map); closeSheet(); };
  body.onclick = e => { const li = e.target.closest('[data-l]'); if (li) showLine(map, +li.dataset.l); };
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
