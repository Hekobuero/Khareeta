// Lightweight OSM opening_hours parser (covers the common syntax: 24/7, day ranges, time ranges,
// overnight ranges, "off", multiple rules separated by ';' or ','). Unknown syntax -> raw text only.
import { t, getLang } from './i18n.js';
import { fmtTime } from './util.js';
const DAY = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };

export function parseOH(str) {
  if (!str) return null;
  str = str.trim();
  if (/^24\/7$/.test(str) || /^Mo-Su 00:00-24:00$/.test(str)) return { always: true, week: Array.from({ length: 7 }, () => [[0, 1440]]) };
  const week = Array.from({ length: 7 }, () => null);
  const rules = str.split(/\s*;\s*|\s*\|\|\s*/).filter(Boolean);
  let any = false;
  for (let rule of rules) {
    rule = rule.replace(/\s+/g, ' ').trim();
    if (/^PH|^SH|"|\bweek\b|[A-Z][a-z]{2} \d|easter|sunrise|sunset|dawn|dusk/i.test(rule) && !/^(Mo|Tu|We|Th|Fr|Sa|Su)/.test(rule) && !/^\d/.test(rule)) continue;
    let m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:\[[^\]]*\])?\s*,?\s*)+)?\s*(?:,?\s*PH\s*,?)?\s*(.*)$/);
    if (!m) return null;
    const dayPart = (m[1] || '').trim(); let timePart = (m[2] || '').trim();
    let days = [];
    if (!dayPart) days = [0, 1, 2, 3, 4, 5, 6];
    else for (const d of dayPart.split(/\s*,\s*/).filter(Boolean)) {
      const r = d.replace(/\[.*\]/, '').split('-');
      if (r.length === 1) days.push(DAY[r[0]]);
      else { let a = DAY[r[0]], b = DAY[r[1]]; for (let i = 0; i < 8; i++) { days.push(a); if (a === b) break; a = (a + 1) % 7; } }
    }
    if (days.some(d => d === undefined)) return null;
    if (/^(off|closed)$/i.test(timePart)) { days.forEach(d => week[d] = []); any = true; continue; }
    if (timePart === '' || timePart === 'open') { days.forEach(d => week[d] = [[0, 1440]]); any = true; continue; }
    timePart = timePart.replace(/\bopen\b/, '').trim();
    const ranges = [];
    for (const tr of timePart.split(/\s*,\s*/)) {
      const mm = tr.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/) || tr.match(/^(\d{1,2}):(\d{2})\+$/);
      if (!mm) return null;
      const a = +mm[1] * 60 + +mm[2]; const b = mm[3] !== undefined ? +mm[3] * 60 + +mm[4] : 1440;
      ranges.push([a, b <= a ? b + 1440 : b]);
    }
    days.forEach(d => week[d] = ranges.slice()); any = true;
  }
  if (!any) return null;
  return { week: week.map(w => w || []) };
}

// returns intervals for absolute time window starting at day-start of `now` minus 1 day
function intervals(oh, now) {
  const out = [];
  const base = new Date(now); base.setHours(0, 0, 0, 0);
  for (let k = -1; k < 8; k++) {
    const day = new Date(base.getTime() + k * 86400000);
    for (const [a, b] of oh.week[day.getDay()]) out.push([day.getTime() + a * 60000, day.getTime() + b * 60000, day]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}
const hm = ms => fmtTime(new Date(ms));

export function ohStatus(str, now = new Date()) {
  const oh = parseOH(str);
  if (!oh) return null;
  if (oh.always) return { open: true, text: t('open247'), cls: 'open' };
  const iv = intervals(oh, now), n = now.getTime();
  const cur = iv.find(([a, b]) => a <= n && n < b);
  if (cur) {
    // merge contiguous
    let end = cur[1]; for (const [a, b] of iv) if (a <= end && b > end) end = b;
    if (end - n > 6 * 86400000) return { open: true, text: t('open247'), cls: 'open' };
    const soon = end - n < 3600000;
    return { open: true, text: t('open') + ' · ' + t('closesAt', { t: hm(end) }), cls: soon ? 'soon' : 'open', soon };
  }
  const next = iv.find(([a]) => a > n);
  if (!next) return { open: false, text: t('closed'), cls: 'closed' };
  const sameDay = new Date(next[0]).toDateString() === now.toDateString();
  const label = sameDay ? t('opensAt', { t: hm(next[0]) }) : t('opensDay', { d: t('days')[new Date(next[0]).getDay()], t: hm(next[0]) });
  return { open: false, text: t('closed') + ' · ' + label, cls: 'closed' };
}

export function ohTable(str, now = new Date()) {
  const oh = parseOH(str);
  if (!oh) return null;
  const order = [6, 0, 1, 2, 3, 4, 5]; // Syria: week starts Saturday
  const today = now.getDay();
  return order.map(d => {
    const r = oh.week[d];
    const txt = !r.length ? t('closed') : r.map(([a, b]) => (a === 0 && b >= 1440) ? '24h' : `${mm(a)}–${mm(b % 1440 === 0 && b > 0 ? 1440 : b % 1440)}`).join(', ');
    return { day: t('daysLong')[d], txt, today: d === today };
  });
  function mm(x) { const d = new Date(2000, 0, 1, 0, x); return x === 1440 ? (getLang() === 'de' ? '24:00' : '24:00') : fmtTime(d); }
}
