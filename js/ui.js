// Drawer menu, settings, layers popup, measure tool, about/credits
import { $, esc, settings, saveSettings, lsGet, lsSet, toast, fmtDist, haversine, VERSION } from './util.js';
import { t, LANGS, getLang, setLang } from './i18n.js';
import { ic } from './icons.js';
import { App, openSheet, closeSheet } from './core.js';
import { getTheme, setTheme } from './mapstyle.js';
import { openOfflinePanel } from './offline.js';
import { openPlace } from './place.js';
import { track } from './analytics.js';
import { openReport } from './report.js';
import { openHealthSheet } from './health.js';
import { voiceRowsHtml, bindVoiceRows, stopSpeaking } from './voice.js';

export const hooks = { overture: null, restyle: null, transit: null, relabel: null, rerenderUI: null, set3d: null };

// ---------- brand lockup (light/dark variant switched in CSS via the theme tokens) ----------
const brandLogo = cls => `<span class="klogo ${cls}" role="img" aria-label="Khareeta · خريطة"><img class="klogo-l" src="icons/logo-lockup.svg" alt="" width="964" height="208" decoding="async"><img class="klogo-d" src="icons/logo-lockup-dark.svg" alt="" width="964" height="208" decoding="async"></span>`;

// ---------- drawer ----------
const sw = on => `<span class="sw ${on ? 'on' : ''}" aria-hidden="true"></span>`;
const seg = (id, opts, cur) => `<div class="seg" id="${id}" role="radiogroup">${opts.map(([k, n]) => `<button data-v="${k}" role="radio" aria-checked="${cur === k}" class="${cur === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
const appearance = () => seg('dTheme', [['system', t('system')], ['light', t('light')], ['dark', t('dark')]], getTheme());
export function openDrawer() {
  const d = $('#drawer');
  d.innerHTML = `
    <div class="dbrand">${brandLogo('dlogo')}<button class="ib" id="dClose" style="margin-inline-start:auto" aria-label="${t('close')}">${ic('close')}</button></div>
    <h2 class="dtitle">${t('settings')}</h2>
    <div class="dlabel">${t('language').toUpperCase()}</div>
    <div class="dgroup" id="dLang">${LANGS.map(([k, n]) => `<button class="ditem" data-l="${k}" lang="${k}" role="radio" aria-checked="${getLang() === k}"><span dir="auto">${n}</span>${getLang() === k ? `<span class="ck">${ic('check')}</span>` : ''}</button>`).join('')}</div>
    <div class="dlabel">${t('mapHdr').toUpperCase()}</div>
    <div class="dgroup">
      <div class="ditem" style="display:block;padding:8px 0"><div style="padding:0 16px 2px;font-size:13px;color:var(--k-text-2)">${t('appearance')}</div>${appearance()}</div>
      <div class="ditem" style="display:block;padding:8px 0"><div style="padding:0 16px 2px;font-size:13px;color:var(--k-text-2)">${t('mapLang')}</div>${seg('dMapLang', [['auto', t('mapLangAuto')], ['ar', 'عربي'], ['en', 'EN'], ['de', 'DE']], String(settings.mapLang).replace('_both', ''))}</div>
      <button class="ditem" data-a="bilingual">${ic('translate')}${t('bilingual')}${sw(settings.bilingual !== false)}</button>
      ${getLang() === 'ar' ? `<button class="ditem" data-a="arabicDigits">${ic('plusCode')}${t('arabicDigits')}${sw(settings.arabicDigits)}</button>` : ''}
    </div>
    <div class="dlabel">${t('navHdr').toUpperCase()}</div>
    <div class="dgroup">
      <button class="ditem" data-a="voice">${ic('volume')}${t('voice')}${sw(settings.voice)}</button>
      ${voiceRowsHtml(ic)}
    </div>
    <div class="dlabel">${t('more').toUpperCase()}</div>
    <div class="dgroup">
      <button class="ditem" data-a="health">${ic('hospital')}${t('emDrawer')}<span class="dv">${ic('chevron', 'sm flip-rtl')}</span></button>
      <button class="ditem" data-a="saved">${ic('bookmark')}${t('savedPlaces')}<span class="dv">${ic('chevron', 'sm flip-rtl')}</span></button>
      <button class="ditem" data-a="offline">${ic('download')}${t('offlineMaps')}<span class="dv">${ic('chevron', 'sm flip-rtl')}</span></button>
      <button class="ditem" data-a="report">${ic('plus')}${t('rpMissingMenu')}</button>
      <button class="ditem" data-a="shareLoc">${ic('share')}${t('shareMyLoc')}</button>
      <button class="ditem" data-a="measure">${ic('ruler')}${t('measure')}</button>
      <button class="ditem" data-a="install" id="dInstall">${ic('download')}${t('install')}</button>
      <button class="ditem" data-a="lowData">${ic('data')}${t('lowData')}${sw(settings.lowData)}</button>
      <button class="ditem" data-a="stats">${ic('info')}${t('stats')}${sw(localStorage.getItem('kh.noTrack') !== '1')}</button>
      <button class="ditem" data-a="about">${ic('info')}${t('about')}<span class="dv">${ic('chevron', 'sm flip-rtl')}</span></button>
    </div>
    <div class="dfoot">Khareeta v${VERSION}<br><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">${t('osmAttr')}</a> · OpenFreeMap · OpenMapTiles</div>`;
  d.setAttribute('aria-label', t('settings'));
  bindVoiceRows(d, () => { const y = d.scrollTop; openDrawer(); d.scrollTop = y; });
  d.classList.add('open'); $('#scrim').classList.remove('hidden');
  if (!App.installPrompt && !/iphone|ipad/i.test(navigator.userAgent)) $('#dInstall').classList.add('hidden');
  if (matchMedia('(display-mode: standalone)').matches) $('#dInstall').classList.add('hidden');
}
export function closeDrawer() { $('#drawer').classList.remove('open'); $('#scrim').classList.add('hidden'); }
function applyTheme(v) { setTheme(v); hooks.restyle(); }
export function initDrawer() {
  $('#scrim').onclick = () => { closeDrawer(); $('#layersPop').classList.add('hidden'); $('#scrim').classList.add('hidden'); };
  $('#drawer').addEventListener('click', e => {
    if (e.target.closest('#dClose')) { closeDrawer(); return; }
    const l = e.target.closest('#dLang [data-l]');
    if (l) { const from = getLang(); if (from === l.dataset.l) return; setLang(l.dataset.l); stopSpeaking(); track('lang_change', { from, to: l.dataset.l }); hooks.rerenderUI(); hooks.relabel(); openDrawer(); return; }
    const th = e.target.closest('#dTheme [data-v]');
    if (th) { applyTheme(th.dataset.v); openDrawer(); return; }
    const ml = e.target.closest('#dMapLang [data-v]');
    if (ml) { settings.mapLang = ml.dataset.v; saveSettings(); hooks.relabel(); openDrawer(); return; }
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'stats') { localStorage.setItem('kh.noTrack', localStorage.getItem('kh.noTrack') === '1' ? '0' : '1'); openDrawer(); return; }
    if (a === 'bilingual') { settings.bilingual = settings.bilingual === false; saveSettings(); hooks.relabel(); openDrawer(); return; }
    if (['lowData', 'voice', 'arabicDigits'].includes(a)) {
      settings[a] = !settings[a]; saveSettings();
      if (a === 'lowData') hooks.restyle();
      if (a === 'voice' && !settings.voice) stopSpeaking();
      if (a === 'arabicDigits') hooks.rerenderUI();
      openDrawer(); return;
    }
    closeDrawer();
    if (a === 'health') openHealthSheet();
    if (a === 'saved') showSaved();
    if (a === 'offline') openOfflinePanel();
    if (a === 'measure') startMeasure();
    if (a === 'shareLoc') import('./whats-here.js').then(m => m.shareMyLocation());
    if (a === 'report') { closeDrawer(); openReport(null, 'missing'); return; }
    if (a === 'about') showAbout();
    if (a === 'install') install();
  });
}
async function install() {
  if (App.installPrompt) { track('install', { stage: 'prompt_shown' }); App.installPrompt.prompt(); const r = await App.installPrompt.userChoice; track('install', { stage: r.outcome === 'accepted' ? 'accepted' : 'dismissed' }); App.installPrompt = null; return; }
  toast(getLang() === 'ar' ? 'في Safari: مشاركة ← إضافة إلى الشاشة الرئيسية' : getLang() === 'de' ? 'In Safari: Teilen → Zum Home-Bildschirm' : 'In Safari: Share → Add to Home Screen', 5000);
}

export { showSaved } from './saved.js';

function showAbout() {
  openSheet(`<div class="sec about-brand">${brandLogo('alogo')}<h2 class="sr-only">Khareeta · خريطة</h2><p class="psub">v${VERSION}</p></div>
  <div class="prow">${ic('info')}<div class="pv wiki">${t('aboutText')}</div></div>
  <div class="prow">${ic('map')}<div class="pv"><b>${t('sources')}</b><small>
  ${t('cMapData')} © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">${t('cOsm')}</a> (ODbL)<br>${t('cPlaces', { g: '<a href="https://download.geofabrik.de/asia/syria.html" target="_blank" rel="noopener">Geofabrik</a>', d: '<bdi>2026-10-31</bdi>' })} (ODbL)<br>${t('cPlacesWorld')} (ODbL)<br>${t('cOverture')}: <a href="https://overturemaps.org" target="_blank" rel="noopener">© Overture Maps Foundation</a> (<a href="https://cdla.dev/permissive-2-0/" target="_blank" rel="noopener">CDLA-Permissive-2.0</a>) · <a href="./data/overture/LICENSE.txt" target="_blank" rel="noopener">${t('ovLicense')}</a><br>
  ${t('cTiles')}: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, <a href="https://openmaptiles.org" target="_blank" rel="noopener">© OpenMapTiles</a><br>
  ${t('cRenderer')}: <a href="https://maplibre.org" target="_blank" rel="noopener">MapLibre GL JS</a> (BSD-3) · RTL: mapbox-gl-rtl-text (BSD-2)<br>
  ${t('cSearch')}: <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon by komoot</a> · <a href="https://nominatim.org" target="_blank" rel="noopener">Nominatim</a> (OSMF)<br>
  ${t('cRouting')}: <a href="https://routing.openstreetmap.de" target="_blank" rel="noopener">FOSSGIS OSRM</a> · <a href="https://valhalla1.openstreetmap.de" target="_blank" rel="noopener">FOSSGIS Valhalla</a><br>
  ${t('cPoi')}: Overpass API (overpass-api.de, private.coffee, VK Maps)<br>
  ${t('cPhotos')}: Wikimedia Commons, Wikipedia, Wikidata (CC BY-SA) · <a href="https://panoramax.fr" target="_blank" rel="noopener">Panoramax</a><br>
  ${t('cWeather')}: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0)<br>
  ${t('cTerrain')}: <a href="https://mapterhorn.com" target="_blank" rel="noopener">Mapterhorn</a> · ${t('cStyle')}<br>
  ${t('cIcons')}: Material Design Icons (Apache 2.0) · Maki sprites (CC0) · ${t('cFonts')}: Inter, Noto Sans Arabic (OFL)</small></div></div>
  <div class="prow">${ic('info')}<div class="pv"><b>${t('privacy')}</b><small>${t('privacyText')}</small></div></div>`, 'half');
}

// ---------- layers (DESIGN §4.8; no satellite) ----------
export function toggleLayers() {
  const p = $('#layersPop');
  if (!p.classList.contains('hidden')) { p.classList.add('hidden'); $('#scrim').classList.add('hidden'); return; }
  renderLayers(); p.classList.remove('hidden'); $('#scrim').classList.remove('hidden');
}
function renderLayers() {
  const p = $('#layersPop');
  const opt = (k, label) => `<button class="lopt ${settings.style === k ? 'on' : ''}" data-s="${k}" aria-pressed="${settings.style === k}"><span class="thumb t-${k}"></span>${label}</button>`;
  p.innerHTML = `<div class="phead" style="padding:0;align-items:center"><div><h4 style="margin:0">${t('mapHdr')}</h4></div><button class="pclose" id="lClose" aria-label="${t('close')}">${ic('close')}</button></div>
   <div class="lgrid" style="margin-top:14px">${opt('standard', t('standard'))}${opt('terrain', t('terrain'))}${opt('dark', t('dark'))}</div>
   <div class="dlabel" style="padding-inline:0;margin-top:14px">${t('appearance').toUpperCase()}</div>
   ${appearance().replace('class="seg"', 'class="seg" style="margin-inline:0"')}
   <div class="dlabel" style="padding-inline:0;margin-top:8px">${t('details').toUpperCase()}</div>
   <div class="igroup" style="margin-inline:0">
   <button class="lrow" data-t="b3dOn">${t('buildings3d')}${sw(settings.b3dOn)}</button>
   <button class="lrow" data-t="hillshade">${t('hillshade')}${sw(settings.hillshade)}</button>
   <button class="lrow" data-t="terrain3d">${t('terrain3d')}${sw(settings.terrain3d)}</button>
   <button class="lrow" data-t="bilingual">${t('bilingual')}${sw(settings.bilingual !== false)}</button>
   <button class="lrow" data-t="overture"><span class="lrow-t">${t('ovLayer')}<small>${t('ovLayerSub')}</small></span>${sw(settings.overture !== false)}</button>
   <button class="lrow" data-t="transit"><span class="lrow-t">${t('trLayer')}<small>${t('trLayerSub')}</small></span>${sw(settings.transit === true)}</button>
   </div>`;
  p.onclick = e => {
    if (e.target.closest('#lClose')) { p.classList.add('hidden'); $('#scrim').classList.add('hidden'); return; }
    const th = e.target.closest('#dTheme [data-v]');
    if (th) { applyTheme(th.dataset.v); renderLayers(); return; }
    const s = e.target.closest('[data-s]'); const tg = e.target.closest('[data-t]');
    if (s) { settings.style = s.dataset.s; track('layer', { style: settings.style }); }
    else if (tg) {
      const k = tg.dataset.t;
      if (k === 'transit') { settings.transit = settings.transit !== true; saveSettings(); hooks.transit?.(); renderLayers(); return; }
      if (k === 'overture') { settings.overture = settings.overture === false; saveSettings(); hooks.overture?.(); renderLayers(); return; }
      if (k === 'bilingual') { settings.bilingual = settings.bilingual === false; saveSettings(); hooks.relabel(); renderLayers(); return; }
      settings[k] = !settings[k];
      if (k === 'b3dOn') { saveSettings(); hooks.set3d(settings.b3dOn); renderLayers(); return; }
      if (k === 'terrain3d' && settings.terrain3d) App.map.easeTo({ pitch: 60 });
    }
    else return;
    saveSettings(); hooks.restyle(); renderLayers();
  };
}

// ---------- measure ----------
const M = { on: false, pts: [] };
export function measureActive() { return M.on; }
export function startMeasure(first) {
  M.on = true; M.pts = first ? [first] : []; closeSheet();
  $('#measureBar').classList.remove('hidden'); $('#fabsBottom').classList.add('hidden');
  App.map.getCanvas().style.cursor = 'crosshair';
  drawMeasure(); track('measure', {});
}
export function measureClick(ll) { if (!M.on) return false; M.pts.push(ll); drawMeasure(); return true; }
function drawMeasure() {
  let d = 0; for (let i = 1; i < M.pts.length; i++) d += haversine(M.pts[i - 1], M.pts[i]);
  const f = M.pts.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p } }));
  if (M.pts.length > 1) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: M.pts } });
  App.map.getSource('measure')?.setData({ type: 'FeatureCollection', features: f });
  $('#measureBar').innerHTML = `<div><small class="muted">${M.pts.length ? t('total') : t('measureHint')}</small><br><b>${M.pts.length ? fmtDist(d) : '–'}</b></div><button class="ib" id="mUndo">${ic('back')}</button><button class="ib" id="mClose">${ic('close')}</button>`;
  $('#mUndo').onclick = () => { M.pts.pop(); drawMeasure(); };
  $('#mClose').onclick = stopMeasure;
}
export function stopMeasure() { M.on = false; M.pts = []; drawMeasure(); $('#measureBar').classList.add('hidden'); $('#fabsBottom').classList.remove('hidden'); App.map.getCanvas().style.cursor = ''; }
