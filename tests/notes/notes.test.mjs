// OSM notes ("Report map error"): text building, throttle, error handling, no double send, i18n EN/AR/DE.
// fetch is ALWAYS mocked – no test ever creates a real note on api.openstreetmap.org.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.fetch = () => { throw new Error('network access in tests is forbidden'); };
const C = await import('../../js/notes-core.js');
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const ok = id => async () => ({ ok: true, status: 200, json: async () => ({ type: 'Feature', properties: { id } }) });
const st = s => async () => ({ ok: false, status: s, json: async () => ({}) });

test('text: type in English + user text + place + #Khareeta', () => {
  const s = C.buildNoteText({ type: 'name', text: '  Heißt eigentlich Café Nour  ', place: { name: 'مقهى', osm_type: 'node', osm_id: 123 } });
  assert.equal(s, 'Map error: Wrong name\nHeißt eigentlich Café Nour\nPlace: مقهى – https://www.openstreetmap.org/node/123\n#Khareeta');
  assert.equal(C.buildNoteText({ type: null, text: 'Hier fehlt eine Brücke' }), 'Hier fehlt eine Brücke\n#Khareeta');
  assert.match(C.buildNoteText({ type: 'other', text: '', place: { osm_type: 'w', osm_id: '9' } }), /way\/9/);
  assert.ok(!/javascript/.test(C.buildNoteText({ type: 'other', place: { name: 'x', osm_type: 'evil', osm_id: '1' } })));
  for (const k of C.NOTE_TYPES) assert.ok(C.NOTE_TYPE_EN[k]);
});
test('text: max 500 chars user text, control chars stripped', () => {
  const s = C.buildNoteText({ type: null, text: 'a'.repeat(900) + '\u0007' });
  assert.equal(s.split('\n')[0].length, 500);
  assert.equal(C.cleanText('a\u0000b\u0007c'), 'abc');
});
test('spam check: type OR >= 10 chars', () => {
  assert.equal(C.validNote({ type: null, text: 'short' }), false);
  assert.equal(C.validNote({ type: null, text: '          ' }), false);
  assert.equal(C.validNote({ type: null, text: '0123456789' }), true);
  assert.equal(C.validNote({ type: 'road', text: '' }), true);
  assert.equal(C.validNote({ type: 'bogus', text: 'long enough text' }), false);
});
test('send: correct request, anonymous, success url', async () => {
  const calls = []; const store = mem();
  const send = C.makeSender({ store, fetchFn: async (u, o) => { calls.push([u, o]); return ok(42)(); } });
  const r = await send({ lat: 33.51383821, lon: 36.27653, type: 'missing', text: 'Bakery here', place: null });
  assert.deepEqual(r, { ok: true, id: 42, url: 'https://www.openstreetmap.org/note/42' });
  assert.equal(calls.length, 1); const [u, o] = calls[0];
  assert.equal(u, 'https://api.openstreetmap.org/api/0.6/notes.json'); assert.equal(o.method, 'POST'); assert.equal(o.credentials, 'omit');
  assert.equal(o.headers.Authorization, undefined);
  const b = o.body; assert.equal(b.get('lat'), '33.5138382'); assert.equal(b.get('lon'), '36.27653'); assert.match(b.get('text'), /^Map error: Place missing\nBakery here\n#Khareeta$/);
});
test('throttle: max 1 per 60 s per device', async () => {
  let now = 1e12; const store = mem(); let n = 0;
  const send = C.makeSender({ store, now: () => now, fetchFn: async () => { n++; return ok(n)(); } });
  assert.equal((await send({ lat: 1, lon: 1, type: 'other' })).ok, true);
  now += 30000; const r = await send({ lat: 1, lon: 1, type: 'other' });
  assert.equal(r.err, 'throttle'); assert.equal(r.wait, 30000); assert.equal(n, 1);
  now += 30001; assert.equal((await send({ lat: 1, lon: 1, type: 'other' })).ok, true); assert.equal(n, 2);
  // shared across sender instances (same device storage)
  const send2 = C.makeSender({ store, now: () => now, fetchFn: async () => { n++; return ok(n)(); } });
  assert.equal((await send2({ lat: 1, lon: 1, type: 'other' })).err, 'throttle');
});
test('no double send: concurrent clicks → one request', async () => {
  let n = 0, release; const gate = new Promise(r => (release = r));
  const send = C.makeSender({ store: mem(), fetchFn: async () => { n++; await gate; return ok(7)(); } });
  const a = send({ lat: 1, lon: 1, type: 'road' }), b = send({ lat: 1, lon: 1, type: 'road' });
  assert.equal((await b).err, 'busy'); release();
  assert.equal((await a).ok, true); assert.equal(n, 1);
});
test('errors: offline / invalid send nothing', async () => {
  let n = 0; const f = async () => { n++; return ok(1)(); };
  assert.equal((await C.makeSender({ store: mem(), online: () => false, fetchFn: f })({ lat: 1, lon: 1, type: 'road' })).err, 'offline');
  const s = C.makeSender({ store: mem(), fetchFn: f });
  assert.equal((await s({ lat: 1, lon: 1, type: null, text: 'hi' })).err, 'invalid');
  assert.equal((await s({ lat: 99, lon: 1, type: 'road' })).err, 'invalid');
  assert.equal((await s({ lat: NaN, lon: 1, type: 'road' })).err, 'invalid');
  assert.equal(n, 0);
});
test('errors: 4xx/5xx clear, retry allowed; network/429 keep throttle (no duplicate)', async () => {
  const store = mem();
  assert.deepEqual(await C.makeSender({ store, fetchFn: st(400) })({ lat: 1, lon: 1, type: 'road' }), { ok: false, err: 'client', status: 400 });
  assert.equal(C.waitMs(store), 0);
  assert.equal((await C.makeSender({ store, fetchFn: st(503) })({ lat: 1, lon: 1, type: 'road' })).err, 'server');
  assert.equal(C.waitMs(store), 0);
  assert.equal((await C.makeSender({ store, fetchFn: st(429) })({ lat: 1, lon: 1, type: 'road' })).err, 'client');
  assert.ok(C.waitMs(store) > 0);
  const s2 = mem();
  assert.equal((await C.makeSender({ store: s2, fetchFn: async () => { throw new TypeError('Failed to fetch'); } })({ lat: 1, lon: 1, type: 'road' })).err, 'network');
  assert.ok(C.waitMs(s2) > 0, 'unknown outcome → no immediate resend');
  assert.equal((await C.makeSender({ store: mem(), fetchFn: async () => ({ ok: true, status: 200, json: async () => { throw new Error(); } }) })({ lat: 1, lon: 1, type: 'road' })).err, 'server');
});
test('i18n: all nt* keys in EN/AR/DE, only OSM endpoint, no keys', () => {
  const src = readFileSync(new URL('../../js/i18n.js', import.meta.url), 'utf8');
  const keys = ['ntOpen', 'ntTitle', 'ntType', 'ntText', 'ntNotice', 'ntSend', 'ntOk', 'ntView', 'ntErrWait', 'ntErr_offline', 'ntErr_network', 'ntErr_client', 'ntErr_server', 'ntErr_invalid', ...C.NOTE_TYPES.map(k => 'ntT_' + k)];
  for (const k of keys) assert.equal(src.split('\n').filter(l => l.startsWith('  ' + k + ':')).length, 3, k);
  assert.ok(src.includes('الإبلاغ عن خطأ في الخريطة') && src.includes('Kartenfehler melden') && src.includes('Report map error'));
  const ui = readFileSync(new URL('../../js/notes.js', import.meta.url), 'utf8') + readFileSync(new URL('../../js/notes-core.js', import.meta.url), 'utf8');
  const code = ui.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.ok(!/google|mapbox|here\.com|bing|apple|supabase|api[_-]?key/i.test(code));
  assert.match(ui, /track\('osm_note_sent', \{\}\)/);
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'js/notes.js'") && sw.includes("'js/notes-core.js'"));
});
