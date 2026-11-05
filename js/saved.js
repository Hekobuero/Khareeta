// Saved places UI: list sheet (tap = fly + open, swipe or ✎ = edit/rename/delete, route), edit sheet (own name,
// Home / Work / Favourite), JSON export/import (local file, no server) and small markers on the map. Data: saved-core.js.
import { $, esc, toast } from './util.js';
import { t } from './i18n.js';
import { ic } from './icons.js';
import { App, openSheet, closeSheet } from './core.js';
import * as SV from './saved-core.js';

const ST = (() => { try { return localStorage; } catch { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; } })();
export const savedList = () => SV.load(ST);
export const isSaved = id => SV.isSaved(ST, id);
const changed = () => { syncSavedLayer(); dispatchEvent(new CustomEvent('kh-saved')); };
export function saveItem(item, opts) { const r = SV.add(ST, item, opts); changed(); return r; }
export function toggleSaved(item) { const on = SV.toggle(ST, item); changed(); return on; }
export function removeSaved(id, kind) { const r = SV.remove(ST, id, kind); changed(); return r; }
export const KIND_ICON = { home: ['home', 'var(--k-accent)'], work: ['work', '#6E7781'], fav: ['star', '#E8710A'] };
export const savedIcon = s => KIND_ICON[s.kind] || KIND_ICON.fav;
const kindLabel = k => t(k === 'home' ? 'home' : k === 'work' ? 'work' : 'svFav');

async function fly(s) {
  App.map?.flyTo({ center: [s.lon, s.lat], zoom: Math.max(App.map.getZoom(), 16), duration: 700 });
  const { openPlace } = await import('./place.js');
  openPlace({ ...s, name: SV.displayName(s) });
}
async function route(s) { const { openDirections } = await import('./route.js'); openDirections({ to: { ...s, name: SV.displayName(s) } }); }

export function showSaved() {
  const list = SV.sorted(savedList());
  const rows = list.map((s, i) => { const [icn, col] = savedIcon(s); return `<div class="svrow" data-i="${i}"><div class="svslide">
    <div class="srow" data-open="${i}"><div class="sic badge" style="background:${col}">${ic(icn)}</div><div class="st"><div class="t1" dir="auto">${esc(SV.displayName(s))}</div><div class="t2" dir="auto">${esc([s.kind !== 'fav' ? kindLabel(s.kind) : '', s.label ? s.name : s.sub || ''].filter(Boolean).join(' · '))}</div></div>
    <button class="ib" data-route="${i}" aria-label="${esc(t('svRoute'))}" title="${esc(t('svRoute'))}">${ic('directions', 'sm')}</button>
    <button class="ib" data-edit="${i}" aria-label="${esc(t('svEdit'))}" title="${esc(t('svEdit'))}">${ic('edit', 'sm')}</button></div></div>
    <button class="svdel" data-del="${i}" aria-label="${esc(t('svDelete'))}">${ic('trash', 'sm')}<span>${esc(t('svDelete'))}</span></button></div>`; }).join('');
  const body = openSheet(`<div class="phead"><div><h2 class="ptitle" style="font-size:22px">${t('savedPlaces')}</h2><p class="psub">${esc(t('svLocal'))}</p></div><button class="pclose" id="svClose" aria-label="${esc(t('close'))}">${ic('close')}</button></div>
    <div class="list svlist" id="svList">${rows || `<div class="sec"><p class="psub">${t('noSaved')}</p></div>`}</div>
    <div class="arow svio"><button class="abtn" id="svExport"${list.length ? '' : ' disabled'}>${ic('share')}<span>${esc(t('svExport'))}</span></button><button class="abtn" id="svImport">${ic('download')}<span>${esc(t('svImport'))}</span></button>
    <input type="file" id="svFile" accept="application/json,.json" hidden></div><div style="height:16px"></div>`, 'half');
  App.sheetKind = 'saved';
  body.querySelector('#svClose').onclick = () => closeSheet();
  const el = body.querySelector('#svList');
  el.onclick = e => {
    const g = (a) => { const b = e.target.closest(`[data-${a}]`); return b ? list[+b.dataset[a]] : null; };
    let s;
    if ((s = g('del'))) { removeSaved(s.id, s.kind); toast(t('svRemoved')); showSaved(); return; }
    if ((s = g('edit'))) { editSaved(s); return; }
    if ((s = g('route'))) { route(s); return; }
    const row = e.target.closest('.svrow'); if (row?.classList.contains('swiped')) { row.classList.remove('swiped'); return; }
    if ((s = g('open'))) fly(s);
  };
  swipe(el);
  body.querySelector('#svExport').onclick = () => exportFile(list);
  const f = body.querySelector('#svFile');
  body.querySelector('#svImport').onclick = () => f.click();
  f.onchange = async () => { const file = f.files[0]; if (!file) return; try { const r = importText(await file.text()); toast(t('svImported', { n: r.added + r.updated })); showSaved(); } catch { toast(t('svImportErr'), 3500); } };
}
// swipe a row towards the inline end (left in LTR, right in RTL) to reveal "Delete"
function swipe(el) {
  let x0 = null, y0 = 0, row = null;
  el.addEventListener('touchstart', e => { row = e.target.closest('.svrow'); if (!row) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null || !row) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
    const rtl = document.documentElement.dir === 'rtl', open = rtl ? dx > 0 : dx < 0;
    el.querySelectorAll('.svrow.swiped').forEach(r => r !== row && r.classList.remove('swiped'));
    row.classList.toggle('swiped', open);
  }, { passive: true });
}

export function editSaved(s) {
  const body = openSheet(`<div class="phead"><div><h2 class="ptitle" style="font-size:22px">${esc(t('svEdit'))}</h2><p class="psub" dir="auto">${esc(s.name)}</p></div><button class="pclose" id="seBack" aria-label="${esc(t('back'))}">${ic('close')}</button></div>
    <div class="sec svedit">
      <label class="svlbl" for="seName">${esc(t('svName'))}</label>
      <input id="seName" class="svinput" dir="auto" maxlength="${SV.MAX_NAME}" value="${esc(s.label || '')}" placeholder="${esc(s.name)}" autocomplete="off">
      <div class="svlbl">${esc(t('svKind'))}</div>
      <div class="seg" role="radiogroup" id="seKind">${SV.KINDS.map(k => `<button role="radio" aria-checked="${k === s.kind}" data-k="${k}" class="${k === s.kind ? 'on' : ''}">${ic(KIND_ICON[k][0], 'sm')}<span>${esc(kindLabel(k))}</span></button>`).join('')}</div>
    </div>
    <div class="arow actions"><button class="abtn primary" id="seSave">${ic('check')}<span>${esc(t('svDone'))}</span></button><button class="abtn" id="seRoute">${ic('directions')}<span>${esc(t('svRoute'))}</span></button><button class="abtn danger" id="seDel">${ic('trash')}<span>${esc(t('svDelete'))}</span></button></div><div style="height:16px"></div>`, 'half');
  App.sheetKind = 'saved-edit';
  let kind = s.kind;
  body.querySelector('#seKind').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; body.querySelectorAll('#seKind button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); };
  body.querySelector('#seBack').onclick = () => showSaved();
  body.querySelector('#seSave').onclick = () => { SV.update(ST, s.id, s.kind, { label: body.querySelector('#seName').value, kind }); changed(); toast(t('savedOk')); showSaved(); };
  body.querySelector('#seRoute').onclick = () => route(s);
  body.querySelector('#seDel').onclick = () => { removeSaved(s.id, s.kind); toast(t('svRemoved')); showSaved(); };
}

export function importText(text) { const r = SV.importJson(text, savedList()); SV.store(ST, r.list); changed(); return r; }
function exportFile(list) {
  const blob = new Blob([SV.exportJson(list)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `khareeta-saved-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(t('svExported'));
}

// ---------- map markers (small dots, under the selected-place marker) ----------
const SRC = 'kh-saved', LYR = 'kh-saved-dot';
const geo = () => ({ type: 'FeatureCollection', features: savedList().map((s, i) => ({ type: 'Feature', id: i, properties: { i, k: s.kind }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) });
export function addSavedLayer(map) {
  if (!map || map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: geo() });
  map.addLayer({ id: LYR, type: 'circle', source: SRC, minzoom: 9, paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 5.5], 'circle-color': ['match', ['get', 'k'], 'home', '#1A73E8', 'work', '#6E7781', '#E8710A'],
    'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 2] } });
  map.on('click', LYR, e => { const f = e.features?.[0]; const s = f && savedList()[f.properties.i]; if (s) { e.originalEvent?.stopPropagation?.(); fly(s); } });
  map.on('mouseenter', LYR, () => { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', LYR, () => { map.getCanvas().style.cursor = ''; });
}
export function syncSavedLayer() { try { App.map?.getSource(SRC)?.setData(geo()); } catch {} }
