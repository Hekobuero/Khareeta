// P1: "Café" + Enter in Berlin listed Syrian "Kafr…" villages (fuzzy gazetteer hits) and zoomed to z2.6.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gateByView, fitTargets, GZ_FAR_MIN } from '../../js/search-core.js';

const BERLIN = [13.405, 52.52], DAMASCUS = [36.2919, 33.5132];
const kafat = { name: 'Al-Kafat', lon: 36.6, lat: 35.1, score: 92 }, qef = { name: 'Qefeilun', lon: 36.4, lat: 35.6, score: 89 };
const homs = { name: 'Homs', lon: 36.7167, lat: 34.7333, score: 130 }, hosh = { name: 'Hosh Sahya', lon: 36.35, lat: 33.45, score: 88 };

test('far fuzzy gazetteer hits are dropped (Café≈Kafr from Berlin)', () => {
  assert.deepEqual(gateByView([kafat, qef], BERLIN), []);
});
test('real names stay findable anywhere and rank before fuzzy near hits', () => {
  assert.ok(homs.score >= GZ_FAR_MIN && kafat.score < GZ_FAR_MIN);
  assert.deepEqual(gateByView([hosh, homs], DAMASCUS).map(x => x.name), ['Homs', 'Hosh Sahya']);
  assert.deepEqual(gateByView([homs], BERLIN).map(x => x.name), ['Homs']);
});
test('only results near the view may drive the camera', () => {
  const near = { lon: 13.41, lat: 52.521 };
  assert.deepEqual(fitTargets([near, kafat, homs], BERLIN), [near]);
  assert.deepEqual(fitTargets([kafat, qef], BERLIN), []);
});
test('search.js: pure category word → chip path, fit never below z12, gazetteer gated', () => {
  const S = readFileSync(new URL('../../js/search.js', import.meta.url), 'utf8');
  assert.match(S, /lr\.chip && \(lr\.pure \|\| !lr\.items\.length\)/);
  assert.match(S, /fitTargets\(res, center\(\)\)/);
  assert.match(S, /minZoom: CHIP_MIN_Z/);
  assert.match(S, /gateByView\(gz0, c\)/);
  assert.match(S, /gateByView\(loc0\.places, c\)/);
});
