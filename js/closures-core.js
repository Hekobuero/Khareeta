// Community road reports (closed / delay / construction / flooding): pure helpers, no DOM, no network.
// Sending: an anonymous kh_events row (type 'layer', props.k = 'closure') via the public insert-only key – same
// pipeline as js/report-core.js (install_id 'anon', session null, no country). Location is rounded to 4 decimals
// (~11 m), no identity is attached. Display: ONLY moderator-approved entries from the static file data/closures.json
// (scripts/closures/export-approved.mjs); entries past `expires` are never shown.
export const CLOSURE_KINDS = ['closed', 'delay', 'construction', 'flooding'];
export const CLOSURE_COLORS = { closed: '#D93025', delay: '#E37400', construction: '#B06000', flooding: '#1A73E8' };
export const NOTE_MAX = 140;
export const NEAR_M = 50;
export const MAX_DAYS = 14; // an approved entry may stay visible at most this long

const r4 = v => Math.round(+v * 1e4) / 1e4;
const clip = (v, n) => { v = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return v ? v.slice(0, n) : null; };
export const snap = (lat, lon) => ({ lat: r4(lat), lon: r4(lon) });
const okLL = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

// ----- personal data in the free-text note: e-mails, phone numbers (Latin, Arabic-Indic and Persian digits), links,
// @handles. The UI rejects such notes with a clear message; stripPII() is the safety net for moderators.
const D = '[0-9\u0660-\u0669\u06F0-\u06F9]';
const PII_RES = [
  /[^\s@]+@[^\s@]+\.[^\s@]{2,}/gu,                                   // e-mail
  /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|me|ly|gl|sy|lb|de|info|app|co)(?:\/\S*)?/giu, // URL / bare domain
  new RegExp(`\\+?${D}(?:[\\s\\-./()\\u00A0]*${D}){6,}`, 'gu'),       // phone (7+ digits, any separators)
  /(?:^|[^\p{L}\p{N}_])@[\p{L}\p{N}_.]{2,}/gu,                           // @handle
];
// dates (2026/11/04, 2026 11 04, ٢٠٢٦/١١/٠٤, 04.11.2026) are not phone numbers: masked before the checks, restored after
const DATE_RE = new RegExp(`(?<!\\p{N}[\\s./-]?)(?:${D}{4}[\\s./-]${D}{1,2}[\\s./-]${D}{1,2}|${D}{1,2}[\\s./-]${D}{1,2}[\\s./-]${D}{4})(?![\\s./-]?\\p{N})`, 'gu');
const maskDates = s => { const keep = []; return { s: s.replace(DATE_RE, m => { keep.push(m); return '\uE000' + 'abcdefghijklmnopqrstuvwxyz'[Math.min(keep.length - 1, 25)] + '\uE001'; }), keep }; };
const unmask = (s, keep) => s.replace(/\uE000([a-z])\uE001/g, (_, c) => keep[c.charCodeAt(0) - 97] ?? '');
export const hasPII = s => { s = maskDates(String(s || '')).s; return PII_RES.some(r => { r.lastIndex = 0; return r.test(s); }); };
export const stripPII = s => { const m = maskDates(String(s || '')); return unmask(stripRaw(m.s), m.keep); };
const stripRaw = s => PII_RES.reduce((a, r) => a.replace(r, m => (/^[^@]/.test(m) && m.includes('@') && !m.includes('.') ? m[0] : '') + '…'), String(s || '')).replace(/\s+/g, ' ').trim();

/** Build the anonymous props payload. Returns { ok, props } or { ok:false, err: kind|pos|size }. */
export function buildClosureReport(kind, note, lat, lon, road) {
  if (!CLOSURE_KINDS.includes(kind)) return { ok: false, err: 'kind' };
  lat = +lat; lon = +lon;
  if (!okLL(lat, lon)) return { ok: false, err: 'pos' };
  const s = snap(lat, lon);
  const p = { k: 'closure', t: kind, la: s.lat, lo: s.lon };
  const rd = clip(road, 80); if (rd) p.rd = rd;
  if (hasPII(note)) return { ok: false, err: 'pii' };
  const v = clip(note, NOTE_MAX); if (v) p.v = v;
  if (JSON.stringify(p).length > 900) return { ok: false, err: 'size' };
  return { ok: true, props: p };
}

// Public-facing text must stay neutral: moderator notes containing military/political terms are rejected by the export.
export const BLOCKED_TERMS = ['military', 'army', 'militia', 'soldier', 'regime', 'rebel', 'checkpoint', 'sniper', 'shelling', 'airstrike',
  'جيش', 'عسكري', 'ميليشيا', 'حاجز عسكري', 'حاجز أمني', 'حاجز تفتيش', 'قناص', 'قصف', 'معارضة', 'Militär', 'Armee', 'Miliz', 'Soldat', 'Regime', 'Rebell', 'Kontrollpunkt', 'Checkpoint'];
export const neutralText = s => !BLOCKED_TERMS.some(w => String(s || '').toLowerCase().includes(w.toLowerCase()));
const ts = v => { const n = Date.parse(v); return Number.isFinite(n) ? n : NaN; };
/** Validate one entry of data/closures.json; returns a normalised entry or null. */
export function normEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const lat = +e.lat, lon = +e.lon;
  if (!CLOSURE_KINDS.includes(e.kind) || !okLL(lat, lon)) return null;
  const from = ts(e.since), to = ts(e.expires);
  if (!Number.isFinite(to) || !Number.isFinite(from) || to <= from) return null;
  if (to - from > MAX_DAYS * 864e5) return null;
  const s = snap(lat, lon);
  return { id: String(e.id || '').slice(0, 40) || `c${s.lat}_${s.lon}`, kind: e.kind, lat: s.lat, lon: s.lon,
    since: new Date(from).toISOString(), expires: new Date(to).toISOString(), note: clip(e.note, NOTE_MAX) || '', road: clip(e.road, 80) || '' };
}
/** Active (valid, started, not expired) entries of a closures file. */
export function activeClosures(doc, now = Date.now()) {
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.closures) ? doc.closures : [];
  return list.map(normEntry).filter(e => e && ts(e.expires) > now && ts(e.since) <= now + 6e4);
}
export function toGeoJSON(list) {
  return { type: 'FeatureCollection', features: list.map(e => ({ type: 'Feature', id: undefined,
    properties: { id: e.id, kind: e.kind, since: e.since, expires: e.expires, note: e.note, road: e.road },
    geometry: { type: 'Point', coordinates: [e.lon, e.lat] } })) };
}

// ----- geometry: metres from a point to a polyline (equirectangular, fine for < few km) -----
const R = 6371008.8, rad = d => d * Math.PI / 180;
export function distToLine(p, coords) {
  if (!coords?.length) return Infinity;
  const k = Math.cos(rad(p[1]));
  const xy = c => [rad(c[0] - p[0]) * k * R, rad(c[1] - p[1]) * R];
  if (coords.length === 1) return Math.hypot(...xy(coords[0]));
  let best = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = xy(coords[i - 1]), [bx, by] = xy(coords[i]);
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
/** Nearest point on a polyline to p: { pt:[lon,lat], d:metres }. */
export function nearestOnPolyline(p, coords) {
  const k = Math.cos(rad(p[1]));
  let best = { pt: null, d: Infinity };
  for (let i = 1; i < (coords?.length || 0); i++) {
    const a = coords[i - 1], b = coords[i];
    const ax = (a[0] - p[0]) * k, ay = a[1] - p[1], dx = (b[0] - a[0]) * k, dy = b[1] - a[1], L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy) * rad(1) * R;
    if (d < best.d) best = { pt: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], d };
  }
  return best;
}
/** Active closures within `m` metres of a route polyline ([[lon,lat],…]). Quick bbox pre-filter. */
export function closuresNearRoute(coords, list, m = NEAR_M) {
  if (!coords?.length || !list?.length) return [];
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of coords) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  const pad = m / 111000 * 2;
  return list.filter(e => e.lon >= a - pad * 2 && e.lon <= c + pad * 2 && e.lat >= b - pad && e.lat <= d + pad)
    .filter(e => distToLine([e.lon, e.lat], coords) <= m);
}

export class ExportError extends Error {}
// ----- moderator export (used by scripts/closures/export-approved.mjs, tested in Node) -----
/** rows: kh_events rows (or their props) with props.k === 'closure'; approve: Map/obj id → { hours, note? }. */
export function rowsToEntries(rows, approve, now = Date.now(), defHours = 48) {
  const out = [];
  for (const r of rows || []) {
    const p = r?.props || r; const id = String(r?.id ?? p?.id ?? '');
    if (!p || p.k !== 'closure' || !id) continue;
    const a = approve instanceof Map ? approve.get(id) : approve?.[id];
    if (!a) continue;
    if (a.note && !neutralText(a.note)) throw new ExportError(`Report ${id}: the note uses wording that is not allowed on the map (${BLOCKED_TERMS.filter(w => String(a.note).toLowerCase().includes(w.toLowerCase())).join(', ')}). Rephrase it neutrally, e.g. "slow traffic", "road closed".`);
    if (a.note && hasPII(a.note)) throw new ExportError(`Report ${id}: the note contains personal data (phone, e-mail, link or @handle). Remove it.`);
    const raw = a.hours ?? defHours, hours = +raw;
    if (!Number.isFinite(hours) || hours <= 0) throw new ExportError(`Report ${id}: hours must be a positive number (got ${JSON.stringify(raw)}).`);
    if (hours > MAX_DAYS * 24) throw new ExportError(`Report ${id}: hours ${hours} is more than the maximum of ${MAX_DAYS * 24} (${MAX_DAYS} days).`);
    const e = normEntry({ id: 'r' + id, kind: p.t, lat: p.la, lon: p.lo, since: new Date(now).toISOString(),
      expires: new Date(now + hours * 36e5).toISOString(), note: a.note ?? '', road: p.rd || '' });
    if (e) out.push(e);
  }
  return out;
}
/** Merge new entries into an existing file document, dropping expired/invalid ones; stable order by expiry. */
export function mergeFile(doc, add, now = Date.now()) {
  const old = (Array.isArray(doc?.closures) ? doc.closures : []).map(normEntry).filter(e => e && Date.parse(e.expires) > now);
  const byId = new Map(old.map(e => [e.id, e]));
  for (const e of add) byId.set(e.id, e);
  return { schema: 1, updated: new Date(now).toISOString(), closures: [...byId.values()].sort((x, y) => x.expires.localeCompare(y.expires)) };
}

/** Arabic (and other) plural-aware count text: tpl = { zero, one, two, few, many, other } with {n}. */
export function plural(lang, n, tpl) {
  let c = 'other'; try { c = new Intl.PluralRules(lang).select(n); } catch {}
  return String(tpl[c] ?? tpl.other ?? '').replace('{n}', new Intl.NumberFormat(lang === 'ar' ? 'ar' : lang).format(n));
}
