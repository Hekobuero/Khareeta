// "Report map error" sheet → anonymous public OpenStreetMap note. Logic in notes-core.js. Separate from report.js (Supabase).
import { $, esc, fmtCoord, hideToast } from './util.js';
import { t } from './i18n.js';
import { ic } from './icons.js';
import { openSheet, closeSheet } from './core.js';
import { track } from './analytics.js';
import { NOTE_TYPES, MAX_TEXT, validNote, makeSender } from './notes-core.js';

const store = (() => { try { return localStorage; } catch { return null; } })();
const send = makeSender({ fetchFn: (u, o) => fetch(u, o), store, online: () => navigator.onLine !== false });

let toastT;
function toastLink(msg, href, ms = 8000) {
  const el = $('#toast'); if (!el) return;
  el.innerHTML = `<span>${esc(msg)}</span>${href ? ` <a href="${esc(href)}" target="_blank" rel="noopener noreferrer" dir="ltr" class="nt-link">${esc(t('ntView'))}</a>` : ''}`;
  el.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), ms);
}

/** p: { lat, lon, name?, osm_type?, osm_id? } */
export function openMapNote(p) {
  hideToast(); clearTimeout(toastT); // old success/error toasts must not linger over the form
  let type = null;
  const place = p.osm_id || p.name ? { name: p.name || '', osm_type: p.osm_type, osm_id: p.osm_id } : null;
  const body = openSheet(`
  <div class="phead"><div><h2 class="ptitle">${esc(t('ntTitle'))}</h2>
    <p class="psub" dir="auto">${esc(p.name || '')}${p.name ? ' · ' : ''}<bdi dir="ltr">${esc(fmtCoord(p.lat, p.lon))}</bdi></p></div>
    <button class="pclose" id="ntClose" aria-label="${esc(t('close'))}">${ic('close')}</button></div>
  <div class="rp-form nt-form">
    <div class="rp-f"><label id="ntTypeL">${esc(t('ntType'))}</label>
      <div class="nt-chips" role="radiogroup" aria-labelledby="ntTypeL">${NOTE_TYPES.map(k => `<button type="button" class="chip" role="radio" aria-checked="false" data-k="${k}">${esc(t('ntT_' + k))}</button>`).join('')}</div></div>
    <div class="rp-f"><label for="ntText">${esc(t('ntText'))}</label><textarea id="ntText" dir="auto" maxlength="${MAX_TEXT}" placeholder="${esc(t('ntTextPh'))}"></textarea><small><span id="ntCount" dir="ltr">0/${MAX_TEXT}</span></small></div>
    <p class="nt-notice" role="note">${ic('info')}<span>${esc(t('ntNotice'))}</span></p>
    <p class="nt-err" id="ntErr" role="alert" hidden></p>
    <button class="abtn primary nt-send" id="ntSend" disabled>${esc(t('ntSend'))}</button>
  </div><div style="height:16px"></div>`, 'full');
  const ta = body.querySelector('#ntText'), btn = body.querySelector('#ntSend'), err = body.querySelector('#ntErr');
  const upd = () => { body.querySelector('#ntCount').textContent = ta.value.length + '/' + MAX_TEXT; btn.disabled = !validNote({ type, text: ta.value }); };
  body.querySelectorAll('.nt-chips .chip').forEach(c => c.onclick = () => {
    type = type === c.dataset.k ? null : c.dataset.k;
    body.querySelectorAll('.nt-chips .chip').forEach(x => { const on = x.dataset.k === type; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
    upd();
  });
  ta.oninput = upd;
  body.querySelector('#ntClose').onclick = () => closeSheet();
  btn.onclick = async () => {
    if (btn.disabled) return;
    btn.disabled = true; err.hidden = true; btn.textContent = t('ntSending');
    const r = await send({ lat: p.lat, lon: p.lon, type, text: ta.value, place });
    btn.textContent = t('ntSend');
    if (r.ok) { track('osm_note_sent', {}); closeSheet(); toastLink(t('ntOk'), r.url); return; }
    if (r.err === 'busy') return;
    err.textContent = r.err === 'throttle' ? t('ntErrWait', { s: Math.ceil(r.wait / 1000) }) : t('ntErr_' + (['offline', 'network', 'client', 'server', 'invalid', 'ratelimit'].includes(r.err) ? r.err : 'server'));
    err.hidden = false; upd();
  };
}
