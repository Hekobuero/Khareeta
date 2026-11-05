// In-app report sheet: (a) missing place, (b) wrong data on an OSM/Overture place, (c) suggest a social link.
// Everything is moderated – nothing a user sends is shown in the app. Sent via analytics.submitReport() → sendNow() (publishable,
// insert-only Supabase key); the "thank you" toast appears only after the server accepted the row.
import { $, esc, toast, hideToast, fmtCoord } from './util.js';
import { t } from './i18n.js';
import { ic } from './icons.js';
import { App, openSheet, closeSheet } from './core.js';
import { submitReport, reportQuiet, reportQuietOff } from './analytics.js';
import { REPORT_CATS, REPORT_FIELDS, LINK_KINDS, buildReport, rateCheck, rateNote } from './report-core.js';

let busy = false;
const quietOff = () => reportQuietOff();
const placeOf = item => item && !item.coord && item.id ? { id: String(item.ovId || item.id), src: item.ov ? 'ov' : 'osm', name: item.name || '', lat: item.lat, lon: item.lon } : null;

/** item: a place (OSM/Overture) or a dropped pin (item.coord); without item the map centre is used for "missing place". */
export function openReport(item, type) {
  hideToast(); // old success/error toasts must not linger over the form
  const place = placeOf(item);
  const types = place ? ['wrong', 'link', 'missing'] : ['missing'];
  let cur = types.includes(type) ? type : types[0];
  const pos = () => item ? { lat: item.lat, lon: item.lon } : (() => { const c = App.map?.getCenter?.(); return c ? { lat: c.lat, lon: c.lng } : {}; })();
  let p = pos();
  reportQuiet(Infinity); // drop held place/point events and record none while the sheet is open (+60 s after)
  const draw = () => {
    const seg = types.length > 1 ? `<div class="seg rp-seg" role="tablist">${types.map(k => `<button role="tab" data-t="${k}" aria-selected="${k === cur}" class="${k === cur ? 'on' : ''}">${esc(t('rpT_' + k))}</button>`).join('')}</div>` : '';
    const hdrName = place && cur !== 'missing' ? `<p class="psub" dir="auto">${esc(place.name)}</p>` : '';
    let fields = '';
    if (cur === 'missing') fields = `
      <div class="rp-f"><label>${esc(t('rpPos'))}</label><div class="rp-pos"><span dir="ltr" id="rpPos">${p.lat != null ? esc(fmtCoord(p.lat, p.lon)) : '—'}</span>${item ? '' : `<button type="button" class="rp-link" id="rpCenter">${esc(t('rpUseCenter'))}</button>`}</div><small>${esc(t(item ? 'rpPosPin' : 'rpPosHint'))}</small></div>
      <div class="rp-f"><label for="rpName">${esc(t('rpName'))}</label><input id="rpName" dir="auto" maxlength="80" autocomplete="off"></div>
      <div class="rp-f"><label for="rpCat">${esc(t('rpCat'))}</label><select id="rpCat"><option value="">${esc(t('rpChoose'))}</option>${REPORT_CATS.map(c => `<option value="${c}">${esc(t('rpC_' + c))}</option>`).join('')}</select></div>`;
    else if (cur === 'wrong') fields = `
      <div class="rp-f"><label for="rpField">${esc(t('rpField'))}</label><select id="rpField"><option value="">${esc(t('rpChoose'))}</option>${REPORT_FIELDS.map(c => `<option value="${c}">${esc(t('rpF_' + c))}</option>`).join('')}</select></div>`;
    else fields = `
      <div class="rp-f"><label for="rpKind">${esc(t('rpKind'))}</label><select id="rpKind">${LINK_KINDS.map(k => `<option value="${k}">${esc(t(k === 'website' ? 'website' : k))}</option>`).join('')}</select></div>
      <div class="rp-f"><label for="rpUrl">${esc(t('rpUrl'))}</label><input id="rpUrl" type="url" inputmode="url" dir="ltr" maxlength="200" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://"><small>${esc(t('rpUrlHint'))}</small></div>`;
    fields += `<div class="rp-f"><label for="rpNote">${esc(t(cur === 'wrong' ? 'rpNoteWrong' : 'rpNote'))}</label><textarea id="rpNote" dir="auto" rows="3" maxlength="300"></textarea></div>`;
    const html = `<div class="phead"><div><h2 class="ptitle">${esc(t(cur === 'missing' ? 'rpTitleMissing' : 'rpTitle'))}</h2>${hdrName}</div><button class="pclose" id="rpClose" aria-label="${esc(t('close'))}">${ic('close')}</button></div>
      ${seg}<form class="rp" id="rpForm" novalidate>${fields}
      <p class="rp-err" id="rpErr" role="alert" hidden></p>
      <button class="rp-send" id="rpSend" type="submit">${esc(t('rpSend'))}</button>
      <p class="rp-note">${ic('info', 'xs')}<span>${esc(t('rpModerated'))}</span></p></form>`;
    const body = openSheet(html, 'full', quietOff);
    body.querySelector('#rpClose').onclick = () => closeSheet();
    body.querySelectorAll('.rp-seg button').forEach(b => b.onclick = () => { cur = b.dataset.t; draw(); });
    body.querySelector('#rpCenter')?.addEventListener('click', () => { p = pos(); body.querySelector('#rpPos').textContent = p.lat != null ? fmtCoord(p.lat, p.lon) : '—'; });
    body.querySelector('#rpForm').onsubmit = e => { e.preventDefault(); submit(body); };
  };
  const err = (body, k) => { const e = body.querySelector('#rpErr'); e.textContent = t(k); e.hidden = false; };
  async function submit(body) {
    if (busy) return;
    const v = id => body.querySelector(id)?.value || '';
    const f = { name: v('#rpName'), cat: v('#rpCat'), field: v('#rpField'), kind: v('#rpKind'), url: v('#rpUrl'), note: v('#rpNote') };
    const b = buildReport(cur, f, cur === 'missing' ? { ...p, ...(place ? { id: place.id, src: place.src } : {}) } : place);
    if (!b.ok) return err(body, b.err === 'link' ? 'rpE_link_' + b.link.err : 'rpE_' + b.err);
    const rl = rateCheck();
    if (!rl.ok) return err(body, rl.why === 'gap' ? 'rpE_gap' : 'rpE_rate');
    busy = true; const btn = body.querySelector('#rpSend'); btn.disabled = true; btn.textContent = t('rpSending');
    const r = submitReport('layer', b.props); // stored, sent after a random 2–10 min delay (see analytics)
    busy = false;
    if (!body.isConnected) return;
    btn.disabled = false; btn.textContent = t('rpSend');
    if (r.ok) { rateNote(); closeSheet(); toast(t('rpThanks'), 4000); return; }
    err(body, r.why === 'offline' ? 'rpE_offline' : r.why === 'dev' ? 'rpE_dev' : 'rpE_send');
  }
  draw();
}
