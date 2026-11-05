// ONE "Report…" entry for the place sheet and the "What's here?" sheet. It opens a small choice:
//  · "To Khareeta (private)"            → js/report.js (moderated, Supabase, only our team sees it)
//  · "Map error on OpenStreetMap (public)" → js/notes.js (anonymous public OSM note)
// "Edit on OpenStreetMap" stays a separate, subdued link. Same icon everywhere: REPORT_ICON.
import { esc } from './util.js';
import { t } from './i18n.js';
import { ic } from './icons.js';

export const REPORT_ICON = 'flag';

/** HTML for the entry (button + hidden choice + optional subdued OSM edit link). id: prefix for element ids. */
export function reportEntryHtml(id, editHref = '') {
  return `<div class="rp-open rm" id="${id}">
    <button class="abtn rm-btn" id="${id}Btn" type="button" aria-expanded="false" aria-controls="${id}Menu">${ic(REPORT_ICON)}<span>${esc(t('rmOpen'))}</span></button>
    <div class="rm-menu" id="${id}Menu" role="menu" hidden>
      <button type="button" class="rm-opt" role="menuitem" data-rm="kh"><b>${esc(t('rmKh'))}</b><small>${esc(t('rmKhSub'))}</small></button>
      <button type="button" class="rm-opt" role="menuitem" data-rm="osm"><b>${esc(t('rmOsm'))}</b><small>${esc(t('rmOsmSub'))}</small></button>
    </div>
    ${editHref ? `<a class="rm-edit" href="${esc(editHref)}" target="_blank" rel="noopener">${esc(t('editOsm'))}</a>` : ''}
  </div>`;
}

/** Wire the entry inside `root`. onKh / onOsm are called when the matching option is chosen. */
export function wireReportEntry(root, id, { onKh, onOsm }) {
  const btn = root.querySelector('#' + id + 'Btn'), menu = root.querySelector('#' + id + 'Menu');
  if (!btn || !menu) return;
  const set = open => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.onclick = () => { set(menu.hidden); if (!menu.hidden) menu.querySelector('.rm-opt')?.focus(); };
  menu.onkeydown = e => { if (e.key === 'Escape') { set(false); btn.focus(); } };
  menu.querySelectorAll('.rm-opt').forEach(o => o.onclick = () => { set(false); (o.dataset.rm === 'kh' ? onKh : onOsm)?.(); });
}
