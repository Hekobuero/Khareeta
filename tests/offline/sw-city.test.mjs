// Service worker + city packs: city downloads never write kh-tiles; Delete/Cancel purge the city's tiles.
// Loads the real sw.js in a vm with in-memory Cache Storage. Run: node --test 'tests/offline/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CITIES, cityTiles, tileUrl, markCity, unmarkCity, purgeCity, downloadAll } from '../../js/cities.js';
import { tileKey } from './tilekey.mjs';

const TPL = 'https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf';
function memCaches() {
  const store = new Map(), writes = [];
  const open = async n => { if (!store.has(n)) store.set(n, new Map()); const m = store.get(n), k = r => typeof r === 'string' ? r : r.url;
    return { match: async r => m.get(k(r))?.clone(), put: async (r, v) => { writes.push([n, k(r)]); m.set(k(r), v); }, delete: async r => m.delete(k(r)), keys: async () => [...m.keys()].map(url => ({ url })) }; };
  return { store, writes, open, keys: async () => [...store.keys()], delete: async n => store.delete(n),
    match: async (r, o = {}) => { for (const [n, m] of store) if (!o.cacheName || o.cacheName === n) { const v = m.get(typeof r === 'string' ? r : r.url); if (v) return v.clone(); } } };
}
function loadSw() {
  const caches = memCaches(), fetched = [], listeners = {};
  const fetch = async (u) => { fetched.push(typeof u === 'string' ? u : u.url); return new Response(new Uint8Array(1000), { status: 200, headers: { 'Content-Type': 'application/x-protobuf' } }); };
  const self = { addEventListener: (t, f) => (listeners[t] = f), registration: { scope: 'https://khareeta.app/' }, skipWaiting() {}, clients: { claim() {} } };
  const ctx = { self, caches, fetch, Response, Request, URL, navigator: { onLine: true }, location: new URL('https://khareeta.app/'), setTimeout, console, Date, Promise, encodeURIComponent };
  vm.runInNewContext(readFileSync(new URL('../../sw.js', import.meta.url), 'utf8'), ctx);
  const fire = async url => { let p; listeners.fetch({ request: new Request(url), respondWith: x => (p = x), waitUntil() {} }); const r = await p; await new Promise(r => setTimeout(r, 5)); return r; };
  return { caches, fetched, fire };
}

test('marker round-trip keeps the cache key equal to the normal tile URL', () => {
  const u = tileUrl(TPL, [14, 9843, 6571]);
  assert.equal(unmarkCity(markCity(u)), u);
  assert.equal(unmarkCity(markCity(u + '?a=1')), u + '?a=1');
});
test('SW: marked city download goes to the network unmarked, nothing is cached by the SW', async () => {
  const sw = loadSw();
  const u = tileUrl(TPL, [14, 9843, 6571]);
  const r = await sw.fire(markCity(u));
  assert.equal(r.status, 200);
  assert.deepEqual(sw.fetched, [u]);
  assert.deepEqual(sw.caches.writes, []);
  const g = 'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf';
  await sw.fire(markCity(g)); assert.deepEqual(sw.caches.writes, []);
});
test('SW: a normal map tile request still lands in kh-tiles (sanity)', async () => {
  const sw = loadSw();
  await sw.fire(tileUrl(TPL, [14, 9843, 6571]));
  assert.ok(sw.caches.writes.some(([n]) => n === 'kh-tiles'));
});
test('full Homs download through the SW: only kh-city-homs is written, keys are unmarked', async () => {
  const sw = loadSw(), homs = CITIES.find(c => c.id === 'homs');
  const cache = await sw.caches.open('kh-city-homs');
  const urls = cityTiles(homs).map(x => tileUrl(TPL, x));
  const fetchFn = (u) => sw.fire(u); // the page's fetch is intercepted by the SW
  const res = await downloadAll(urls, { fetchFn, cache, keyOf: tileKey, sleep: async () => {}, pause: 0 });
  assert.equal(res.fail, 0);
  assert.ok(sw.caches.writes.every(([n]) => n === 'kh-city-homs'), JSON.stringify(sw.caches.writes.find(([n]) => n !== 'kh-city-homs')));
  assert.equal(sw.caches.writes.length, urls.length);
  assert.ok(sw.caches.writes.every(([, k]) => !k.includes('kh-city=1') && k.includes('/planet/_/')));
  assert.equal(sw.caches.store.get('kh-tiles'), undefined);
});
test('Delete/Cancel: city cache gone and its tiles purged from kh-tiles, other tiles kept', async () => {
  const c = memCaches(), homs = CITIES.find(x => x.id === 'homs');
  const keys = cityTiles(homs).map(x => tileKey(tileUrl(TPL, x)));
  const city = await c.open('kh-city-homs'), tiles = await c.open('kh-tiles');
  for (const k of keys) { await city.put(k, new Response('x')); await tiles.put(k, new Response('x')); }
  const other = tileKey(tileUrl(TPL, [14, 9843, 6534])); await tiles.put(other, new Response('x'));
  await purgeCity(c, 'homs', keys);
  assert.equal(c.store.has('kh-city-homs'), false);
  assert.deepEqual([...c.store.get('kh-tiles').keys()], [other]);
});
test('UI: city buttons ≥ 44px, OpenFreeMap info text via i18n with real concurrency', () => {
  const css = readFileSync(new URL('../../css/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.srow\.city \.act\{[^}]*min-height:44px/);
  const off = readFileSync(new URL('../../js/offline.js', import.meta.url), 'utf8');
  assert.doesNotMatch(off, /<small>OpenFreeMap: [^<]*parallel/);
  assert.match(off, /t\('ofmPolicy', \{[^}]*c: nf\(CONCURRENCY\)/);
  assert.equal((readFileSync(new URL('../../js/i18n.js', import.meta.url), 'utf8').match(/ofmPolicy: '/g) || []).length, 3);
});
