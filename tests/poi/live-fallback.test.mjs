// Category live path with every Overpass mirror down (Hidro, Bad Godesberg, live 20261106-1756). Pure Node, stubbed
// network only – never calls Overpass / Nominatim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { raceBox, liveCategory, liveOutcome, LIVE_OP_TIMEOUT, LIVE_NOM_DELAY, LIVE_DEADLINE } from '../../js/live-core.js';
import { EN, AR, DE } from './_i18n-load.mjs';

const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const never = () => new Promise(() => {});
const after = (ms, v, fail) => new Promise((res, rej) => setTimeout(() => fail ? rej(new Error(v)) : res(v), ms));
const nomHits = { elements: [{ type: 'node', id: 1, lat: 50.69, lon: 7.15, tags: { amenity: 'restaurant', name: 'Palmyra' } }] };
const boxes = [[50.6, 7.1, 50.7, 7.2], [50.5, 7.0, 50.8, 7.3], [50.4, 6.9, 50.9, 7.4]];

test('Overpass hangs → Nominatim answer wins after the short head start', async () => {
  const t0 = Date.now();
  const r = await raceBox(never, () => nomHits, { nomDelay: 20 });
  assert.equal(r.src, 'nominatim'); assert.equal(r.elements[0].tags.name, 'Palmyra');
  assert.ok(Date.now() - t0 < 500);
});
test('Overpass 504 on every mirror → Nominatim at once, opDown sticky for wider boxes', async () => {
  let opCalls = 0, nomCalls = 0;
  const r = await liveCategory(boxes, () => { opCalls++; return Promise.reject(new Error('HTTP 504')); }, () => { nomCalls++; return nomCalls < 3 ? { elements: [] } : nomHits; }, { nomDelay: 5000, deadline: 2000 });
  assert.equal(r.src, 'nominatim'); assert.equal(opCalls, 1, 'wider radii skip Overpass'); assert.equal(nomCalls, 3);
});
test('Overpass answers → authoritative (even if empty → next radius)', async () => {
  const r = await raceBox(() => ({ elements: [{ id: 9 }] }), never, { nomDelay: 1000 });
  assert.equal(r.src, 'overpass');
});
test('everything hangs → deadline rejects (sheet then shows tiles or honesty + retry, never skeleton)', async () => {
  await assert.rejects(liveCategory(boxes, never, never, { nomDelay: 5, deadline: 60 }), e => e.deadline === true);
});
test('both fail → rejects', async () => {
  await assert.rejects(raceBox(() => after(5, 'x', true), () => after(5, 'y', true), { nomDelay: 1 }));
});
test('stale (user tapped another chip) → stale error, no sheet', async () => {
  await assert.rejects(liveCategory(boxes, () => ({ elements: [] }), () => ({ elements: [] }), { isStale: () => true, deadline: 500 }), e => e.stale);
});
test('outcome states', () => {
  assert.equal(liveOutcome({ live: [1], tiles: 3 }), 'live');
  assert.equal(liveOutcome({ failed: true, tiles: 2 }), 'tiles-down');
  assert.equal(liveOutcome({ failed: true }), 'down');
  assert.equal(liveOutcome({ live: [] }), 'empty');
});
test('timings are short (no 9 s × mirrors wait before a fallback)', () => {
  assert.ok(LIVE_OP_TIMEOUT <= 6000 && LIVE_NOM_DELAY <= 1500 && LIVE_DEADLINE <= 15000);
});
test('search.js: tile hits shown before live answer, fit=false, retry wired, no Syria fit', () => {
  const s = read('js/search.js'), f = s.slice(s.indexOf('export async function searchCategoryLive'), s.indexOf('\n}\n', s.indexOf('export async function searchCategoryLive')));
  assert.ok(f.indexOf('const tr0 = tileRes()') < f.indexOf('await liveCategory'), 'tiles before awaiting live');
  for (const m of f.matchAll(/showResultList\(([^;]*)/g)) assert.match(m[1], /,\s*false/, 'fit=false on every live list: ' + m[1]);
  assert.doesNotMatch(f, /fitTo\(|easeTo\(|flyTo\(/);
  assert.match(f, /id="retryCat"/); assert.match(f, /catLiveDown/);
  assert.match(s, /export const CHIP_MIN_Z = 12/);
});
test('new copy keys in EN/AR/DE', () => {
  for (const k of ['catLiveWait', 'catTileOnly', 'catLiveDown', 'tryAgain']) for (const [n, d] of Object.entries({ EN, AR, DE })) assert.ok(d[k] && typeof d[k] === 'string', `${n}.${k}`);
});
test('no non-OSM geocoder in live-core / search', () => {
  const s = read('js/live-core.js') + read('js/search.js');
  assert.doesNotMatch(s, /google|mapbox|here\.com|bing\.com|apple\.com/i);
});
