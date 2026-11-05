// Directions (OSRM @ FOSSGIS with Valhalla @ FOSSGIS failover), alternatives, multi-stop,
// turn-by-turn list, live GPS navigation with rerouting + voice guidance.
import { setPoiVisible } from './poi.js';
import { $, esc, fetchJSON, fmtDist, fmtDur, fmtTime, nf, digits, haversine, bearing, compass8, nearestOnLine, cumulative, toast, settings, saveSettings, lsGet } from './util.js';
import { t, getLang, SPEECH_LANG } from './i18n.js';
import { ic } from './icons.js';
import { App, openSheet, closeSheet, setSelMarker, clearMarkers, center, pinEl, setSheet, mapPadding, fitTo } from './core.js';
import { track } from './analytics.js';
import { speak as voiceSpeak, navPrompt, navVoiceStart, arriveText, reroutingText, stopSpeaking, unlockSpeech, sampleText, isIOS } from './voice.js';
import { dedupe, combobox, cleanQuery } from './suggest.js';
import { placeSuggest, offlineNotice } from './search.js';
import { loadGazetteer } from './offline-search.js';
import { activeList } from './closures.js';
import { closuresNearRoute, plural } from './closures-core.js';
import { enrichStepsWithLandmarks, harvestFromMap, seedFromSyriaPois, stepUsesLandmark, formatLandmarkInstr, deArticle, setLandmarkFocus } from './landmarks.js';
import { P } from './poi.js';

const R = { stops: [], mode: 'car', routes: [], sel: 0, markers: [], active: false };
export const routeState = R;

// ---------------- instruction text ----------------
function ord(n) { const o = t('ordinals'); return o[n - 1] || String(n); }
function lmAction(s) {
  const mods = t('mods'), m = s.modifier || 'straight';
  if ((s.type === 'new name' || s.type === 'continue' || s.type === 'notification') && (m === 'straight' || !mods[m])) {
    return (t('cont') || 'continue').toLocaleLowerCase(getLang());
  }
  let a = mods[m] || mods.straight;
  return a.charAt(0).toLocaleLowerCase(getLang()) + a.slice(1);
}
function lmBanner(s) {
  const lm = s.landmark;
  const tpl = { text: t(lm.relation === 'after' ? 'lmAfter' : 'lmAt'), art: getLang() === 'de' ? deArticle(lm.kind, lm.name) : '' };
  return formatLandmarkInstr(lm, lmAction(s), tpl);
}
export function instr(s) {
  if (stepUsesLandmark(s)) return lmBanner(s);
  const n = s.name ? (s.ref && !s.name.includes(s.ref) ? `${s.name} (${s.ref})` : s.name) : (s.ref || '');
  const mods = t('mods'), m = s.modifier || 'straight';
  const side = /left/.test(m) ? t('sideL') : t('sideR');
  switch (s.type) {
    case 'depart': return n ? t('departOn', { dir: t('dirs')[compass8(s.bearing_after || 0)], n }) : t('depart', { dir: t('dirs')[compass8(s.bearing_after || 0)] });
    case 'arrive': return s.last ? (s.modifier === 'left' ? t('arriveL') : s.modifier === 'right' ? t('arriveR') : t('arriveDest')) : t('arriveWp', { n: s.leg + 1 });
    case 'roundabout': case 'rotary': case 'roundabout turn': case 'exit roundabout': case 'exit rotary':
      if (s.exit) return n ? t('rbtOnto', { x: ord(s.exit), n }) : t('rbt', { x: ord(s.exit) });
      return t('rbtEnter');
    case 'merge': return n ? t('mergeOnto', { n }) : t('merge');
    case 'on ramp': return n ? t('rampOnto', { n }) : t('ramp');
    case 'off ramp': return n ? t('exitOnto', { n }) : t('exitRamp');
    case 'fork': return n ? t('keepOnto', { side, n }) : t('keep', { side });
    case 'end of road': return t('endRoad', { a: (n ? t('onto', { a: mods[m] || mods.straight, n }) : (mods[m] || mods.straight)).toLowerCase() });
    case 'new name': case 'continue': if (m === 'straight' || !mods[m]) return n ? t('contOn', { n }) : t('cont'); // fallthrough
    case 'notification': if (m === 'straight' || !mods[m]) return n ? t('contOn', { n }) : t('cont');
    case 'ferry': if (s.type === 'ferry') return t('ferry');
    default: { const a = mods[m] || mods.straight; return n ? t('onto', { a, n }) : a; }
  }
}
export function stepIcon(s) {
  if (s.type === 'arrive') return 'flag';
  if (/roundabout|rotary/.test(s.type)) return 'roundabout';
  if (s.type === 'ferry') return 'ferry';
  if (s.type === 'merge') return 'merge';
  if (s.type === 'fork') return /left/.test(s.modifier) ? 'slightLeft' : 'slightRight';
  return { uturn: 'uturn', 'sharp right': 'turnRight', right: 'turnRight', 'slight right': 'slightRight', straight: 'straight', 'slight left': 'slightLeft', left: 'turnLeft', 'sharp left': 'turnLeft' }[s.modifier] || 'straight';
}

// ---------------- routing engines ----------------
const OSRM = { car: 'routed-car', foot: 'routed-foot', bike: 'routed-bike' };
async function osrm(stops, mode, opts = {}) {
  const coords = stops.map(s => s.lon.toFixed(6) + ',' + s.lat.toFixed(6)).join(';');
  const alt = stops.length === 2 ? '&alternatives=2' : '';
  // reroute while driving: depart in the current direction of travel instead of a U-turn (OSRM bearings=value,range)
  const brg = opts.heading != null ? '&bearings=' + Math.round((opts.heading + 360) % 360) + ',60' + ';'.repeat(stops.length - 1) : '';
  const j = await fetchJSON(`https://routing.openstreetmap.de/${OSRM[mode]}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true${alt}${brg}&continue_straight=default`, {}, 20000);
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.code || 'noroute');
  return j.routes.map(r => {
    const steps = [];
    r.legs.forEach((leg, li) => leg.steps.forEach(s => {
      const m = s.maneuver;
      if (m.type === 'arrive' && li < r.legs.length - 1) { /* waypoint */ }
      steps.push({ type: m.type, modifier: m.modifier, exit: m.exit, name: s.name, ref: s.ref, distance: s.distance, duration: s.duration, loc: m.location, bearing_after: m.bearing_after, leg: li, last: li === r.legs.length - 1 && m.type === 'arrive', mode: s.mode, lanes: s.intersections?.[0]?.lanes || null });
    }));
    const names = {}; steps.forEach(s => { if (s.name || s.ref) names[s.ref || s.name] = (names[s.ref || s.name] || 0) + s.distance; });
    const summary = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 1).map(x => x[0]).join(', ');
    return { coords: r.geometry.coordinates, distance: r.distance, duration: r.duration, steps, summary, engine: 'OSRM' };
  });
}
function decode6(str) {
  let idx = 0, lat = 0, lon = 0; const out = [];
  while (idx < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}
const VTYPE = { 1: ['depart'], 2: ['depart'], 3: ['depart'], 4: ['arrive'], 5: ['arrive', 'right'], 6: ['arrive', 'left'], 7: ['new name', 'straight'], 8: ['continue', 'straight'], 9: ['turn', 'slight right'], 10: ['turn', 'right'], 11: ['turn', 'sharp right'], 12: ['turn', 'uturn'], 13: ['turn', 'uturn'], 14: ['turn', 'sharp left'], 15: ['turn', 'left'], 16: ['turn', 'slight left'], 17: ['on ramp', 'straight'], 18: ['on ramp', 'slight right'], 19: ['on ramp', 'slight left'], 20: ['off ramp', 'slight right'], 21: ['off ramp', 'slight left'], 22: ['fork', 'straight'], 23: ['fork', 'slight right'], 24: ['fork', 'slight left'], 25: ['merge', 'straight'], 26: ['roundabout', 'straight'], 27: ['exit roundabout', 'straight'], 28: ['ferry'], 29: ['continue'], 36: ['turn', 'right'], 37: ['turn', 'left'], 38: ['merge', 'right'], 39: ['merge', 'left'] };
async function valhalla(stops, mode, opts = {}) {
  const costing = { car: 'auto', foot: 'pedestrian', bike: 'bicycle' }[mode];
  const req = { locations: stops.map((s, i) => ({ lat: s.lat, lon: s.lon, type: i === 0 || i === stops.length - 1 ? 'break' : 'break' })), costing, directions_options: { units: 'kilometers', language: 'en-US' }, alternates: stops.length === 2 ? 2 : 0 };
  if (opts.heading != null) { req.locations[0].heading = Math.round((opts.heading + 360) % 360); req.locations[0].heading_tolerance = 60; }
  const j = await fetchJSON('https://valhalla1.openstreetmap.de/route?json=' + encodeURIComponent(JSON.stringify(req)), {}, 20000);
  const trips = [j.trip, ...(j.alternates || []).map(a => a.trip)].filter(Boolean);
  return trips.map(trip => {
    let coords = [], steps = [];
    trip.legs.forEach((leg, li) => {
      const shape = decode6(leg.shape); const off = coords.length; coords = coords.concat(shape);
      leg.maneuvers.forEach(m => {
        const [type, modifier] = VTYPE[m.type] || ['turn', 'straight'];
        steps.push({ type, modifier, exit: m.roundabout_exit_count, name: (m.street_names || [])[0] || '', ref: '', distance: m.length * 1000, duration: m.time, loc: shape[m.begin_shape_index] || shape[0], bearing_after: m.bearing_after, leg: li, last: li === trip.legs.length - 1 && type === 'arrive' });
      });
    });
    return { coords, distance: trip.summary.length * 1000, duration: trip.summary.time, steps, summary: steps.filter(s => s.name).sort((a, b) => b.distance - a.distance).slice(0, 1).map(s => s.name).join(', '), engine: 'Valhalla' };
  });
}
// ---------------- step clean-up (one list for the step list, the HUD and the voice) ----------------
// OSRM models squares like Bab Touma as short named segments: right after the start it emits "Turn right 30 m",
// "U-turn 75 m" and a roundabout that is announced twice (roundabout + "exit roundabout"). Rules:
//  1. start: within START_ZONE_M of the origin, a run of tiny steps (< TINY_M to the next maneuver) ending in a U-turn
//     (or steps that begin within TINY_M of the origin) is folded into the depart step (distance/duration added).
//     A tiny turn without a U-turn after it stays. If the depart segment itself was tiny, the depart takes the
//     direction and street of the folded steps (where you really drive off).
//     Roundabouts, ramps, forks, merges, ferries and arrivals are never folded.
//  2. everywhere: an 'exit roundabout'/'exit rotary' step directly after its roundabout is folded into it.
// U-turns and short steps later on the route stay untouched (they can be real).
export const TINY_M = 50, START_ZONE_M = 600;
const KEEP = /^(arrive|roundabout|rotary|roundabout turn|exit roundabout|exit rotary|on ramp|off ramp|fork|merge|ferry)$/;
const RBT = /^(roundabout|rotary)$/;
export function smoothSteps(steps) {
  if (!steps?.length) return steps;
  const out = [];
  let pos = 0; // distance from the origin to the start of the current step
  const depart = steps[0].type === 'depart' ? { ...steps[0] } : null, depart0 = depart?.distance ?? 0;
  let i = 0, folded = null;
  if (depart) {
    out.push(depart); pos = depart.distance; i = 1;
    // candidate run: tiny steps / U-turns right after the start; fold up to the last U-turn in it, or the steps that
    // begin within TINY_M of the origin (GPS-snap noise). A tiny turn that is NOT followed by a U-turn stays (real turn).
    let k = 0;
    for (let j = 1, p = pos; j < steps.length; j++) {
      const s = steps[j];
      if (KEEP.test(s.type) || s.leg !== depart.leg || p > START_ZONE_M) break;
      if (!(s.distance < TINY_M || s.modifier === 'uturn')) break;
      if (s.modifier === 'uturn' || p < TINY_M) k = j;
      p += s.distance;
    }
    for (; i <= k; i++) {
      const s = steps[i];
      depart.distance += s.distance; depart.duration = (depart.duration || 0) + (s.duration || 0); folded = s;
    }
    if (folded && depart0 < TINY_M) { depart.bearing_after = folded.bearing_after; depart.name = folded.name; depart.ref = folded.ref; }
  }
  for (; i < steps.length; i++) {
    const s = steps[i], prev = out[out.length - 1];
    if (/^exit (roundabout|rotary)$/.test(s.type) && prev && RBT.test(prev.type) && prev.leg === s.leg && (!s.exit || !prev.exit || s.exit === prev.exit)) {
      prev.distance += s.distance; prev.duration = (prev.duration || 0) + (s.duration || 0); if (!prev.exit) prev.exit = s.exit;
      if (!prev.name && s.name) { prev.name = s.name; prev.ref = s.ref; }
      continue;
    }
    out.push({ ...s });
  }
  return out;
}
export async function computeRoutes(stops, mode, opts) {
  let routes;
  try { routes = await osrm(stops, mode, opts); }
  catch (e) { console.warn('OSRM failed', e); toast(t('netErr')); routes = await valhalla(stops, mode, opts); }
  routes.forEach(r => { r.steps = smoothSteps(r.steps); });
  try {
    const foc = App.me || routes[0]?.coords?.[0];
    if (foc) setLandmarkFocus(foc);
    seedFromSyriaPois(P.all); harvestFromMap(App.map);
  } catch {}
  routes.forEach(r => enrichStepsWithLandmarks(r.steps, getLang()));
  return routes;
}

// ---------------- map layers (route layers live in the style, source 'khareeta-route') ----------------
const MODE = { car: 'drive', foot: 'walk', bike: 'bike', transit: 'walk' };
export function ensureRouteLayers() {
  const map = App.map; if (!map || !map.style) return;
  if (!map.getSource('khareeta-route')) { // raster fallback style: add a minimal route rendering
    map.addSource('khareeta-route', { type: 'geojson', data: fc(), lineMetrics: true });
    map.addLayer({ id: 'route-alt', type: 'line', source: 'khareeta-route', filter: ['==', ['get', 'role'], 'alt'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#A6C3EA', 'line-width': 6 } });
    map.addLayer({ id: 'route', type: 'line', source: 'khareeta-route', filter: ['==', ['get', 'role'], 'primary'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['==', ['get', 'traveled'], true], '#A3A9B3', '#1A73E8'], 'line-width': 7 } });
  }
  if (!map.getSource('measure')) map.addSource('measure', { type: 'geojson', data: fc([]) });
  const add = (l) => { if (!map.getLayer(l.id)) map.addLayer(l); };
  add({ id: 'measure-line', type: 'line', source: 'measure', paint: { 'line-color': '#1B1D21', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
  add({ id: 'measure-pts', type: 'circle', source: 'measure', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#1B1D21', 'circle-stroke-width': 2.5 } });
  drawRoutes();
}
const fc = (f = []) => ({ type: 'FeatureCollection', features: f });
const line = (coords, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
let bubbles = [];
function drawRoutes(along = null) {
  const src = App.map?.getSource('khareeta-route'); if (!src) return;
  const mode = MODE[R.mode] || 'drive';
  const feats = [];
  if (!R.active) R.routes.forEach((r, i) => { if (i !== R.sel) feats.push(line(r.coords, { role: 'alt', mode, traveled: false, i })); });
  const pr = R.routes[R.sel];
  if (pr) {
    if (along != null && N.cum) {
      // split at the current position: traveled part greyed out
      let k = N.cum.findIndex(c => c >= along); if (k < 1) k = 1;
      const a = pr.coords[k - 1], b = pr.coords[k], f = (along - N.cum[k - 1]) / ((N.cum[k] - N.cum[k - 1]) || 1);
      const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      feats.push(line([...pr.coords.slice(0, k), p], { role: 'primary', mode, traveled: true, i: R.sel }));
      feats.push(line([p, ...pr.coords.slice(k)], { role: 'primary', mode, traveled: false, i: R.sel }));
    } else feats.push(line(pr.coords, { role: 'primary', mode, traveled: false, i: R.sel }));
  }
  src.setData(fc(feats));
  if (along == null) drawBubbles();
}
function pointAt(coords, frac) {
  const cum = cumulative(coords), d = cum[cum.length - 1] * frac;
  let k = cum.findIndex(c => c >= d); if (k < 1) k = 1;
  const a = coords[k - 1], b = coords[k], f = (d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
function drawBubbles() {
  bubbles.forEach(m => m.remove()); bubbles = [];
  if (R.active || R.routes.length < 1 || !App.map) return;
  let pts = R.routes.map(r => pointAt(r.coords, 0.5));
  if (pts.length > 1) {
    const px = pts.map(p => App.map.project(p));
    const close = px.some((a, i) => px.some((b, j) => j > i && Math.hypot(a.x - b.x, a.y - b.y) < 80));
    if (close) pts = R.routes.map((r, i) => pointAt(r.coords, [0.4, 0.6, 0.3][i] ?? 0.5));
  }
  R.routes.forEach((r, i) => {
    const el = document.createElement('button');
    el.className = 'rbubble' + (i === R.sel ? ' on' : '');
    el.textContent = fmtDur(r.duration);
    el.onclick = ev => { ev.stopPropagation(); selectRoute(i); };
    bubbles.push(new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat(pts[i]).addTo(App.map));
  });
}
function selectRoute(i) { if (R.active || i === R.sel || !R.routes[i]) return; R.sel = i; drawRoutes(); renderPanel(); showRouteSheet(); }
export function clearRoutes() { R.routes = []; drawRoutes(); R.markers.forEach(m => m.remove()); R.markers = []; }

// ---------------- directions panel ----------------
function meStop() { return App.me ? { name: t('yourLocation'), lon: App.me[0], lat: App.me[1], isMe: true } : null; }
export function openDirections({ from, to, autostart } = {}) {
  import('./search.js').then(m => m.cancelCategory());
  setSelMarker(null); clearMarkers();
  R.stops = [from || meStop() || { name: '' }, to || { name: '' }];
  R.autostart = autostart; R.hintedStart = false;
  if (!R.mode || R.mode === 'transit') R.mode = 'car';
  $('#dirPanel').classList.remove('hidden'); document.body.classList.add('dir-open');
  $('#top').classList.add('hidden');
  // close the Saved panel *and* a place card – they used to cover the stop suggestions (QA P1-1)
  if ($('#sheet')?.dataset.state !== 'hidden') closeSheet();
  renderPanel();
  track('directions_open', {});
  if (!autostart) { const empty = R.stops.findIndex(s => s.lon == null); if (empty >= 0) $(`#dirStops input[data-i="${empty}"]`)?.focus({ preventScroll: true }); }
  route(); // after focusing the empty field, so the "choose start" hint knows the user is already there
}
export function closeDirections() {
  if (R.active) return;
  $('#dirPanel').classList.add('hidden'); document.body.classList.remove('dir-open'); $('#top').classList.remove('hidden');
  clearRoutes(); closeSheet();
}
function renderPanel() {
  const st = $('#dirStops');
  // keep focus + caret of the stop being edited: the panel is rebuilt after every pick / route (QA P1-2)
  const ae = document.activeElement, fi = ae && st.contains(ae) && ae.dataset.i != null ? ae.dataset.i : null;
  const caret = fi != null ? [ae.selectionStart, ae.selectionEnd] : null;
  $('#dirTitle').textContent = t('directions');
  st.innerHTML = R.stops.map((s, i) => `<div class="stop ${i === 0 ? 'first' : ''} ${i === R.stops.length - 1 ? 'last' : ''}"><span class="dot">${i === R.stops.length - 1 ? ic('pin', 'sm') : ''}</span><input data-i="${i}" dir="auto" class="${s.isMe ? 'me' : ''}" value="${esc(s.name || '')}" placeholder="${i === 0 ? t('chooseStart') : i === R.stops.length - 1 ? t('chooseDest') : t('stop', { n: i })}">${R.stops.length > 2 ? `<button class="ib" data-rm="${i}">${ic('close', 'sm')}</button>` : ''}</div>`).join('') + (R.stops.length < 6 ? `<button class="addstop" id="addStop">+ ${t('addStop')}</button>` : '');
  // No transit tab: there is no GTFS data for Syria (DESIGN §4.5)
  const modes = [['car', 'car'], ['foot', 'walk'], ['bike', 'bike']];
  $('#dirModes').innerHTML = modes.map(([m, icn]) => `<button class="mode ${R.mode === m ? 'on' : ''}" data-m="${m}" aria-label="${t(m)}" aria-pressed="${R.mode === m}">${ic(icn, 'sm')}<span>${R.routes.length && R.mode === m ? fmtDur(R.routes[R.sel]?.duration) : t(m)}</span></button>`).join('');
  st.querySelectorAll('input[data-i]').forEach(inp => { stopCb?.attach(inp); inp.addEventListener('focus', () => loadGazetteer().catch(() => {}), { once: true }); inp.setAttribute('aria-label', inp.placeholder); });
  if (fi != null) { const inp = st.querySelector(`input[data-i="${fi}"]`); if (inp) { restoring = true; inp.focus({ preventScroll: true }); restoring = false; try { inp.setSelectionRange(...caret); } catch {} } }
  document.documentElement.style.setProperty('--dirh', $('#dirPanel').offsetHeight + 'px');
}
let stopCb = null, restoring = false;
function initPanel() {
  $('#dirBack').innerHTML = ic('back', 'flip-rtl'); $('#dirSwap').innerHTML = ic('swap');
  $('#dirBack').onclick = closeDirections;
  $('#dirSwap').onclick = () => { R.stops.reverse(); renderPanel(); route(); };
  $('#dirModes').onclick = e => { const b = e.target.closest('.mode'); if (!b) return; R.mode = b.dataset.m; R.sel = 0; renderPanel(); route(); };
  $('#dirStops').addEventListener('click', e => {
    if (e.target.closest('#addStop')) { R.stops.splice(R.stops.length - 1, 0, { name: '' }); renderPanel(); $(`#dirStops input[data-i="${R.stops.length - 2}"]`).focus(); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { R.stops.splice(+rm.dataset.rm, 1); renderPanel(); route(); }
  });
  let activeInput = null, sugg = [], shownFor = null, sseq = 0, ctl = null;
  const box = $('#dirSuggest');
  const setOpen = on => { box.classList.toggle('hidden', !on); document.body.classList.toggle('sugg-open', on); };
  const doSearch = async (inp) => {
    const q = inp.value.trim(), c = center(), my = ++sseq;
    let res = [], offline = false;
    if (App.me) res.push({ name: t('yourLocation'), lon: App.me[0], lat: App.me[1], isMe: true, sub: '' });
    // empty field: saved places as quick picks; typing: the SAME pipeline as the main search (QA P2: Arabic stops)
    if (!q) lsGet('kh.saved', []).slice(0, 4).forEach(s => res.push({ ...s, name: s.label || s.name, saved: true }));
    if (cleanQuery(q).length >= 2) {
      ctl?.abort(); ctl = new AbortController();
      try {
        const r = await placeSuggest(q, { signal: ctl.signal }); offline = !!r.offline;
        const hits = r.items.filter(x => x.lon != null && x.lat != null && !x.chip).map(x => ({ ...x, name: x.name || x.sub, saved: x.saved || ['star', 'home', 'work'].includes(x.icon?.[0]) }));
        res = dedupe([...res, ...hits]).slice(0, 10);
      } catch (e) { if (e.name === 'AbortError' && my !== sseq) return; }
    }
    // the panel may have been rebuilt meanwhile (route finished): compare the stop index, not the element
    if (!activeInput || activeInput.dataset.i !== inp.dataset.i || my !== sseq) return;
    sugg = res; shownFor = activeInput.value.trim();
    box.innerHTML = (offline ? offlineNotice() : '') + res.map((r, i) => `<div class="srow" data-i="${i}"><div class="sic">${ic(r.isMe ? 'locate' : r.saved ? 'bookmark' : 'pinOutline')}</div><div class="st"><div class="t1" dir="auto">${esc(r.name)}</div><div class="t2" dir="auto">${esc(r.sub || '')}</div></div></div>`).join('');
    setOpen(res.length > 0 || offline); stopCb.refresh();
  };
  let stm = 0;
  const search = inp => { clearTimeout(stm); stm = setTimeout(() => doSearch(inp), 300); };
  const cancel = () => { clearTimeout(stm); sseq++; ctl?.abort(); };
  const pick = (i, viaKey) => {
    const s = sugg[i]; if (!s || !activeInput) return;
    cancel(); // a late answer must not reopen the list
    const idx = +activeInput.dataset.i;
    R.stops[idx] = { name: s.name, lon: s.lon, lat: s.lat, isMe: s.isMe };
    setOpen(false); stopCb.close();
    // keyboard: continue with the next empty stop, else stay in the field (Tab goes on); pointer: close the keyboard
    const next = viaKey ? R.stops.findIndex((x, j) => j !== idx && x.lon == null) : -1;
    if (!viaKey) activeInput.blur();
    renderPanel();
    if (next >= 0) $(`#dirStops input[data-i="${next}"]`)?.focus();
    route();
  };
  stopCb = combobox(document.createElement('input'), box, {
    label: t('directions'), input: () => activeInput,
    onPick: i => pick(i, true),
    flush: async () => { if (activeInput && (shownFor !== activeInput.value.trim() || box.classList.contains('hidden'))) await doSearch(activeInput); },
    onClose: () => setOpen(false),
  });
  $('#dirStops').addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' && e.target.dataset.i != null) { activeInput = e.target; stopCb.keydown(e); } });
  $('#dirStops').addEventListener('focusin', e => { if (e.target.tagName === 'INPUT') { if (restoring) { activeInput = e.target; return; } if (activeInput !== e.target) { activeInput = e.target; shownFor = null; cancel(); setOpen(false); box.innerHTML = ''; e.target.select(); } search(e.target); } });
  // typed text belongs to its own stop – never to another one, and survives re-renders (QA P1-2)
  $('#dirStops').addEventListener('input', e => {
    const inp = e.target; if (inp.tagName !== 'INPUT') return;
    R.stops[+inp.dataset.i] = { name: inp.value }; inp.classList.remove('me');
    search(inp);
  });
  $('#dirStops').addEventListener('focusout', () => setTimeout(() => {
    const ae = document.activeElement;
    if (ae && $('#dirStops').contains(ae) && ae.tagName === 'INPUT') return; // moved to another stop field
    cancel(); setOpen(false); stopCb.close(); activeInput = null;
  }, 200));
  box.addEventListener('pointerdown', e => e.preventDefault());
  box.addEventListener('click', e => { const r = e.target.closest('.srow[data-i]'); if (r) pick(+r.dataset.i, false); });
}

// "Choose starting point" toast (QA P2): only when a destination is set, the start is still empty, the start field is
// not being edited (its placeholder already says it) and at most once per directions session – no flashing while typing.
function hintStart() {
  const last = R.stops[R.stops.length - 1], start = $('#dirStops input[data-i="0"]');
  if (R.stops[0].lon != null || last?.lon == null || R.hintedStart || document.activeElement === start) return;
  R.hintedStart = true; toast(t('chooseStart'));
}
let routeSeq = 0;
async function route() {
  const ok = R.stops.filter(s => s.lon != null);
  const my = ++routeSeq;
  R.markers.forEach(m => m.remove()); R.markers = [];
  R.stops.forEach((s, i) => {
    if (s.lon == null || s.isMe) return;
    const last = i === R.stops.length - 1;
    const el = last ? pinEl('#E5484D') : Object.assign(document.createElement('div'), { className: 'mpt' });
    R.markers.push(new maplibregl.Marker({ element: el, anchor: last ? 'bottom' : 'center' }).setLngLat([s.lon, s.lat]).addTo(App.map));
  });
  if (ok.length < R.stops.length || ok.length < 2) { R.routes = []; drawRoutes(); hintStart(); return; }
  const mode = R.mode === 'transit' ? 'foot' : R.mode;
  openSheet(`<div style="padding:0 16px"><p class="psub">${t('routing')}</p><div class="skel-row"><div class="skel"></div></div><div class="skel" style="width:70%"></div></div>`, innerWidth < 900 ? 'peek' : 'half');
  try {
    const routes = await computeRoutes(R.stops, mode);
    if (my !== routeSeq) return;
    R.routes = routes; R.sel = 0;
    track('route', { mode: R.mode, stops: R.stops.length, km: Math.round(routes[0].distance / 1000) });
    ensureRouteLayers(); drawRoutes(); renderPanel(); showRouteSheet(); fitRoute();
    if (R.autostart) { R.autostart = false; startNav(); }
  } catch (e) {
    if (my !== routeSeq) return;
    R.routes = []; drawRoutes(); renderPanel();
    openSheet(`<div style="padding:0 16px"><p class="psub">${t('routeErr')}</p><div class="arow" style="margin-inline:0"><button class="abtn" id="rRetry">${ic('directions')}<span>${t('tryAgain')}</span></button></div></div>`, 'peek');
    $('#rRetry').onclick = route;
  }
}
function fitRoute() {
  const r = R.routes[R.sel]; if (!r) return;
  const b = new maplibregl.LngLatBounds(); R.routes.forEach(rt => rt.coords.forEach(c => b.extend(c)));
  const pad = mapPadding(), desk = innerWidth >= 900;
  const top = (desk ? 24 : $('#dirPanel').offsetHeight + 24) + 48; // + destination pin height
  let bottom = (desk ? 24 : Math.max(pad.bottom, App.routePeek || Math.max(360, innerHeight / 2)) + 72); // + map buttons above the sheet
  bottom = Math.max(24, Math.min(bottom, innerHeight - top - 140));
  fitTo(b, { top, bottom, left: pad.left + 36, right: pad.right + 36 }, { duration: 800, maxZoom: 17 });
}
function showRouteSheet() {
  const fastest = Math.min(...R.routes.map(r => r.duration)), shortest = Math.min(...R.routes.map(r => r.distance));
  const arrive = d => fmtTime(new Date(Date.now() + d * 1000));
  const r = R.routes[R.sel];
  const tag = rt => rt.duration === fastest ? `<div class="fast">${t('fastestRoute')}</div>` : rt.distance === shortest ? `<div class="fast" style="color:var(--k-text-2)">${t('shortest')}</div>` : '';
  const near = closuresNearRoute(r.coords, activeList());
  const warn = near.length ? `<div class="cl-warn" role="status">${ic('warning', 'sm')}<span>${esc(plural(getLang(), near.length, Object.fromEntries(['zero', 'one', 'two', 'few', 'many', 'other'].map(c => [c, t('clRW_' + c)]).filter(([c, v]) => v && v !== 'clRW_' + c))))}: ${[...new Set(near.map(c => t('clK_' + c.kind)))].map(esc).join(', ')}</span></div>` : '';
  const html = `${warn}
    ${R.routes.map((rt, i) => `<div class="rcard ${i === R.sel ? 'on' : ''}" data-i="${i}" role="button" aria-pressed="${i === R.sel}"><div style="flex:1;min-width:0"><div class="rt">${fmtDur(rt.duration)}</div><div class="rd">${fmtDist(rt.distance)}${rt.summary ? ' · ' + t('via', { r: '<bdi>' + esc(rt.summary) + '</bdi>' }) : ''} · ${t('eta')} ${arrive(rt.duration)}</div>${tag(rt)}</div><button class="gobtn" data-go="${i}">${t('go')}</button></div>`).join('')}
    <div class="ochips"><button class="ochip" id="rShare">${ic('share', 'xs')}${t('share_route')}</button>${navDev() ? `<button class="ochip" id="rSim">${ic('navigation', 'xs')}${t('simulate')}</button>` : ''}<button class="ochip" id="rSteps">${ic('directions', 'xs')}${t('steps')}</button></div>
    <h3 class="sect-title" id="stepsTitle">${t('steps')}</h3>
    <div class="steps list">${r.steps.map((s, i) => `<div class="srow" data-s="${i}"><div class="sic">${ic(stepIcon(s))}</div><div class="st"><div class="t1" style="white-space:normal" dir="auto">${esc(instr(s))}</div><div class="t2">${s.distance > 0 && s.type !== 'arrive' ? fmtDist(s.distance) : ''}</div></div></div>`).join('')}</div>
    <div class="dfoot">${r.engine === 'OSRM' ? 'Routing: OSRM · FOSSGIS (routing.openstreetmap.de)' : 'Routing: Valhalla · FOSSGIS (valhalla1.openstreetmap.de)'} · © OpenStreetMap contributors</div>`;
  const desk = innerWidth >= 900;
  const body = openSheet(html, desk ? 'half' : 'peek');
  // phones (QA P2, iPhone 393×852): the half sheet + directions panel left ~120 px of map. Open the route sheet only
  // as high as the route card(s) + chips; the steps are one swipe / the "Steps" chip away.
  App.routePeek = 0;
  if (!desk) {
    const sh = $('#sheet'), st = $('#stepsTitle');
    const h = Math.round(st.getBoundingClientRect().top - sh.getBoundingClientRect().top + 4);
    if (h > 120) { App.routePeek = Math.min(h, Math.round(innerHeight * 0.45)); App.peekH = App.routePeek; setSheet('peek'); }
  }
  body.onclick = e => {
    const go = e.target.closest('[data-go]'); if (go) { const i = +go.dataset.go; if (i !== R.sel) { R.sel = i; drawRoutes(); } return startNav(); }
    const c = e.target.closest('.rcard'); if (c) { selectRoute(+c.dataset.i); return; }
    if (e.target.closest('#rSim')) return startNav(true);
    if (e.target.closest('#rShare')) return shareRoute();
    if (e.target.closest('#rSteps')) { setSheet('full'); setTimeout(() => $('#stepsTitle')?.scrollIntoView({ behavior: 'smooth' }), 350); return; }
    const s = e.target.closest('[data-s]'); if (s) { const st = r.steps[+s.dataset.s]; App.map.flyTo({ center: st.loc, zoom: 17, duration: 600, padding: mapPadding() }); }
  };
  App.onSheetDismiss = () => setSheet('peek');
}
async function shareRoute() {
  const u = new URL(location.href.split('#')[0].split('?')[0]);
  u.searchParams.set('r', R.stops.map(s => s.lat.toFixed(5) + ',' + s.lon.toFixed(5)).join(';'));
  u.searchParams.set('m', R.mode);
  const { share } = await import('./place.js');
  share(t('route'), u.toString());
}
export function routeFromUrl(stops, mode) { R.mode = ['car', 'foot', 'bike'].includes(mode) ? mode : 'car'; openDirections({ from: stops[0], to: stops[stops.length - 1] }); R.stops = stops; renderPanel(); route(); }

// map click on alternative route
export function initRouteMapEvents() {
  initPanel();
  App.map.on('click', e => {
    if (R.active || !R.routes.length) return;
    const p = e.point, layers = ['route-alt', 'route-alt-casing'].filter(l => App.map.getLayer(l));
    const f = App.map.queryRenderedFeatures([[p.x - 12, p.y - 12], [p.x + 12, p.y + 12]], { layers })[0];
    if (f && f.properties.i != null) selectRoute(+f.properties.i);
  });
}

// ---------------- live navigation ----------------
const N = { startSeq: 0, compass: null, compassT: 0, prev: null, watch: null, sim: null, cum: null, stepIdx: 0, off: 0, lastReroute: 0, follow: true, spoken: {}, marker: null, pos: null, speed: 0, hdg: 0, moved: false, anchor: null };
// Navigation start (P2): until the user has really moved (≥ MOVE_M from the first accurate fix) the HUD stays on the
// depart step ("Head east on …"), no maneuver/U-turn is announced and off-route/rerouting is off. Fixes with an
// accuracy worse than ACC_OK m only move the puck – they never advance steps, speak or count as off-route.
export const NAV_ACC_OK = 30, NAV_MOVE_M = 25;
export function navActive() { return R.active; }
// voice output lives in js/voice.js (on-device voices only, voice choice, dedupe, no-voice toast)
function speak(text) { if (settings.voice) voiceSpeak(text); }
function navArrowEl() {
  const d = document.createElement('div');
  d.innerHTML = `<svg class="navarrow" viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="21.5" fill="var(--k-puck)" stroke="#fff" stroke-width="3"/><path d="M24 11l9.5 23L24 29l-9.5 5z" fill="#fff"/></svg>`;
  return d.firstChild;
}
const NAV_HIDE = ['label-housenumber'];
function setNavLayers(hide) { for (const id of NAV_HIDE) if (App.map.getLayer(id)) App.map.setLayoutProperty(id, 'visibility', hide ? 'none' : 'visible'); setPoiVisible(App.map, !hide); }
// Simulation only for tests / developers: ?dev=1 or localStorage kh.dev = '1'
export function navDev() { try { return /[?&]dev=1(&|$)/.test(location.search) || localStorage.getItem('kh.dev') === '1'; } catch { return false; } }
// P1: navigation always starts at the user's GPS position. The position (and on iOS the compass) is requested
// synchronously inside the tap on "Go" (iOS Safari / PWA only prompt after a user gesture). Denied / unavailable /
// timeout → a clear message, no navigation from a wrong position.
export const NAV_GEO_OPTS = { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 };
export function startNav(sim = false) {
  if (settings.voice !== false) unlockSpeech(); // must run synchronously inside the tap on "Go" (iOS Safari)
  const r = R.routes[R.sel]; if (!r) return;
  if (sim && navDev()) return beginNav(r, true, null);
  if (!('geolocation' in navigator)) return navLocNeeded();
  requestCompass();
  const seq = ++N.startSeq; toast(t('locating'), 2500);
  navigator.geolocation.getCurrentPosition(p => { if (seq === N.startSeq && !R.active) beginNav(r, false, p.coords); },
    () => { if (seq === N.startSeq) navLocNeeded(); }, NAV_GEO_OPTS);
}
function navLocNeeded() { track('nav_loc_needed', {}); toast(t('navLocNeeded'), 7000); }
// compass for walking slowly / standing: webkitCompassHeading (iOS, permission inside the tap) or absolute alpha
function onOrient(e) {
  const h = e.webkitCompassHeading != null ? e.webkitCompassHeading : (e.absolute && e.alpha != null ? (360 - e.alpha) % 360 : null);
  if (h != null && !isNaN(h)) { N.compass = h; N.compassT = Date.now(); }
}
function requestCompass() {
  const D = globalThis.DeviceOrientationEvent; if (!D) return;
  const on = () => { removeEventListener('deviceorientationabsolute', onOrient); removeEventListener('deviceorientation', onOrient); addEventListener('ondeviceorientationabsolute' in globalThis ? 'deviceorientationabsolute' : 'deviceorientation', onOrient); };
  try { if (typeof D.requestPermission === 'function') D.requestPermission().then(st => { if (st === 'granted') on(); }).catch(() => {}); else on(); } catch {}
}
// heading: GPS course when moving, else compass (fresh), else the bearing between the last positions, else the route
export function navHeading({ heading, speed, compass, compassAge, prev, p, routeBearing, last }) {
  if (heading != null && !isNaN(heading) && speed > 1) return heading;
  if (compass != null && compassAge < 3000) return compass;
  if (prev && haversine(prev, p) >= 4) return bearing(prev, p);
  return routeBearing ?? last ?? 0;
}
function beginNav(r, sim, coords) {
  const start = coords ? [coords.longitude, coords.latitude] : r.coords[0];
  R.active = true; App.navMode = true; document.body.classList.add('nav'); N.cum = cumulative(r.coords); N.stepIdx = 0; N.off = 0; N.spoken = {}; N.follow = true; N.arrived = false; N.rerouting = false; N.moved = false; N.anchor = null; N.isSim = !!sim || !('geolocation' in navigator); N.pos = null; N.prev = null; N.lastDist = null; N.lastRemain = null; N._lmIdx = -1; r._stepAlong = null;
  try {
    if (start) setLandmarkFocus(start);
    seedFromSyriaPois(P.all); harvestFromMap(App.map); enrichStepsWithLandmarks(r.steps, getLang());
  } catch {}
  track('nav_start', { mode: R.mode, sim: N.isSim });
  $('#dirPanel').classList.add('hidden'); closeSheet();
  $('#navHud').classList.remove('hidden');
  App.meMarker?.getElement().classList.add('hidden');
  R.markers.forEach(m => m.getElement().classList.add('hidden'));
  drawRoutes(0); setNavLayers(true);
  N.marker = new maplibregl.Marker({ element: navArrowEl(), rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(start).addTo(App.map);
  wake();
  for (const ev of USER_MOVE) App.map.on(ev, onDrag);
  navVoiceStart(); // the single start prompt comes from navPrompt() on the first fix, in the chosen spoken variant
  if (sim || !('geolocation' in navigator)) simulate(r);
  else N.watch = navigator.geolocation.watchPosition(p => onPos([p.coords.longitude, p.coords.latitude], p.coords.heading, p.coords.speed, p.coords.accuracy), () => toast(t('locErr')), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  // camera on the user's position (follow mode), facing along the route from the nearest point – never the destination/overview
  const near = nearestOnLine(start, r.coords, N.cum), rb = near.idx < r.coords.length - 1 ? bearing(r.coords[near.idx], r.coords[near.idx + 1]) : 0;
  N.hdg = coords ? navHeading({ heading: coords.heading, speed: coords.speed, compass: N.compass, compassAge: Date.now() - (N.compassT || 0), routeBearing: rb }) : bearing(r.coords[0], r.coords[Math.min(3, r.coords.length - 1)]);
  App.map.easeTo({ center: start, pitch: 58, zoom: camZoom(coords?.speed || 0), bearing: N.hdg, padding: { top: innerHeight * 0.5, bottom: 0, left: 0, right: 0 }, duration: 900 });
  renderHud(start);
  if (coords) setTimeout(() => { if (R.active && !N.pos) onPos(start, coords.heading, coords.speed, coords.accuracy); }, 950);
}
function wake() { try { navigator.wakeLock?.request('screen').then(l => N.wake = l).catch(() => {}); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && R.active && (!N.wake || N.wake.released)) wake(); });
let recT = null;
// a pan / pinch / rotate by hand stops follow mode until "Re-center" is tapped (programmatic easeTo has no originalEvent)
const USER_MOVE = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'];
function onDrag(e) { if (e && e.type !== 'dragstart' && !e.originalEvent) return; if (!N.follow) return; N.follow = false; renderHud(N.pos, N.lastDist, N.lastRemain); }
export const navState = () => ({ follow: N.follow, hdg: N.hdg, pos: N.pos, isSim: N.isSim, active: R.active });
function simulate(r) {
  let d = 0; const speed = R.mode === 'car' ? 22 : R.mode === 'bike' ? 6 : 1.6;
  const total = N.cum[N.cum.length - 1];
  const tick = () => {
    if (!R.active) return;
    d = Math.min(total, d + speed * (R.mode === 'car' ? 2 : 3));
    let i = N.cum.findIndex(c => c >= d); if (i <= 0) i = 1;
    const a = r.coords[i - 1], b = r.coords[i], f = (d - N.cum[i - 1]) / ((N.cum[i] - N.cum[i - 1]) || 1);
    const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    onPos(p, bearing(a, b), speed, 5);
    if (d < total) N.sim = setTimeout(tick, 1000);
  };
  N.sim = setTimeout(tick, 600);
}
// Predictive camera/arrow (P3): the arrow and camera ease linearly for 1 s towards each fix, so without a lead they sit
// one fix interval (≈ speed × 1 s, 16–19 m at 60–70 km/h) behind the real position. Dead-reckon the target ahead along the
// heading by speed × NAV_LEAD_S (capped, only when moving steadily) – the animation then tracks the true position. The lead
// changes only with speed/heading (both smoothed), so the camera does not jump. Self-contained (unit-tested by source).
export function navLead(p, hdg, speed, { lead = 0.9, max = 25, minSpeed = 2.5 } = {}) {
  if (!p || hdg == null || !(speed >= minSpeed)) return p;
  const d = Math.min(max, speed * lead), R = 6371008.8, br = hdg * Math.PI / 180, la = p[1] * Math.PI / 180;
  return [p[0] + (d * Math.sin(br) / (R * Math.cos(la))) * 180 / Math.PI, p[1] + (d * Math.cos(br) / R) * 180 / Math.PI];
}
function camZoom(speed) { if (R.mode !== 'car') return 18; const kmh = (speed || 0) * 3.6; return kmh > 80 ? 15 : kmh >= 50 ? 16 : 17; }
// 1 s linear interpolation of the arrow (§3.7); jumps > 100 m snap
let interp = 0;
function moveArrow(to, hdg) {
  const m = N.marker; if (!m) return;
  const from = m.getLngLat().toArray();
  cancelAnimationFrame(interp);
  if (haversine(from, to) > 100 || matchMedia('(prefers-reduced-motion: reduce)').matches) { m.setLngLat(to).setRotation(hdg); return; }
  const h0 = m.getRotation(), dh = ((hdg - h0 + 540) % 360) - 180, t0 = performance.now();
  const step = now => { const f = Math.min(1, (now - t0) / 1000); m.setLngLat([from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f]).setRotation(h0 + dh * f); if (f < 1) interp = requestAnimationFrame(step); };
  interp = requestAnimationFrame(step);
}
function onPos(p, heading, speed, acc) {
  const r = R.routes[R.sel]; if (!r || !R.active) return;
  N.pos = p; App.me = p; N.speed = speed;
  const good = acc == null || acc <= NAV_ACC_OK;
  if (good && !N.moved) { if (!N.anchor) N.anchor = p; else if (haversine(N.anchor, p) >= NAV_MOVE_M) N.moved = true; }
  const near = nearestOnLine(p, r.coords, N.cum);
  const hdg = navHeading({ heading, speed, compass: N.compass, compassAge: Date.now() - (N.compassT || 0), prev: N.prev, p, routeBearing: near.idx < r.coords.length - 1 ? bearing(r.coords[near.idx], r.coords[near.idx + 1]) : null, last: N.hdg });
  N.hdg = hdg; if (!N.prev || haversine(N.prev, p) >= 4) N.prev = p;
  const shown = navLead(near.dist < 30 ? near.point : p, hdg, good && N.moved ? speed : 0);
  moveArrow(shown, hdg);
  // off-route: > 40 m for 3 fixes in a row (§4.6)
  const lim = 40;
  if (!r._stepAlong) r._stepAlong = r.steps.map(s => nearestOnLine(s.loc, r.coords, N.cum).along);
  if (!good || !N.moved) {
    // inaccurate fix or not moved yet: puck/camera only; HUD keeps the depart step (or the current step)
    if (!N.moved) { N.stepIdx = 0; N.off = 0; N.lastDist = r._stepAlong[1] ?? r.distance; N.lastRemain = N.cum[N.cum.length - 1]; } // depart: distance until the first maneuver
    if (N.follow) App.map.easeTo({ center: shown, bearing: hdg, pitch: 58, zoom: camZoom(speed), duration: 1000, easing: x => x, padding: { top: innerHeight * 0.5, bottom: 0, left: 0, right: 0 } });
    renderHud(p, N.lastDist, N.lastRemain);
    return;
  }
  if (near.dist > Math.max(lim, (acc || 0) * 1.2)) N.off++; else N.off = 0;
  if (N.off >= 3 && Date.now() - N.lastReroute > 10000) { N.lastReroute = Date.now(); N.off = 0; reroute(p); }
  const along = near.along;
  let idx = r._stepAlong.findIndex(a => a > along + 5); if (idx < 0) idx = r.steps.length - 1;
  N.stepIdx = idx;
  const step = r.steps[idx], distTo = r._stepAlong[idx] - along;
  // refresh local landmark index from already-loaded tiles/POIs (no network); re-attach if this step has none yet
  if (!step.landmark && (idx !== N._lmIdx)) {
    try { if (p) setLandmarkFocus(p); harvestFromMap(App.map); enrichStepsWithLandmarks(r.steps, getLang()); } catch {}
    N._lmIdx = idx;
  }
  // voice: start prompt, early prompt (car ≈ 13 s ahead = 300–700 m; walk 30 m), "now", close maneuvers chained – see voice.js
  navPrompt(r, idx, distTo, R.mode, speed, instr, N.spoken);
  const remain = N.cum[N.cum.length - 1] - along;
  drawRoutes(along);
  if (remain < 25 && !N.arrived) { N.arrived = true; speak(arriveText(r.steps[r.steps.length - 1])); track('nav_arrive', { mode: R.mode, sim: !!N.isSim }); setTimeout(() => { if (R.active && N.arrived) stopNav(); }, 8000); }
  if (N.follow) App.map.easeTo({ center: shown, bearing: hdg, pitch: 58, zoom: camZoom(speed), duration: 1000, easing: x => x, padding: { top: innerHeight * 0.5, bottom: 0, left: 0, right: 0 } });
  N.lastDist = distTo; N.lastRemain = remain;
  renderHud(p, distTo, remain);
}
async function reroute(p) {
  N.rerouting = true; renderHud(N.pos, N.lastDist, N.lastRemain);
  if (settings.voice) voiceSpeak(reroutingText(), { interrupt: true });
  track('reroute', { mode: R.mode, sim: !!N.isSim });
  const remainingStops = R.stops.slice(1).filter((s, i) => { const d = haversine(p, [s.lon, s.lat]); return i === R.stops.length - 2 || d > 50; });
  try {
    const routes = await computeRoutes([{ lon: p[0], lat: p[1] }, ...remainingStops], R.mode, { heading: N.speed > 2 && N.hdg != null ? N.hdg : null });
    R.routes = [routes[0]]; R.sel = 0; N.cum = cumulative(routes[0].coords); N.spoken = {}; N.stepIdx = 0; N.lastDist = null; N.lastRemain = null;
    drawRoutes(0);
  } catch { }
  N.rerouting = false;
}
const LANE_IC = { left: 'turnLeft', 'sharp left': 'turnLeft', 'slight left': 'slightLeft', straight: 'straight', 'slight right': 'slightRight', right: 'turnRight', 'sharp right': 'turnRight', uturn: 'uturn', none: 'straight' };
function renderHud(p, distTo, remain) {
  const r = R.routes[R.sel]; if (!r) return;
  const step = r.steps[N.stepIdx] || r.steps[0], next = r.steps[N.stepIdx + 1];
  if (distTo == null) distTo = step.distance; if (remain == null) remain = r.distance;
  const frac = remain / (r.distance || 1); const tleft = r.duration * frac;
  const banner = $('#navBanner');
  banner.classList.toggle('reroute', !!N.rerouting);
  if (N.arrived) {
    banner.innerHTML = `<div class="nav-main">${ic('flag')}<div style="flex:1;min-width:0"><div class="nt" dir="auto">${t('arrive')}</div><div class="nd" style="font-size:20px" dir="auto">${esc(R.stops[R.stops.length - 1]?.name || '')}</div></div></div>`;
  } else if (N.rerouting) {
    banner.innerHTML = `<div class="nav-main">${ic('directions')}<div style="flex:1"><div class="nt">${t('rerouting')}</div><div class="nprog"><i></i></div></div></div>`;
  } else {
    const lanes = step.lanes && step.lanes.length > 1 && distTo < 1000 ? `<div class="lanes" aria-hidden="true">${step.lanes.map(l => `<span class="lane ${l.valid ? 'v' : ''}">${ic(LANE_IC[(l.indications || ['straight'])[0]] || 'straight')}</span>`).join('')}</div>` : '';
    banner.innerHTML = `<div class="nav-main">${ic(stepIcon(step))}<div style="flex:1;min-width:0"><div class="nd">${fmtDist(Math.max(0, distTo))}</div><div class="nt" dir="auto">${esc(instr(step))}</div></div></div>${lanes}`;
  }
  banner.setAttribute('aria-label', fmtDist(Math.max(0, distTo)) + ', ' + instr(step));
  const thenEl = $('#navThen');
  const showThen = next && !N.arrived && !N.rerouting && step.type !== 'arrive' && !(next.modifier === 'uturn' && !N.moved) && (r._stepAlong ? r._stepAlong[N.stepIdx + 1] - r._stepAlong[N.stepIdx] : next.distance) < 300;
  thenEl.classList.toggle('hidden', !showThen);
  if (showThen) { thenEl.innerHTML = `${t('then')} ${ic(stepIcon(next))}`; thenEl.style.top = (banner.offsetTop + banner.offsetHeight - 2) + 'px'; }
  const arr = fmtTime(new Date(Date.now() + tleft * 1000));
  const mins = Math.max(1, Math.round(tleft / 60));
  if (N.arrived) $('#navBottom').innerHTML = `<button class="endbtn done" id="navStop" style="flex:1;background:var(--k-accent);color:var(--k-text-on-accent)">${t('done')}</button>`;
  else $('#navBottom').innerHTML = `<div class="m arr"><b>${arr}</b><small>${t('arrival')}</small></div>
    <div class="m"><b>${mins >= 60 ? digits(Math.floor(mins / 60) + ':' + String(mins % 60).padStart(2, '0')) : nf(mins)}</b><small>${mins >= 60 ? t('h') : t('min')}</small></div>
    <div class="m"><b>${nf(remain < 10000 ? Math.round(remain / 100) / 10 : Math.round(remain / 1000), { maximumFractionDigits: 1 })}</b><small>${t('km')}</small></div>
    <button class="endbtn" id="navStop">${t('navEnd')}</button>`;
  $('#navStop').onclick = stopNav;
  voiceBtn();
  const rc = $('#navRecenter');
  rc.classList.toggle('hidden', N.follow);
  rc.innerHTML = `${ic('navigation')}<span>${t('recenter')}</span>`;
  rc.setAttribute('aria-label', t('recenter'));
  rc.onclick = () => { N.follow = true; clearTimeout(recT); if (N.pos) onPos(N.pos, N.hdg, N.speed || 0, 5); else renderHud(); };
}
// floating speaker button (Apple-Maps style, DESIGN §4.8 map controls): tap = mute / unmute; unmuting plays a test announcement
function voiceBtn() {
  const b = $('#navVoice'); if (!b) return;
  const on = settings.voice !== false;
  b.innerHTML = ic(on ? 'volume' : 'volumeOff');
  b.classList.toggle('off', !on);
  b.setAttribute('aria-pressed', String(!on));
  b.setAttribute('aria-label', t(on ? 'vMute' : 'vUnmute'));
  b.title = t(on ? 'vMute' : 'vUnmute');
}
document.addEventListener('click', e => {
  if (!e.target.closest?.('#navVoice')) return;
  settings.voice = settings.voice === false; saveSettings(); // persisted in localStorage (kh.settings)
  if (settings.voice) { unlockSpeech(); voiceSpeak(sampleText(), { force: true }); toast(isIOS() ? t('vOnT') + ' · ' + t('vIosSilent') : t('vOnT'), isIOS() ? 5000 : 1800); }
  else { stopSpeaking(); toast(t('vOffT'), 1800); }
  voiceBtn();
});
export function stopNav() {
  R.active = false; App.navMode = false; document.body.classList.remove('nav');
  if (N.watch != null) navigator.geolocation.clearWatch(N.watch); N.watch = null; clearTimeout(N.sim); clearTimeout(recT); cancelAnimationFrame(interp);
  N.marker?.remove(); N.marker = null; N.wake?.release?.(); N.wake = null; N.arrived = false;
  stopSpeaking({ reset: true });
  for (const ev of USER_MOVE) App.map.off(ev, onDrag);
  removeEventListener('deviceorientationabsolute', onOrient); removeEventListener('deviceorientation', onOrient); N.compass = null;
  App.meMarker?.getElement().classList.remove('hidden');
  R.markers.forEach(m => m.getElement().classList.remove('hidden'));
  setNavLayers(false);
  $('#navHud').classList.add('hidden'); $('#navThen').classList.add('hidden'); $('#navRecenter').classList.add('hidden');
  $('#dirPanel').classList.remove('hidden');
  drawRoutes();
  App.map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
  showRouteSheet(); setTimeout(fitRoute, 520);
}
