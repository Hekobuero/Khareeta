// "Report map error" → anonymous OpenStreetMap note (OSM Notes API, no key, no login). Pure logic, no DOM – tested in tests/notes/.
// Separate from the Khareeta report/closure forms (Supabase): this goes to OSM mappers and is PUBLIC.
export const NOTES_API = 'https://api.openstreetmap.org/api/0.6/notes.json';
export const NOTE_TYPES = ['missing', 'name', 'location', 'closed', 'road', 'other'];
export const NOTE_TYPE_EN = { missing: 'Place missing', name: 'Wrong name', location: 'Wrong location', closed: 'Closed / does not exist', road: 'Road wrong', other: 'Other' };
export const MAX_TEXT = 500, MIN_TEXT = 10, GAP_MS = 60000, TKEY = 'kh.noteT';

export const cleanText = s => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, MAX_TEXT);

/** Client-side spam check: a type chosen OR at least MIN_TEXT characters of text. */
export function validNote({ type, text }) {
  const tx = cleanText(text);
  if (type && !NOTE_TYPES.includes(type)) return false;
  return !!type || tx.length >= MIN_TEXT;
}

/** place: { name?, osm_type?, osm_id? } – osm_type 'node'|'way'|'relation' (or n/w/r). */
export function buildNoteText({ type, text, place }) {
  const lines = [];
  if (type) lines.push('Map error: ' + NOTE_TYPE_EN[type]);
  const tx = cleanText(text);
  if (tx) lines.push(tx);
  if (place && (place.name || place.osm_id)) {
    const ty = { n: 'node', w: 'way', r: 'relation' }[place.osm_type] || place.osm_type;
    const ref = place.osm_id && /^(node|way|relation)$/.test(ty || '') && /^\d+$/.test(String(place.osm_id)) ? `https://www.openstreetmap.org/${ty}/${place.osm_id}` : '';
    lines.push('Place: ' + [String(place.name || '').slice(0, 120), ref].filter(Boolean).join(' – '));
  }
  lines.push('#Khareeta');
  return lines.join('\n');
}

export const r7 = v => Math.round(v * 1e7) / 1e7;

/** Throttle: max 1 note per GAP_MS per device (localStorage). Returns ms to wait (0 = ok). */
export function waitMs(store, now = Date.now()) {
  let last = 0; try { last = +store?.getItem(TKEY) || 0; } catch {}
  return last && now - last < GAP_MS && now >= last ? GAP_MS - (now - last) : 0;
}
export function markSent(store, now = Date.now()) { try { store?.setItem(TKEY, String(now)); } catch {} }

export const noteUrl = id => 'https://www.openstreetmap.org/note/' + encodeURIComponent(id);

/**
 * Sender with single-flight: while a request is in flight further calls get {ok:false, err:'busy'} – nothing is sent twice.
 * Returns {ok:true,id,url} | {ok:false, err:'invalid'|'throttle'|'ratelimit'|'offline'|'network'|'client'|'server'|'busy', wait?, status?}.
 * The throttle mark is set BEFORE the request, so a retry after a timeout/unknown outcome cannot create a duplicate within 60 s.
 */
export function makeSender({ fetchFn, store, online = () => true, now = () => Date.now(), timeout = 15000 }) {
  let busy = false;
  return async function send({ lat, lon, type, text, place }) {
    if (busy) return { ok: false, err: 'busy' };
    if (!validNote({ type, text }) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, err: 'invalid' };
    const w = waitMs(store, now()); if (w) return { ok: false, err: 'throttle', wait: w };
    if (!online()) return { ok: false, err: 'offline' };
    busy = true;
    const body = new URLSearchParams({ lat: String(r7(lat)), lon: String(r7(lon)), text: buildNoteText({ type, text, place }) });
    let ctl = null, tm = null;
    try {
      ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (ctl) tm = setTimeout(() => ctl.abort(), timeout);
      markSent(store, now());
      const r = await fetchFn(NOTES_API, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, credentials: 'omit', signal: ctl?.signal });
      if (!r.ok) {
        // a definite rejection (4xx/5xx) created nothing → allow an immediate retry, except 429 (rate limited)
        if (r.status !== 429) { try { store?.removeItem(TKEY); } catch {} }
        return { ok: false, err: r.status === 429 ? 'ratelimit' : r.status >= 500 ? 'server' : 'client', status: r.status };
      }
      const j = await r.json().catch(() => null);
      const id = j?.properties?.id ?? j?.id;
      if (id == null) return { ok: false, err: 'server', status: r.status };
      return { ok: true, id, url: noteUrl(id) };
    } catch { return { ok: false, err: 'network' }; }
    finally { clearTimeout(tm); busy = false; }
  };
}
