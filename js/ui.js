// Drawer menu, settings, layers popup, measure tool, about/credits
import { $, esc, settings, saveSettings, lsGet, lsSet, toast, fmtDist, haversine, VERSION } from './util.js';
import { t, LANGS, getLang, setLang } from './i18n.js';
import { ic } from './icons.js';
import { App, openSheet, closeSheet } from './core.js';
import { getTheme, setTheme } from './mapstyle.js';
import { openOfflinePanel } from './offline.js';
import { openPlace } from './place.js';
import { track } from './analytics.js';

export const hooks = { restyle: null, relabel: null, rerenderUI: null, set3d: null };

// ---------- drawer ----------
const sw = on => `<span class="sw ${on ? 'on' : ''}" aria-hidden="true"></span>`;
const seg = (id, opts, cur) => `<div class="seg" id="${id}" role="radiogroup">${opts.map(([k, n]) => `<button data-v="${k}" role="radio" aria-checked="${cur === k}" class="${cur === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
const appearance = () => seg('dTheme', [['system', t('system')], ['light', t('light')], ['dark', t('dark')]], getTheme());
export function openDrawer() {
  const d = $('#drawer');
  d.innerHTML = `
    <div class="dbrand"><img src="icons/icon-192.png" alt=""><div><b>${t('settings')}</b><div class="muted" style="font-size:13px">Khareeta · خريطة</div></div><button class="ib" id="dClose" style="margin-inline-start:auto" aria-label="${t('close')}">${ic('close')}</button></div>
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
    </div>
    <div class="dlabel">${t('more').toUpperCase()}</div>
    <div class="dgroup">
      <button class="ditem" data-a="saved">${ic('bookmark')}${t('savedPlaces')}<span class="dv">${ic('chevron', 'sm flip-rtl')}</span></button>
      <button class="ditem" data-a="offline">${ic('download')}${t('offlineMaps')}<span class="dv">${ic('chevron', 'sm flip-rtl')}</span></button>
      <button class="ditem" data-a="measure">${ic('ruler')}${t('measure')}</button>
      <button class="ditem" data-a="install" id="dInstall">${ic('download')}${t('install')}</button>
      <button class="ditem" data-a="lowData">${ic('data')}${t('lowData')}${sw(settings.lowData)}</button>
      <button class="ditem" data-a="stats">${ic('info')}${t('stats')}${sw(localStorage.getItem('kh.noTrack') !== '1')}</button>
      <button class="ditem" data-a="about">${ic('info')}${t('about')}<span class="dv">${ic('chevron', 'sm flip-rtl')}</span></button>
    </div>
    <div class="dfoot">Khareeta v${VERSION}<br>© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles</div>`;
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
    if (l) { const from = getLang(); if (from === l.dataset.l) return; setLang(l.dataset.l); track('lang_change', { from, to: l.dataset.l }); hooks.rerenderUI(); hooks.relabel(); openDrawer(); return; }
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
      if (a === 'arabicDigits') hooks.rerenderUI();
      openDrawer(); return;
    }
    closeDrawer();
    if (a === 'saved') showSaved();
    if (a === 'offline') openOfflinePanel();
    if (a === 'measure') startMeasure();
    if (a === 'about') showAbout();
    if (a === 'install') install();
  });
}
async function install() {
  if (App.installPrompt) { App.installPrompt.prompt(); const r = await App.installPrompt.userChoice; if (r.outcome === 'accepted') track('install', {}); App.installPrompt = null; return; }
  toast(getLang() === 'ar' ? 'في Safari: مشاركة ← إضافة إلى الشاشة الرئيسية' : getLang() === 'de' ? 'In Safari: Teilen → Zum Home-Bildschirm' : 'In Safari: Share → Add to Home Screen', 5000);
}

export function showSaved() {
  const list = lsGet('kh.saved', []);
  const body = openSheet(`<div class="phead"><div><h2 class="ptitle" style="font-size:22px">${t('savedPlaces')}</h2></div></div>
    <div class="list">${list.map((s, i) => `<div class="srow" data-i="${i}"><div class="sic badge" style="background:${s.kind === 'home' ? 'var(--k-accent)' : s.kind === 'work' ? '#6E7781' : '#E8710A'}">${ic(s.kind === 'home' ? 'home' : s.kind === 'work' ? 'work' : 'star')}</div><div class="st"><div class="t1">${esc(s.name)}</div><div class="t2">${esc(s.sub || '')}</div></div><button class="ib" data-rm="${i}">${ic('trash', 'sm')}</button></div>`).join('') || `<div class="sec"><p class="psub">${t('noSaved')}</p></div>`}</div>`, 'half');
  body.querySelector('.list').onclick = e => {
    const rm = e.target.closest('[data-rm]'); if (rm) { list.splice(+rm.dataset.rm, 1); lsSet('kh.saved', list); showSaved(); return; }
    const r = e.target.closest('.srow[data-i]'); if (r) openPlace({ ...list[+r.dataset.i] });
  };
}

function showAbout() {
  openSheet(`<div class="sec"><h2 class="ptitle">Khareeta · خريطة</h2><p class="psub">v${VERSION}</p></div>
  <div class="prow">${ic('info')}<div class="pv wiki">${getLang() === 'ar' ? 'خريطة تطبيق ملاحة مجاني ومفتوح المصدر مبني على بيانات OpenStreetMap ويستخدم فقط خدمات مجتمعية لا تتطلب مفاتيح ولا تحجب سوريا.' : getLang() === 'de' ? 'Khareeta ist eine freie Navigations-App auf Basis von OpenStreetMap. Sie nutzt nur schlüsselfreie Community-Dienste, die Syrien nicht sperren.' : 'Khareeta is a free navigation app built on OpenStreetMap. It only uses key-free community services that do not block Syria.'}</div></div>
  <div class="prow">${ic('map')}<div class="pv"><b>${t('sources')}</b><small>
  Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a> (ODbL)<br>
  Vector tiles & styles: <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a>, <a href="https://openmaptiles.org" target="_blank">© OpenMapTiles</a><br>
  Map renderer: <a href="https://maplibre.org" target="_blank">MapLibre GL JS</a> (BSD-3) · RTL: mapbox-gl-rtl-text (BSD-2)<br>
  Search: <a href="https://photon.komoot.io" target="_blank">Photon by komoot</a> · <a href="https://nominatim.org" target="_blank">Nominatim</a> (OSMF)<br>
  Routing: <a href="https://routing.openstreetmap.de" target="_blank">FOSSGIS OSRM</a> · <a href="https://valhalla1.openstreetmap.de" target="_blank">FOSSGIS Valhalla</a><br>
  POI details: Overpass API (overpass-api.de, private.coffee, VK Maps)<br>
  Photos & articles: Wikimedia Commons, Wikipedia, Wikidata (CC BY-SA) · <a href="https://panoramax.fr" target="_blank">Panoramax</a><br>
  Weather: <a href="https://open-meteo.com" target="_blank">Open-Meteo</a> (CC BY 4.0)<br>
  Terrain: <a href="https://mapterhorn.com" target="_blank">Mapterhorn</a> · Map style &amp; sprites: Khareeta design<br>
  Icons: Material Design Icons (Apache 2.0) · Maki sprites (CC0) · Fonts: Inter, Noto Sans Arabic (OFL)</small></div></div>
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
   </div>`;
  p.onclick = e => {
    if (e.target.closest('#lClose')) { p.classList.add('hidden'); $('#scrim').classList.add('hidden'); return; }
    const th = e.target.closest('#dTheme [data-v]');
    if (th) { applyTheme(th.dataset.v); renderLayers(); return; }
    const s = e.target.closest('[data-s]'); const tg = e.target.closest('[data-t]');
    if (s) { settings.style = s.dataset.s; track('layer', { style: settings.style }); }
    else if (tg) {
      const k = tg.dataset.t;
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
