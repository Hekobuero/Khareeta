// Gesundheit / Notfall sheet: Syrian emergency call buttons + nearby hospital/clinic/pharmacy via existing chips.
import { $, esc } from './util.js';
import { t } from './i18n.js';
import { ic } from './icons.js';
import { App, openSheet, center } from './core.js';
import { EMERGENCY_NUMBERS, NEARBY_ACTIONS, telHref } from './health-core.js';
import { track } from './analytics.js';

/** Open the health/emergency sheet. Does not move the map (no Syria jump). */
export function openHealthSheet() {
  track('health', { open: 1 });
  const nums = EMERGENCY_NUMBERS.map(n => {
    const href = telHref(n.dial);
    const label = t(n.labelKey);
    return `<a class="em-call" href="${esc(href)}" data-em="${esc(n.id)}" aria-label="${esc(t('emCall', { n: n.dial + ' – ' + label }))}">
      <span class="em-ic" style="--em-c:var(--k-poi-health)">${ic(n.icon)}</span>
      <span class="em-meta"><span class="em-lab">${esc(label)}</span><span class="em-num" dir="ltr">${esc(n.dial)}</span></span>
      <span class="em-btn">${ic('phone')}<span>${esc(t('call'))}</span></span>
    </a>`;
  }).join('');

  const nearby = NEARBY_ACTIONS.map(a =>
    `<button type="button" class="em-near" data-near="${esc(a.id)}" data-cat="${esc(a.cat)}">${ic(a.icon)}<span>${esc(t(a.labelKey))}</span>${ic('chevron', 'sm flip-rtl')}</button>`
  ).join('');

  const srcLines = EMERGENCY_NUMBERS.flatMap(n => n.sources.map(s =>
    `<li><b dir="ltr">${esc(n.dial)}</b> · <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a><small> — ${esc(s.states)}</small></li>`
  )).join('');

  const html = `<div class="phead"><div><h2 class="ptitle" style="font-size:22px">${esc(t('emTitle'))}</h2>
    <p class="psub em-syria">${esc(t('emSyriaLabel'))}</p></div>
    <button class="pclose" id="emClose" aria-label="${esc(t('close'))}">${ic('close')}</button></div>
  <p class="psub em-hint">${esc(t('emSyriaHint'))}</p>
  <div class="em-calls" role="list">${nums}</div>
  <h3 class="sect-title">${esc(t('emNearbyTitle'))}</h3>
  <p class="psub em-hint">${esc(t('emNearbyHint'))}</p>
  <div class="igroup em-near-g">${nearby}</div>
  <details class="em-src"><summary>${esc(t('emSources'))}</summary><ul>${srcLines}</ul></details>
  <div style="height:12px"></div>`;

  // Action-heavy sheet: use the full detent, where the shared sheet body scrolls.
  const body = openSheet(html, 'full');
  App.sheetKind = 'health';
  // Capture map centre when the sheet opens – nearby search must not use a Syria default
  const viewAtOpen = (() => { try { const c = center(); return [c[0], c[1]]; } catch { return null; } })();
  body.dataset.emView = viewAtOpen ? viewAtOpen.join(',') : '';

  $('#emClose').onclick = () => { import('./core.js').then(m => m.closeSheet()); };
  body.querySelector('.em-calls')?.addEventListener('click', e => {
    const a = e.target.closest('a.em-call'); if (!a) return;
    track('health', { call: a.dataset.em });
  });
  body.querySelector('.em-near-g')?.addEventListener('click', e => {
    const b = e.target.closest('button.em-near'); if (!b) return;
    const cat = b.dataset.cat;
    track('health', { nearby: b.dataset.near, cat });
    // Reuse the existing category path (chip-view rules from #43): current view, no Syria jump.
    // Dynamic import avoids a static health↔search cycle at boot (report-menu / what's-here sheets).
    import('./search.js').then(({ applyChips, cancelCategory }) => { cancelCategory(); applyChips([cat], false, true); });
  });
}

/** Whether opening the health sheet changed the map centre (tests / guard). Always false by design. */
export function healthSheetMovesMap() { return false; }
