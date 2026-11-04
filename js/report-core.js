// In-app reports (missing place / wrong data / social-link suggestion): pure helpers, no DOM, no network.
// Reports are moderated: they are stored as anonymous kh_events rows (type 'layer', props.k = 'report') through the
// public insert-only key and are NEVER shown in the app. Links are only validated here – nothing is fetched or scraped.
export const REPORT_TYPES = ['missing', 'wrong', 'link'];
export const REPORT_CATS = ['restaurant', 'cafe', 'bakery', 'supermarket', 'shop', 'pharmacy', 'hospital', 'fuel', 'atm', 'bank', 'hotel', 'mosque', 'church', 'school', 'parking', 'other'];
export const REPORT_FIELDS = ['name', 'hours', 'phone', 'location', 'category', 'closed', 'other'];
export const LINK_KINDS = ['facebook', 'instagram', 'whatsapp', 'telegram', 'website'];
// exact hosts per kind (lower-case, after URL parsing); website = any public https host that passes the lookalike checks
export const LINK_HOSTS = {
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com', 'www.fb.com', 'fb.me'],
  instagram: ['instagram.com', 'www.instagram.com', 'm.instagram.com'],
  whatsapp: ['wa.me', 'api.whatsapp.com', 'whatsapp.com', 'www.whatsapp.com', 'chat.whatsapp.com', 'wa.link'],
  telegram: ['t.me', 'telegram.me', 'www.telegram.me'],
};
const BRANDS = ['facebook', 'instagram', 'whatsapp', 'telegram', 'fb', 'wa'];
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
const deleet = s => s.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/rn/g, 'm').replace(/vv/g, 'w');
// Why a host looks like a spoof of a known social domain (or uses non-Latin/IDN characters); null = looks fine.
export function lookalike(rawHost, host) {
  if (/[^\x00-\x7f]/.test(rawHost || '')) return /[\u0400-\u04ff]/.test(rawHost) ? 'cyrillic' : 'idn';
  if (/(^|\.)xn--/.test(host)) return 'idn';
  const all = Object.values(LINK_HOSTS).flat();
  if (all.includes(host)) return null;
  const labels = host.split('.');
  for (const l of labels.slice(0, -1)) {
    for (const b of BRANDS) {
      if (b.length < 5) continue;
      const x = deleet(l);
      if (l.includes(b) || x.includes(b) || (lev(x, b) <= 1 && l !== b)) return 'brand';
    }
  }
  return null;
}
/** Validate a suggested link. Returns { ok:true, url, kind, host } or { ok:false, err } (err: empty|https|bad|host|lookalike|kind). */
export function checkLink(input, kind) {
  let s = String(input || '').trim();
  if (!s) return { ok: false, err: 'empty' };
  if (!LINK_KINDS.includes(kind)) return { ok: false, err: 'kind' };
  if (s.length > 200) return { ok: false, err: 'bad' };
  const m = s.match(/^([a-z][a-z0-9+.-]*):/i);
  if (m && m[1].toLowerCase() !== 'https') return { ok: false, err: 'https' };
  if (!m) { if (/^\/\//.test(s)) return { ok: false, err: 'https' }; s = 'https://' + s; } // bare "facebook.com/x" → https
  const rawHost = (s.match(/^https:\/\/([^/?#]*)/i) || [])[1] || '';
  let u; try { u = new URL(s); } catch { return { ok: false, err: 'bad' }; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || rawHost.includes('@')) return { ok: false, err: 'bad' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || /^\d+(\.\d+){3}$/.test(host) || /\.(local|lan|internal|localhost)$/.test(host)) return { ok: false, err: 'host' };
  const la = lookalike(rawHost, host);
  if (la) return { ok: false, err: 'lookalike', why: la };
  if (kind !== 'website') {
    if (!LINK_HOSTS[kind].includes(host)) return { ok: false, err: 'host' };
    if (u.pathname.replace(/\/+$/, '') === '' && kind !== 'whatsapp') return { ok: false, err: 'bad' };
  } else if (Object.values(LINK_HOSTS).flat().includes(host)) {
    return { ok: false, err: 'kind' }; // a social link entered as "website" – pick the right type
  }
  u.hash = '';
  return { ok: true, url: u.href.slice(0, 200), kind, host };
}

// ----- local rate limit (per device; the server additionally only accepts small rows) -----
export const RL_KEY = 'kh.rpt';
export const RL = { gapMs: 20e3, hour: 5, day: 15 };
export function rateCheck(now = Date.now(), store = globalThis.localStorage) {
  let a = []; try { a = JSON.parse(store?.getItem(RL_KEY) || '[]').filter(x => typeof x === 'number' && now - x < 864e5); } catch {}
  if (a.length && now - a[a.length - 1] < RL.gapMs) return { ok: false, why: 'gap', wait: RL.gapMs - (now - a[a.length - 1]) };
  if (a.filter(x => now - x < 36e5).length >= RL.hour) return { ok: false, why: 'hour' };
  if (a.length >= RL.day) return { ok: false, why: 'day' };
  return { ok: true, list: a };
}
export function rateNote(now = Date.now(), store = globalThis.localStorage) {
  const r = rateCheck(now, store); const a = r.list || [];
  try { store?.setItem(RL_KEY, JSON.stringify([...a, now].slice(-RL.day))); } catch {}
}

// ----- build the anonymous props payload (kh_events.props must stay ≤ 1 KB) -----
const clip = (v, n) => { v = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return v ? v.slice(0, n) : null; };
const r5 = v => Math.round(+v * 1e5) / 1e5;
/** place: { id, src:'osm'|'ov', name, lat, lon } (lat/lon = the PLACE / pin position, never the user's GPS). */
export function buildReport(type, f = {}, place = {}) {
  if (!REPORT_TYPES.includes(type)) return { ok: false, err: 'type' };
  const p = { k: 'report', t: type };
  if (place.id) p.id = clip(place.id, 40);
  if (place.src) p.src = place.src === 'ov' ? 'ov' : 'osm';
  const lat = +place.lat, lon = +place.lon;
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { p.la = r5(lat); p.lo = r5(lon); }
  const pn = clip(place.name, 80); if (pn) p.pn = pn;
  if (type === 'missing') {
    p.n = clip(f.name, 80); if (!p.n || p.n.length < 2) return { ok: false, err: 'name' };
    if (!REPORT_CATS.includes(f.cat)) return { ok: false, err: 'cat' };
    p.c = f.cat;
    if (p.la == null) return { ok: false, err: 'pos' };
  } else if (type === 'wrong') {
    if (!p.id) return { ok: false, err: 'place' };
    if (!REPORT_FIELDS.includes(f.field)) return { ok: false, err: 'field' };
    p.f = f.field;
  } else {
    if (!p.id) return { ok: false, err: 'place' };
    const l = checkLink(f.url, f.kind); if (!l.ok) return { ok: false, err: 'link', link: l };
    p.lk = l.kind; p.u = l.url;
  }
  const note = clip(f.note, 300); if (note) p.v = note;
  if (type === 'wrong' && !p.v && p.f !== 'closed') return { ok: false, err: 'note' };
  while (JSON.stringify(p).length > 900 && p.v) p.v = p.v.slice(0, Math.max(0, p.v.length - 40)) || undefined;
  if (JSON.stringify(p).length > 900) return { ok: false, err: 'size' };
  return { ok: true, props: p };
}
