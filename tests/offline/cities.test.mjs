// Whole-city offline packs. Run: node --test 'tests/offline/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CITIES, cityTiles, tilesInBbox, estimateCityBytes, quotaOk, downloadAll, tileUrl, cityName, ZMAX, CONCURRENCY } from '../../js/cities.js';
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('three cities with names in EN/AR/DE and bboxes inside Syria', () => {
  assert.deepEqual(CITIES.map(c => c.id), ['damascus', 'aleppo', 'homs']);
  for (const c of CITIES) {
    for (const l of ['en', 'ar', 'de']) assert.ok(cityName(c, l));
    const [w, s, e, n] = c.bbox; assert.ok(w < e && s < n && w > 35.5 && e < 42.5 && s > 32.3 && n < 37.4);
  }
  assert.equal(cityName(CITIES[0], 'ar'), 'دمشق');
});
test('tile lists: z5–z14 only, no duplicates, small enough for fair use', () => {
  for (const c of CITIES) {
    const t = cityTiles(c), keys = new Set(t.map(x => x.join('/')));
    assert.equal(keys.size, t.length);
    assert.ok(t.every(([z]) => z >= 5 && z <= ZMAX));
    assert.ok(t.length > 50 && t.length < 1000, c.id + ' ' + t.length);
  }
  assert.deepEqual(tilesInBbox([36.29, 33.51, 36.29, 33.51], 14, 14), [[14, 9843, 6571]]); // Umayyad Mosque
});
test('estimates are plausible and ordered (Damascus ≥ Aleppo > Homs)', () => {
  const mb = CITIES.map(c => estimateCityBytes(c) / 1048576);
  mb.forEach(v => assert.ok(v > 3 && v < 60));
  assert.ok(mb[0] >= mb[1] && mb[1] > mb[2]);
});
test('quota check keeps headroom; unknown quota allows', () => {
  assert.equal(quotaOk(undefined, 1e7), true);
  assert.equal(quotaOk({ quota: 1e9, usage: 0 }, 1e7), true);
  assert.equal(quotaOk({ quota: 3e7, usage: 1e7 }, 1e7), false);
});
const mkCache = () => { const m = new Map(); return { m, match: async k => m.get(k), put: async (k, v) => { m.set(k, v); } }; };
const ok = () => new Response(new Uint8Array(100), { status: 200 });
test('downloader: concurrency limit, skip cached, 404 as empty, retry 429', async () => {
  const cache = mkCache(); await cache.put('u0', ok());
  let inflight = 0, max = 0, calls = {};
  const fetchFn = async u => { inflight++; max = Math.max(max, inflight); await new Promise(r => setTimeout(r, 2)); inflight--; calls[u] = (calls[u] || 0) + 1;
    if (u === 'u3') return new Response(null, { status: 404 }); if (u === 'u4' && calls[u] < 2) return new Response(null, { status: 429 }); return ok(); };
  const urls = Array.from({ length: 10 }, (_, i) => 'u' + i);
  const r = await downloadAll(urls, { fetchFn, cache, sleep: async () => {} });
  assert.ok(max <= CONCURRENCY);
  assert.equal(calls.u0, undefined); assert.equal(calls.u4, 2);
  assert.equal(r.empty, 1); assert.equal(r.fail, 0); assert.equal(r.bytes, 800); assert.equal(cache.m.size, 9);
});
test('downloader: abort stops early', async () => {
  const ctl = new AbortController(), cache = mkCache(); let n = 0;
  const r = await downloadAll(Array.from({ length: 50 }, (_, i) => 'u' + i), { fetchFn: async () => { if (++n === 5) ctl.abort(); return ok(); }, cache, signal: ctl.signal, sleep: async () => {} });
  assert.equal(r.aborted, true); assert.ok(n < 10);
});
test('only OpenFreeMap / open services, no keys; SW serves city caches', () => {
  const src = read('js/cities.js') + read('js/offline.js');
  assert.doesNotMatch(src, /google|mapbox\.com|here\.com|bing|apple\.com|api[_-]?key|access_token/i);
  assert.equal(tileUrl('https://tiles.openfreemap.org/planet/v/{z}/{x}/{y}.pbf', [1, 2, 3]), 'https://tiles.openfreemap.org/planet/v/1/2/3.pbf');
  const sw = read('sw.js');
  assert.match(sw, /kh-city-/); assert.match(sw, /'js\/cities\.js'/);
});
test('i18n: new strings in EN, AR and DE', () => {
  const s = read('js/i18n.js');
  for (const k of ['cities', 'cityDl', 'cityDel', 'cancel', 'quotaLow', 'cityDone']) assert.equal((s.match(new RegExp(`\\b${k}: '`, 'g')) || []).length, 3, k);
});
