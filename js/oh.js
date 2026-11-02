// Pure OSM opening_hours core (no DOM, no i18n) – also used by tests/placeinfo (Node).
// Small own parser instead of opening_hours.js (~200 KB + deps): it is on the startup path ("open now" filter),
// so it has to stay tiny. Covers: 24/7, "off"/"closed", weekday lists + ranges (Mo-Fr, Sa,Su, Fr-Mo),
// several time ranges (08:00-12:00,14:00-18:00), ranges past midnight (18:00-02:00, 20:00-26:00, 18:00+),
// several rules (";" overrides, "," before a weekday / "||" adds), optional "PH off"/"PH …" rules (ignored),
// comments in quotes. Anything else (months, weeks, sunrise, …) → null → the caller shows the raw text.
// All times are local Syrian wall-clock time: Asia/Damascus = UTC+3 all year (no DST since 2022),
// so "now" is computed from UTC + 3 h regardless of the device time zone.
export const TZ_OFFSET_MIN = 180;
const DAYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
const DAY_RE = '(?:mo|tu|we|th|fr|sa|su)';
const cache = new Map();

export function parseOH(input) {
  if (input == null) return null;
  const key = String(input);
  if (cache.has(key)) return cache.get(key);
  let r = null;
  try { r = parse(key); } catch { r = null; }
  if (cache.size > 5000) cache.clear();
  cache.set(key, r);
  return r;
}

function parse(str) {
  str = str.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
  if (!str || str.length > 400) return null;
  str = str.replace(/"[^"]*"/g, ' ').trim() // comments
    .replace(/\b(mon|tue|wed|thu|fri|sat|sun)\b/gi, x => x.slice(0, 2)) // "Sat-Thu" → "Sa-Th" (common mistake)
    .replace(/^ph\s*,\s*/i, ''); // "PH,Mo-Su …"
  if (/^24\/(7|24)$/i.test(str)) return { always: true, week: full() };
  const week = Array.from({ length: 7 }, () => null);
  // rule separators: ";" and "||" always (";" overrides earlier rules for the same days), "," only when the
  // previous part ends with a time/off and the next one starts with a weekday/PH (additive rule)
  const rules = [];
  for (const [i, chunk] of str.split(/\s*(;|\|\|)\s*/).entries()) {
    if (i % 2) continue;
    const parts = chunk.split(/\s*,\s*/);
    let curr = null;
    for (const p of parts) {
      if (curr !== null && /^(?:mo|tu|we|th|fr|sa|su|ph)\b/i.test(p) && /(?:\d|\+|\boff|\bclosed|\bopen)$/i.test(curr)) { rules.push({ r: curr, add: rules.length > 0 && rules[rules.length - 1].chunk === i, chunk: i }); curr = p; }
      else curr = curr === null ? p : curr + ',' + p;
    }
    if (curr) rules.push({ r: curr, add: rules.length > 0 && rules[rules.length - 1].chunk === i, chunk: i });
  }
  let any = false;
  for (const { r: rule, add } of rules) {
    if (/^ph\b/i.test(rule)) continue; // public holidays: unknown calendar → ignore
    if (/^24\/7$/i.test(rule)) { for (let d = 0; d < 7; d++) week[d] = [[0, 1440]]; any = true; continue; }
    const m = rule.match(new RegExp(`^((?:${DAY_RE}(?:\\s*-\\s*${DAY_RE})?)(?:\\s*,\\s*${DAY_RE}(?:\\s*-\\s*${DAY_RE})?)*)(?:\\s*,\\s*ph)?(?:\\s+|$|(?=\\d))(.*)$`, 'i'));
    let days, timePart;
    if (m) { days = dayList(m[1]); timePart = m[2].trim(); }
    else if (/^\d/.test(rule) || /^(off|closed|open)$/i.test(rule)) { days = [0, 1, 2, 3, 4, 5, 6]; timePart = rule; }
    else return null;
    if (!days) return null;
    timePart = timePart.replace(/^:\s*/, '');
    if (/^(off|closed)$/i.test(timePart)) { days.forEach(d => week[d] = []); any = true; continue; }
    if (timePart === '' || /^open$/i.test(timePart) || /^00:00-24:00$/.test(timePart)) { days.forEach(d => week[d] = [[0, 1440]]); any = true; continue; }
    timePart = timePart.replace(/\s+open$/i, '');
    const ranges = [];
    for (const tr of timePart.split(/\s*,\s*/)) {
      const mm = tr.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/) || tr.match(/^(\d{1,2}):(\d{2})\+$/);
      if (!mm) return null;
      const a = +mm[1] * 60 + +mm[2];
      let b = mm[3] !== undefined ? +mm[3] * 60 + +mm[4] : 1440;
      if (a >= 1440 || +mm[2] > 59 || (mm[4] !== undefined && +mm[4] > 59) || b > 2880) return null;
      if (b <= a) b += 1440; // past midnight
      ranges.push([a, b]);
    }
    ranges.sort((x, y) => x[0] - y[0]);
    days.forEach(d => week[d] = add && week[d] ? week[d].concat(ranges).sort((x, y) => x[0] - y[0]) : ranges.slice());
    any = true;
  }
  if (!any) return null;
  const w = week.map(x => x || []);
  const always = w.every(x => x.length === 1 && x[0][0] === 0 && x[0][1] >= 1440);
  return { always, week: w };
}
function full() { return Array.from({ length: 7 }, () => [[0, 1440]]); }
function dayList(s) {
  const out = [];
  for (const part of s.toLowerCase().split(/\s*,\s*/)) {
    const [x, y] = part.split(/\s*-\s*/);
    let a = DAYS.indexOf(x); const b = y === undefined ? a : DAYS.indexOf(y);
    if (a < 0 || b < 0) return null;
    for (let i = 0; i < 7; i++) { if (!out.includes(a)) out.push(a); if (a === b) break; a = (a + 1) % 7; }
  }
  return out;
}

// Local Syrian wall-clock time for an absolute instant: { dow 0=Su…6=Sa, min 0…1439 }
export function damascusNow(date = new Date()) {
  const d = new Date(date.getTime() + TZ_OFFSET_MIN * 60000);
  return { dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

// Status at `date`: { open, always, soon, closes: {min, inDays}, opens: {min, inDays, dow} } (times local Syrian)
export function ohState(input, date = new Date()) {
  const oh = typeof input === 'string' ? parseOH(input) : input;
  if (!oh) return null;
  if (oh.always) return { open: true, always: true, soon: false, closes: null, opens: null };
  const { dow, min } = damascusNow(date);
  const iv = [];
  for (let k = -1; k <= 7; k++) {
    const d = ((dow + k) % 7 + 7) % 7;
    for (const [a, b] of oh.week[d]) iv.push([k * 1440 + a, k * 1440 + b]);
  }
  iv.sort((x, y) => x[0] - y[0]);
  const cur = iv.find(([a, b]) => a <= min && min < b);
  if (cur) {
    let end = cur[1], grew = true;
    while (grew) { grew = false; for (const [a, b] of iv) if (a <= end && b > end) { end = b; grew = true; } }
    if (end - min >= 7 * 1440) return { open: true, always: true, soon: false, closes: null, opens: null };
    return { open: true, always: false, soon: end - min <= 60, closes: { min: ((end % 1440) + 1440) % 1440, inDays: Math.floor(end / 1440) }, opens: null };
  }
  const next = iv.find(([a]) => a > min);
  if (!next) return { open: false, always: false, soon: false, closes: null, opens: null };
  const inDays = Math.floor(next[0] / 1440);
  return { open: false, always: false, soon: false, closes: null, opens: { min: next[0] - inDays * 1440, inDays, dow: (dow + inDays) % 7 } };
}

// Week starts Saturday in Arabic (Syrian calendar, weekend Fri/Sat), Monday in EN/DE.
export function weekOrder(lang) { return lang === 'ar' ? [6, 0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 0]; }

export function hhmm(m) { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }

// Rows for the week view: [{ dow, ranges: [[a,b]…] (b may be >1440 = past midnight), closed, allDay, today }]
export function ohWeek(input, lang, date = new Date()) {
  const oh = typeof input === 'string' ? parseOH(input) : input;
  if (!oh) return null;
  const today = damascusNow(date).dow;
  return weekOrder(lang).map(d => {
    const r = oh.week[d];
    return { dow: d, ranges: r, closed: !r.length, allDay: r.length === 1 && r[0][0] === 0 && r[0][1] >= 1440, today: d === today };
  });
}
