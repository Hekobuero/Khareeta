// Opening-hours presentation on top of the pure parser in oh.js. All times are Syrian local time (Asia/Damascus,
// UTC+3 all year) regardless of the device time zone. Unknown syntax → null (callers show the raw text).
import { t, getLang } from './i18n.js';
import { digits } from './fmt.js';
import { parseOH, ohState, ohWeek, hhmm } from './oh.js';
export { parseOH };

const tm = m => digits(hhmm(m));

// { open, text: 'Open now · Closes 21:00', cls: 'open'|'soon'|'closed', soon } or null.
// `text` keeps the "<state> · <detail>" shape (search.js shows the first part on its own).
export function ohStatus(str, now = new Date()) {
  const s = ohState(str, now);
  if (!s) return null;
  // A quoted OSM comment ("summer only") → never a definite open/closed: amber "Possibly …" + the comment,
  // and not counted as open by the "Open now" filter.
  if (s.note) return { open: false, uncertain: true, text: t(s.open ? 'maybeOpen' : 'maybeClosed') + ' · “' + s.note + '”', cls: 'soon', soon: false };
  if (s.always) return { open: true, text: t('open247'), cls: 'open', soon: false };
  if (s.openEnd) return { open: true, text: t('openNow') + ' · ' + t('openFrom', { t: tm(s.since) }), cls: 'open', soon: false }; // "09:00+": no closing time
  if (s.open) return { open: true, text: (s.soon ? t('closingSoon') : t('openNow')) + ' · ' + t('closesAt', { t: tm(s.closes.min) }), cls: s.soon ? 'soon' : 'open', soon: s.soon };
  if (!s.opens) return { open: false, text: t('closedNow'), cls: 'closed', soon: false };
  const when = s.opens.inDays === 0 ? t('opensAt', { t: tm(s.opens.min) })
    : s.opens.inDays === 1 ? t('opensTomorrow', { t: tm(s.opens.min) })
    : t('opensDay', { d: t('daysLong')[s.opens.dow], t: tm(s.opens.min) });
  return { open: false, text: t('closedNow') + ' · ' + when, cls: 'closed', soon: false };
}

// Week view rows in locale order (AR: Saturday first, EN/DE: Monday first): [{ day, txt, today }] or null.
export function ohTable(str, now = new Date()) {
  const w = ohWeek(str, getLang(), now);
  if (!w) return null;
  return w.map(r => ({
    day: t('daysLong')[r.dow],
    txt: r.closed ? t('closed') : r.allDay ? t('open24h') : r.ranges.map(([a, b, oe]) => oe && b === 1440 ? t('openFrom', { t: tm(a) }) : tm(a) + '–' + (b === 1440 ? digits('24:00') : tm(b)) + (oe ? '+' : '')).join(', '),
    today: r.today,
  }));
}
