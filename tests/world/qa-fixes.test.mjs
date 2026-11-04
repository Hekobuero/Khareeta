// QA fixes on PR #15: Overpass backoff (P1-1), settlement ranking (P1-2), name:ar fallback (P2), layer order (P3).
// Run: node --test 'tests/world/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Backoff, overpassAttempt, retryAfterMs, rateWait, OVERPASS_GET, BACKOFF_MAX } from '../../js/world-core.js';
import { rank, biasBox } from '../../js/suggest.js';
import { pickNameFor, labelExpression } from '../../js/names.js';

const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const resp = (status, headers = {}) => ({ ok: status < 400, status, headers: { get: k => headers[k] ?? null }, json: async () => ({ elements: [] }) });

// Same decision logic as world-poi.js update(): rate limit + backoff gate, one attempt at a time, the user keeps panning.
async function simulate(status, { secs = 60, headers = {}, newViewEvery = 0 } = {}) {
  let now = 0, last = -1e9, reqs = 0, toasts = 0, view = 'a';
  const gate = new Backoff();
  const fetchFn = async () => { reqs++; return resp(status, headers); };
  for (let t = 0; t <= secs * 1000; t += 100) {
    now = t;
    if (newViewEvery && t % newViewEvery === 0) view = 'v' + t;
    const w = Math.max(rateWait(last, now), gate.wait(now, view));
    if (w) continue;
    last = now;
    try { await overpassAttempt('q', { fetchFn, now: () => now }); gate.ok(); }
    catch (e) { const f = gate.fail(now, e.retryAfter || 0); if (f.toast) toasts++; }
  }
  return { reqs, toasts };
}

test('P1-1: 429 for 60 s → ≤5 requests, ≤5 toasts', async () => {
  const r = await simulate(429); assert.ok(r.reqs <= 5, `reqs ${r.reqs}`); assert.ok(r.toasts <= r.reqs);
});
test('P1-1: 504 for 60 s → ≤5 requests even while the view keeps changing', async () => {
  const r = await simulate(504, { newViewEvery: 700 }); assert.ok(r.reqs <= 5, `reqs ${r.reqs}`);
});
test('P1-1: Retry-After is honoured', async () => {
  const r = await simulate(429, { headers: { 'Retry-After': '120' } }); assert.equal(r.reqs, 1);
  assert.equal(retryAfterMs('30'), 30000); assert.equal(retryAfterMs(new Date(10000).toUTCString(), 0), 10000); assert.equal(retryAfterMs(null), 0);
});
test('P1-1: exponential backoff 4 s → 8 s → 16 s … capped at 5 min; attempts capped per view and session', () => {
  const g = new Backoff({ viewTries: 99, sessionFails: 99 }); const w = [];
  for (let i = 0; i < 10; i++) w.push(g.fail(0).wait);
  assert.deepEqual(w.slice(0, 4), [4000, 8000, 16000, 32000]); assert.equal(Math.max(...w), BACKOFF_MAX);
  const v = new Backoff(); for (let i = 0; i < 4; i++) v.fail(0);
  assert.equal(v.wait(1e9, ''), Infinity, 'view cap');
  const s = new Backoff(); for (let i = 0; i < 8; i++) { s.wait(1e9, 'v' + i); s.fail(0); }
  assert.equal(s.wait(1e10, 'new'), Infinity, 'session cap'); s.reset(); assert.equal(s.wait(1e10, 'new'), 0);
});
test('P1-1: toast at most once per backoff period', () => {
  const g = new Backoff(); assert.equal(g.fail(0).toast, true); assert.equal(g.fail(1000).toast, false);
});
test('P1-1: one attempt tries each endpoint at most once; 429 stops the attempt', async () => {
  let n = 0; await assert.rejects(overpassAttempt('q', { fetchFn: async () => { n++; return resp(500); } })); assert.equal(n, OVERPASS_GET.length);
  n = 0; await assert.rejects(overpassAttempt('q', { fetchFn: async () => { n++; return resp(429); } })); assert.equal(n, 1);
  const urls = []; const r = await overpassAttempt('q', { start: 1, fetchFn: async u => { urls.push(u); return urls.length < 2 ? resp(502) : resp(200); } });
  assert.equal(r.ep, 2); assert.ok(urls[0].startsWith(OVERPASS_GET[1]));
});
test('P1-1: world-poi.js uses the backoff gate', () => {
  const s = read('js/world-poi.js'); assert.match(s, /new Backoff\(\)/); assert.match(s, /overpassAttempt/); assert.match(s, /gate\.fail/);
});

// ---- P1-2: settlement ranking from Damascus ----
const DAM = [36.29, 33.51], VIEW = [36.2, 33.45, 36.4, 33.57], BOX = biasBox(DAM, VIEW);
const S = (name, place, lon, lat, extra = {}) => ({ name, lon, lat, cc: 'sy', tags: { place }, ...extra });
const cases = [
  ['حلب', 'حلب', [S('حلبون', 'village', 36.25, 33.66), S('حلبا', 'town', 36.6, 33.9), S('حلب', 'city', 37.16, 36.2)]],
  ['Aleppo', 'Aleppo', [S('Aleppo Village', 'village', 36.3, 33.6), S('Aleppo', 'city', 37.16, 36.2)]],
  ['الرقة', 'الرقة', [S('الرقة الصغيرة', 'village', 36.1, 33.3), S('الرقة', 'city', 39.01, 35.95)]],
  ['Raqqa', 'Raqqa', [S('Raqqa Farms', 'village', 36.1, 33.3), S('Raqqa', 'city', 39.01, 35.95)]],
  ['دير الزور', 'دير الزور', [S('دير الزور الجديدة', 'village', 36.4, 33.4), S('دير الزور', 'city', 40.14, 35.33)]],
  ['Deir ez-Zor', 'Deir ez-Zor', [S('Deir ez-Zor Camp', 'village', 36.4, 33.4), S('Deir ez-Zor', 'city', 40.14, 35.33)]],
];
for (const [q, want, list] of cases) test(`P1-2: "${q}" from Damascus → ${want} (city) first`, () => {
  const r = rank([{ name: 'شارع ' + q, lon: 36.3, lat: 33.5, tags: { highway: 'residential' } }, ...list], q, BOX);
  assert.equal(r.settlements[0].name, want); assert.equal(r.settlements[0].tags.place, 'city');
});
test('P1-2: proximity still breaks ties between equal settlements', () => {
  const r = rank([S('Tell', 'village', 40, 36), S('Tell', 'village', 36.3, 33.5)], 'Tell', BOX);
  assert.equal(r.settlements[0].lon, 36.3);
});

// ---- P2: names ----
test('P2: POI with only name:ar gets a label in EN/DE (n610464643 محطة العلي)', () => {
  const tags = { 'name:ar': 'محطة العلي', amenity: 'fuel' };
  for (const l of ['en', 'de', 'ar']) assert.equal(pickNameFor(tags, l).primary, 'محطة العلي', l);
  for (const l of ['en', 'de']) { const e = labelExpression(l).slice(1).map(x => x[1]); assert.ok(e.indexOf('name:ar') > e.indexOf('name') && e.indexOf('name:ar') < e.indexOf('brand'), l); }
  assert.equal(pickNameFor({ 'name:ar': 'ع', brand: 'B' }, 'en').primary, 'ع');
  assert.equal(pickNameFor({ name: 'N', 'name:ar': 'ع' }, 'en').primary, 'N');
});
test('P2: bundled POIs keep the name:ar/name:en fallback; brand-only Photon hit titled with the brand', () => {
  assert.match(read('js/poi.js'), /if \(!name && \(ar \|\| en\)\) props\.name = ar \|\| en/);
  assert.match(read('js/poi.js'), /if \(!tags\.name && \(rec\.ar \|\| rec\.en\)\) tags\.name = rec\.ar \|\| rec\.en/);
  assert.match(read('js/search.js'), /name: p\.name \|\| p\.brand \|\| sub/);
});
// ---- P3 ----
test('P3: world POI layers are added above poi-transit', () => {
  const s = read('js/world-poi.js'); const line = s.split('\n').find(l => /const before =/.test(l)); assert.doesNotMatch(line, /poi-transit/);
});
test('P3: voice suite uses free ports (no fixed PORT+1 clash)', () => {
  const s = read('tests/voice/voice.test.js'); assert.match(s, /process\.env\.PORT \|\| 0/); assert.match(s, /address\(\)\.port/);
});

// ---- QA round 2: cross-script exact place matches in every UI language ----
// Items as search.js/fromPhoton builds them: Photon returns one name per hit (EN/DE UI: localized, AR UI: local name).
const P = (name, place, lon, lat, extra = {}) => ({ name, lon, lat, tags: { place }, ...extra });
const POI = (name, lon, lat, k = 'amenity', v = 'bus_station') => ({ name, lon, lat, tags: { [k]: v } });
const IST = [28.97, 41.01], IST_BOX = biasBox(IST, [28.9, 40.95, 29.05, 41.07]);
const r2 = [
  // [ui, query, box, list, expected first]
  ['en', 'حلب', BOX, [POI('طرق دمشق حلب', 36.3, 33.52), P('Aleppo', 'city', 37.16, 36.2)], 'Aleppo'],
  ['de', 'حلب', BOX, [POI('طرق دمشق حلب', 36.3, 33.52), P('Aleppo', 'city', 37.16, 36.2)], 'Aleppo'],
  ['en', 'الرقة', BOX, [POI('بيت اهل ابواسماعيل', 36.3, 33.5, 'building', 'house'), P('Raqqa', 'city', 39.01, 35.95)], 'Raqqa'],
  ['de', 'الرقة', BOX, [POI('بيت اهل ابواسماعيل', 36.3, 33.5, 'building', 'house'), P('Rakka', 'city', 39.01, 35.95)], 'Rakka'],
  ['en', 'دير الزور', BOX, [P('Deir Atiyah', 'town', 36.76, 34.09, { placeHit: true }), P('Deir ez-Zor', 'city', 40.14, 35.33)], 'Deir ez-Zor'],
  ['de', 'دير الزور', BOX, [P('Deir Atiyah', 'town', 36.76, 34.09, { placeHit: true }), P('Deir ez-Zor', 'city', 40.14, 35.33)], 'Deir ez-Zor'],
  ['ar', 'Aleppo', BOX, [POI('Bus to Aleppo', 36.3, 33.52), P('حلب', 'city', 37.16, 36.2)], 'حلب'],
  ['ar', 'Berlin', IST_BOX, [POI('Berlitz language center', 28.98, 41.02, 'amenity', 'language_school'), P('Berlin', 'city', 13.39, 52.52)], 'Berlin'],
  ['de', 'Raqqa', BOX, [POI('Raqqa Museum', 39.0, 35.95, 'tourism', 'museum'), P('Rakka', 'city', 39.01, 35.95)], 'Rakka'],
];
for (const [ui, q, box, list, want] of r2) test(`QA2 (${ui} UI): "${q}" → ${want} first`, () => {
  const r = rank(list, q, box); const first = [...r.settlements, ...r.rest][0];
  assert.equal(first.name, want);
});
test('QA2: Photon city boundary relations count as places (Berlin)', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ features: [{ type: 'Feature', geometry: { coordinates: [13.4, 52.5] }, properties: { osm_type: 'R', osm_id: 62422, osm_key: 'boundary', osm_value: 'administrative', type: 'city', name: 'Berlin' } }] }) });
  try { const { photonSearch } = await import('../../js/suggest.js'); const f = await photonSearch('Berlin', { center: IST }); assert.equal(f[0].properties.osm_key, 'place'); assert.equal(f[0].properties.osm_value, 'city'); }
  finally { globalThis.fetch = orig; }
});
test('QA2: toast once per failure series; Retry-After CORS caveat documented', () => {
  const g = new Backoff(); const t = []; for (let i = 0; i < 6; i++) t.push(g.fail(i * 400000).toast);
  assert.deepEqual(t, [true, false, false, false, false, false]); g.ok(); assert.equal(g.fail(0).toast, true);
  assert.match(read('js/world-core.js'), /Access-Control-Expose-Headers/);
});
