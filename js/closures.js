// Community road reports: report sheet (anonymous, moderated) + map layer of APPROVED entries from data/closures.json.
// Nothing a user sends is shown directly – only what moderators export into the static file. Expired entries are hidden.
import { $, esc, toast, fmtCoord } from './util.js';
import { t } from './i18n.js';
import { ic } from './icons.js';
import { App, openSheet, closeSheet } from './core.js';
import { sendNow } from './analytics.js';
import { rateCheck, rateNote } from './report-core.js';
import { CLOSURE_KINDS, CLOSURE_COLORS, NOTE_MAX, buildClosureReport, nearestOnPolyline, activeClosures, toGeoJSON, snap } from './closures-core.js';

export const CL_LAYERS = ['kh-cl-halo', 'kh-cl-icon'];
const URL_ = 'data/closures.json';
let list = [], loaded = null;
export const activeList = () => list.filter(e => Date.parse(e.expires) > Date.now());

// white glyphs drawn on a coloured disc (no sprite / glyph dependency)
const GLYPH = {
  closed: 'M5,10.5H19V13.5H5Z',
  delay: 'M12,4A8,8 0 1,0 20,12A8,8 0 0,0 12,4M12,6A6,6 0 1,1 6,12A6,6 0 0,1 12,6M11,8V12.4L14.6,14.6L15.6,13L13,11.4V8Z',
  construction: 'M10.6,4H13.4L17.5,18H19V20H5V18H6.5ZM9.7,11H14.3L13.7,9H10.3ZM8.8,14L8.2,16H15.8L15.2,14Z',
  flooding: 'M2,15C4,15 4.5,13.5 7,13.5S10,15 12,15 14.5,13.5 17,13.5 20,15 22,15V17C20,17 19.5,15.5 17,15.5S14,17 12,17 9.5,15.5 7,15.5 4,17 2,17ZM2,19.5C4,19.5 4.5,18 7,18S10,19.5 12,19.5 14.5,18 17,18 20,19.5 22,19.5V21.5C20,21.5 19.5,20 17,20S14,21.5 12,21.5 9.5,20 7,20 4,21.5 2,21.5ZM12,3L16,9H13V12H11V9H8Z',
};
function iconImage(kind) {
  const s = 2, n = 28 * s, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'); if (!g) return null;
  g.beginPath(); g.arc(n / 2, n / 2, n / 2 - 2 * s, 0, Math.PI * 2); g.fillStyle = CLOSURE_COLORS[kind]; g.fill();
  g.lineWidth = 2 * s; g.strokeStyle = '#fff'; g.stroke();
  g.save(); g.translate(n / 2 - 9 * s, n / 2 - 9 * s); g.scale(0.75 * s, 0.75 * s); g.fillStyle = '#fff';
  try { g.fill(new Path2D(GLYPH[kind])); } catch {}
  g.restore();
  return { img: g.getImageData(0, 0, n, n), pixelRatio: s };
}

export function loadClosures(force = false) {
  if (loaded && !force) return loaded;
  loaded = fetch(URL_, { cache: 'no-cache' }).then(r => r.ok ? r.json() : { closures: [] }).catch(() => ({ closures: [] }))
    .then(doc => { list = activeClosures(doc); syncSource(); return list; });
  return loaded;
}
function syncSource() { App.map?.getSource('kh-cl')?.setData(toGeoJSON(activeList())); }

export function addClosureLayers(map) {
  if (!map?.isStyleLoaded?.() || map.getSource('kh-cl')) return;
  for (const k of CLOSURE_KINDS) { const id = 'kh-cl-' + k; if (!map.hasImage(id)) { const im = iconImage(k); if (im) map.addImage(id, im.img, { pixelRatio: im.pixelRatio }); } }
  map.addSource('kh-cl', { type: 'geojson', data: toGeoJSON(activeList()) });
  map.addLayer({ id: 'kh-cl-halo', type: 'circle', source: 'kh-cl', minzoom: 9,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 6, 16, 22], 'circle-opacity': 0.18,
      'circle-color': ['match', ['get', 'kind'], ...CLOSURE_KINDS.flatMap(k => [k, CLOSURE_COLORS[k]]), '#888'] } });
  map.addLayer({ id: 'kh-cl-icon', type: 'symbol', source: 'kh-cl', minzoom: 9,
    layout: { 'icon-image': ['concat', 'kh-cl-', ['get', 'kind']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 15, 1], 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
}
export function initClosures(map) {
  const add = () => addClosureLayers(map);
  map.on('style.load', add); map.once('idle', add);
  loadClosures();
  // re-read the file after an hour in the foreground and drop expired entries every 5 min
  setInterval(syncSource, 5 * 6e4); setInterval(() => loadClosures(true), 36e5);
  map.on('mouseenter', 'kh-cl-icon', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'kh-cl-icon', () => map.getCanvas().style.cursor = '');
}

/** Map click: open the closure under the pointer (called first by the main click handler). */
export function closureClick(map, pt) {
  if (!map.getLayer('kh-cl-icon')) return false;
  const f = map.queryRenderedFeatures([[pt.x - 14, pt.y - 14], [pt.x + 14, pt.y + 14]], { layers: ['kh-cl-icon'] })[0];
  if (!f) return false;
  openClosure(f.properties, f.geometry.coordinates); return true;
}
const fmtWhen = iso => { try { return new Intl.DateTimeFormat(document.documentElement.lang || 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch { return iso; } };
export function openClosure(p, ll) {
  const html = `<div class="phead"><div><h2 class="ptitle"><span class="cl-dot" style="background:${CLOSURE_COLORS[p.kind] || '#888'}"></span>${esc(t('clK_' + p.kind))}</h2>
    ${p.road ? `<p class="psub" dir="auto">${esc(p.road)}</p>` : ''}</div><button class="pclose" id="clClose" aria-label="${esc(t('close'))}">${ic('close')}</button></div>
    <div class="cl-body">
      ${p.note ? `<p class="cl-note" dir="auto">${esc(p.note)}</p>` : ''}
      <div class="cl-meta"><div><label>${esc(t('clSince'))}</label><span>${esc(fmtWhen(p.since))}</span></div><div><label>${esc(t('clUntil'))}</label><span>${esc(fmtWhen(p.expires))}</span></div></div>
      <p class="rp-note">${ic('info', 'xs')}<span>${esc(t('clDisclaimer'))}</span></p>
      <button class="abtn cl-rep" id="clRep">${ic('flag')}<span>${esc(t('clReportHere'))}</span></button>
    </div>`;
  const body = openSheet(html, 'half');
  body.querySelector('#clClose').onclick = () => closeSheet();
  body.querySelector('#clRep').onclick = () => openClosureReport({ lat: ll[1], lon: ll[0], road: p.road });
}

// Snap a dropped pin onto the nearest rendered OSM road (OpenFreeMap 'transportation' layer) within ~30 px.
export function snapToRoad(map, lon, lat) {
  try {
    const pt = map.project([lon, lat]);
    const fs = map.queryRenderedFeatures([[pt.x - 30, pt.y - 30], [pt.x + 30, pt.y + 30]]).filter(f => (f.sourceLayer === 'transportation' || f.sourceLayer === 'transportation_name') && f.geometry);
    let best = null;
    for (const f of fs) {
      const g = f.geometry, lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const l of lines) { const n = nearestOnPolyline([lon, lat], l); if (n.pt && (!best || n.d < best.d)) best = { ...n, name: f.properties?.['name:' + (document.documentElement.lang || 'en')] || f.properties?.name || best?.name || '' }; }
    }
    if (best && best.d <= 60) return { lon: best.pt[0], lat: best.pt[1], road: best.name || '', snapped: true };
  } catch {}
  return { lon, lat, road: '', snapped: false };
}

let busy = false;
/** item: { lat, lon, road? } – a dropped pin on a road. */
export function openClosureReport(item) {
  const s = snap(item.lat, item.lon);
  let kind = '';
  const html = `<div class="phead"><div><h2 class="ptitle">${esc(t('clTitle'))}</h2>${item.road ? `<p class="psub" dir="auto">${esc(item.road)}</p>` : ''}</div><button class="pclose" id="clClose" aria-label="${esc(t('close'))}">${ic('close')}</button></div>
    <form class="rp" id="clForm" novalidate>
      <div class="rp-f"><label>${esc(t('rpPos'))}</label><div class="rp-pos"><span dir="ltr">${esc(fmtCoord(s.lat, s.lon))}</span></div><small>${esc(t('clPosHint'))}</small></div>
      <div class="rp-f" role="radiogroup" aria-label="${esc(t('clKind'))}"><label>${esc(t('clKind'))}</label><div class="cl-kinds">
        ${CLOSURE_KINDS.map(k => `<button type="button" role="radio" aria-checked="false" class="cl-kind" data-k="${k}"><span class="cl-dot" style="background:${CLOSURE_COLORS[k]}"></span>${esc(t('clK_' + k))}</button>`).join('')}</div></div>
      <div class="rp-f"><label for="clNote">${esc(t('clNote'))}</label><textarea id="clNote" dir="auto" rows="2" maxlength="${NOTE_MAX}"></textarea></div>
      <p class="rp-err" id="clErr" role="alert" hidden></p>
      <button class="rp-send" id="clSend" type="submit">${esc(t('rpSend'))}</button>
      <p class="rp-note">${ic('info', 'xs')}<span>${esc(t('clModerated'))}</span></p></form>`;
  const body = openSheet(html, 'full');
  body.querySelector('#clClose').onclick = () => closeSheet();
  body.querySelectorAll('.cl-kind').forEach(b => b.onclick = () => { kind = b.dataset.k; body.querySelectorAll('.cl-kind').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); });
  const err = k => { const e = body.querySelector('#clErr'); e.textContent = t(k); e.hidden = false; };
  body.querySelector('#clForm').onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const b = buildClosureReport(kind, body.querySelector('#clNote').value, item.lat, item.lon, item.road);
    if (!b.ok) return err(b.err === 'kind' ? 'clE_kind' : 'rpE_pos');
    const rl = rateCheck(); if (!rl.ok) return err(rl.why === 'gap' ? 'rpE_gap' : 'rpE_rate');
    busy = true; const btn = body.querySelector('#clSend'); btn.disabled = true; btn.textContent = t('rpSending');
    const r = await sendNow('layer', b.props);
    busy = false;
    if (!body.isConnected) return;
    btn.disabled = false; btn.textContent = t('rpSend');
    if (r.ok) { rateNote(); closeSheet(); toast(t('rpThanks'), 4000); return; }
    err(r.why === 'offline' ? 'rpE_offline' : r.why === 'dev' ? 'rpE_dev' : 'rpE_send');
  };
}
