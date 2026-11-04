// World names + worldwide search/POIs. Run: node --test 'tests/world/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickNameFor, labelExpression, nameChain } from '../../js/names.js';
import { cellsFor, cellsBox, worldQuery, elementToFeature, rateWait, CellCache, viewInSyria, overpassGetUrl, WORLD_MIN_ZOOM, MAX_CELLS } from '../../js/world-core.js';
import { poiCatFor, poiLayerSpec } from '../../js/poi.js';
import { rank, biasBox, biasPoint, countryTier, photonSearch } from '../../js/suggest.js';

const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('name fallback: AR prefers name:ar, then name, name:en, brand', () => {
  assert.equal(pickNameFor({ 'name:ar': 'دمشق', name: 'Damascus' }, 'ar').primary, 'دمشق');
  assert.equal(pickNameFor({ name: 'Rewe', 'name:en': 'Rewe EN' }, 'ar').primary, 'Rewe');
  assert.equal(pickNameFor({ 'name:en': 'Only EN' }, 'ar').primary, 'Only EN');
  assert.equal(pickNameFor({ brand: 'Lidl', shop: 'supermarket' }, 'ar').primary, 'Lidl');
});
test('name fallback: EN/DE prefer name:<lang> → name:en → name → brand', () => {
  assert.equal(pickNameFor({ 'name:de': 'Damaskus', 'name:en': 'Damascus', name: 'دمشق' }, 'de').primary, 'Damaskus');
  assert.equal(pickNameFor({ 'name:en': 'Damascus', name: 'دمشق' }, 'de').primary, 'Damascus');
  assert.equal(pickNameFor({ name: 'Bäckerei Schmidt' }, 'en').primary, 'Bäckerei Schmidt');
  assert.equal(pickNameFor({ brand: 'dm' }, 'de').primary, 'dm');
  assert.equal(pickNameFor({ brand: 'dm' }, 'en').primary, 'dm');
  assert.equal(pickNameFor({}, 'en').primary, '');
  assert.equal(pickNameFor({ name: 'شام', 'name:en': 'Sham' }, 'en').secondary, 'شام');
});
test('label expressions never require name:ar and end at brand', () => {
  for (const l of ['ar', 'en', 'de']) {
    const e = labelExpression(l); assert.equal(e[0], 'coalesce');
    assert.deepEqual(e.at(-1), ['get', 'brand']); assert.ok(e.some(x => x[1] === 'name'));
  }
  assert.deepEqual(nameChain('ar').slice(0, 2), ['name:ar', 'name']);
  assert.equal(nameChain('de')[0], 'name:de'); assert.equal(nameChain('en')[0], 'name:en');
});
test('POI layer text-field uses the fallback chain (brand-only shops get a label)', () => {
  const fake = { getLayer: () => null };
  const spec = poiLayerSpec(fake, false, 'x')('id', 14, ['==', 1, 1], 0.8, 15);
  assert.equal(spec.layout['text-field'][0], 'step');
  assert.deepEqual(spec.layout['text-field'][4].at(-1), ['get', 'brand']);
});
test('map-i18n keeps the zoom step of POI layers when relabelling', () => {
  assert.match(read('js/map-i18n.js'), /current\[0\] === 'step'/);
});
test('bundled POIs: brand-only rows count as named and are searchable', () => {
  const s = read('js/poi.js');
  assert.match(s, /named = !!\(name \|\| ar \|\| en \|\| brand\)/);
  assert.match(s, /tokens\(r\.brand\)/);
});
test('poiCatFor maps OSM tags of foreign shops', () => {
  assert.equal(poiCatFor({ shop: 'supermarket', brand: 'Lidl' }).c, 'grocery');
  assert.equal(poiCatFor({ amenity: 'cafe' }).c, 'cafe');
  assert.equal(poiCatFor({ tourism: 'hotel' }).c, 'hotel');
  assert.equal(poiCatFor({ highway: 'bus_stop' }), null);
});
test('world cells: bounded, nearest first, Syria cells skipped', () => {
  const berlin = [13.37, 52.50, 13.43, 52.53];
  const c = cellsFor(berlin); assert.ok(c.length > 0 && c.length <= MAX_CELLS);
  const big = cellsFor([0, 0, 2, 2]); assert.equal(big.length, MAX_CELLS);
  assert.equal(cellsFor([36.28, 33.50, 36.32, 33.53]).length, 0); // Damascus → offline data
  assert.ok(viewInSyria([36.28, 33.50, 36.32, 33.53])); assert.ok(!viewInSyria(berlin));
  const b = cellsBox(c); assert.ok(b[0] <= 52.50 && b[2] >= 52.53 && b[1] <= 13.37 && b[3] >= 13.43);
  assert.ok(WORLD_MIN_ZOOM >= 13);
});
test('world query: name OR brand, no name:ar, no country area', () => {
  const q = worldQuery([52.5, 13.36, 52.54, 13.44]);
  assert.match(q, /\["brand"\]\[!"name"\]/); assert.match(q, /\["name"\]/);
  assert.doesNotMatch(q, /name:ar|area\[|ISO3166/);
  assert.match(overpassGetUrl(q), /^https:\/\/overpass-api\.de\/api\/interpreter\?data=/);
});
test('elementToFeature keeps brand-only POIs', () => {
  const f = elementToFeature({ type: 'node', id: 7, lat: 52.5, lon: 13.4, tags: { shop: 'chemist', brand: 'dm' } }, poiCatFor);
  assert.equal(f.properties.brand, 'dm'); assert.equal(f.properties.wid, 'n7');
  assert.equal(elementToFeature({ type: 'way', id: 1, tags: { shop: 'x' } }, poiCatFor), null);
});
test('rate limit and LRU cache', () => {
  assert.equal(rateWait(1000, 2000, 4000), 3000); assert.equal(rateWait(0, 9000, 4000), 0);
  const c = new CellCache(2); c.set('a', []); c.set('b', []); c.set('c', []);
  assert.ok(!c.has('a') && c.has('b') && c.has('c'));
});
test('search bias follows the map view worldwide', () => {
  assert.deepEqual(biasPoint([13.4, 52.5], 12), { lon: 13.4, lat: 52.5, zoom: 12 });
  const box = biasBox([13.4, 52.5], [13.3, 52.4, 13.5, 52.6]);
  assert.ok(box[0] <= 11.9 && box[2] >= 14.9);
  assert.equal(countryTier('de', 13.4, 52.5, box), 0); assert.equal(countryTier('sy', 36.3, 33.5, box), 1);
  const r = rank([{ name: 'Far', cc: 'sy', lon: 36.3, lat: 33.5, tags: {} }, { name: 'Near', cc: 'de', lon: 13.4, lat: 52.5, tags: {} }], 'x', box);
  assert.deepEqual(r.rest.map(x => x.name), ['Near', 'Far']);
  const s = rank([{ name: 'Berlin', cc: 'de', lon: 13.4, lat: 52.5, tags: { place: 'city' } }], 'Berlin', box);
  assert.equal(s.settlements.length, 1); // non-Syrian cities are no longer dropped
});
test('Photon requests have no country limit and use the view region', async () => {
  const urls = []; const orig = globalThis.fetch;
  globalThis.fetch = async u => { urls.push(String(u)); return new Response(JSON.stringify({ features: [] }), { headers: { 'Content-Type': 'application/json' } }); };
  try { await photonSearch('Rewe', { center: [13.4, 52.5], zoom: 13, view: [13.3, 52.4, 13.5, 52.6] }); } finally { globalThis.fetch = orig; }
  assert.equal(urls.length, 3);
  for (const u of urls) { assert.doesNotMatch(u, /countrycode|35\.6,32\.3,42\.4,37\.4/); }
  assert.ok(urls.some(u => /lat=52\.5000&lon=13\.4000/.test(u)));
});
test('no country limits or paid providers in app code', () => {
  for (const f of ['js/search.js', 'js/suggest.js', 'js/route.js', 'js/app.js', 'js/world-poi.js', 'js/world-core.js', 'js/place.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /countrycodes=|maxBounds/, f);
    assert.doesNotMatch(s, /googleapis|api\.mapbox|hereapi|virtualearth|bing\.com\/maps|apple-mapkit|access_token|api_key=/i, f);
  }
  assert.doesNotMatch(read('js/search.js'), /SY_BBOX/);
});
test('new modules are in the SW shell and world POIs are cached with a size limit', () => {
  const sw = read('sw.js');
  for (const f of ['js/names.js', 'js/world-core.js', 'js/world-poi.js']) assert.ok(sw.includes(`'${f}'`), f);
  assert.match(sw, /WPOI_MAX = \d+/); assert.match(sw, /isWorldPoi\(u\)/);
});
test('new UI texts exist in EN, AR and DE', () => {
  const s = read('js/i18n.js');
  for (const k of ['worldPoiZoom', 'worldPoiBusy', 'worldPoiLiveHint', 'cPlacesWorld']) assert.equal(s.split(k + ':').length - 1, 3, k);
});
