// Worldwide tile POIs: style bands, Syria dedupe, sprite coverage, tile → OSM tags, category merge. Pure Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { patch, BANDS, SY_POLY } from '../../tools/poi/style-poi.mjs';
import { SY_BBOX } from '../../js/world-core.js';
import { labelExpression } from '../../js/names.js';
import { tileTags, tileOsm, tileMatchesChip, tileCategoryItems, mergeTileItems, TILE_POI_LAYERS } from '../../js/tile-poi.js';

const root = new URL('../../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');
const styles = { light: JSON.parse(read('map-style-light.json')), dark: JSON.parse(read('map-style-dark.json')) };
const poiLayers = s => s.layers.filter(l => l['source-layer'] === 'poi');
const get = (s, id) => s.layers.find(l => l.id === id);
const rankOf = f => (f.find(x => Array.isArray(x) && x[0] === '<=' && x[1]?.[1] === 'rank') || [])[2];
// all string outputs of an icon-image expression (match / case)
function outputs(e, out = new Set()) {
  if (typeof e === 'string') { out.add(e); return out; }
  if (!Array.isArray(e)) return out;
  if (e[0] === 'match') { for (let i = 3; i < e.length - 1; i += 2) outputs(e[i], out); outputs(e[e.length - 1], out); }
  else if (e[0] === 'case') { for (let i = 2; i < e.length - 1; i += 2) outputs(e[i], out); outputs(e[e.length - 1], out); }
  return out;
}

for (const [theme, s] of Object.entries(styles)) {
  test(`${theme}: POI bands z14 rank≤10 / z15 rank≤25 / z16+ all`, () => {
    const ids = poiLayers(s).map(l => l.id);
    assert.deepEqual(ids, ['poi-dot', 'poi-z15', 'poi', 'poi-transit']);
    const [a, b, c] = ['poi-dot', 'poi-z15', 'poi'].map(id => get(s, id));
    assert.equal(a.minzoom, 14); assert.equal(a.maxzoom, 15); assert.equal(rankOf(a.filter), 10);
    assert.equal(b.minzoom, 15); assert.equal(b.maxzoom, 16); assert.equal(rankOf(b.filter), 25);
    assert.equal(c.minzoom, 16); assert.equal(c.maxzoom, undefined); assert.equal(rankOf(c.filter), undefined);
    for (const l of [a, b, c]) assert.deepEqual(l.layout['symbol-sort-key'], ['get', 'rank']);
    assert.ok(s.sources.openmaptiles.url.includes('openfreemap.org') || JSON.stringify(s.sources.openmaptiles).includes('openfreemap'));
  });
  test(`${theme}: labels only from z15, via labelExpression + khareeta:label`, () => {
    assert.equal(get(s, 'poi-dot').layout['text-field'], undefined);
    for (const id of ['poi-z15', 'poi']) {
      const l = get(s, id);
      assert.deepEqual(l.layout['text-field'], labelExpression('en'));
      assert.equal(l.metadata['khareeta:label'], true);
      assert.ok(l.paint['text-color'] && l.paint['text-halo-color']);
    }
    // AR chain: Arabic first, then the original name
    assert.deepEqual(labelExpression('ar').slice(1, 3), [['get', 'name:ar'], ['get', 'name']]);
  });
  test(`${theme}: tile POIs are hidden inside SY_BBOX (own GeoJSON there)`, () => {
    for (const l of TILE_POI_LAYERS.map(id => get(s, id))) {
      const w = l.filter.find(x => Array.isArray(x) && x[0] === '!' && x[1][0] === 'within');
      assert.ok(w, l.id);
      const ring = w[1][1].coordinates[0];
      assert.deepEqual(ring[0], [SY_BBOX[0], SY_BBOX[1]]); assert.deepEqual(ring[2], [SY_BBOX[2], SY_BBOX[3]]);
      assert.ok(JSON.stringify(l.filter).includes('"has","name"'));
    }
  });
  test(`${theme}: every icon the POI layers can ask for exists in the sprite (1x/2x/3x)`, () => {
    for (const sfx of ['', '@2x', '@3x']) {
      const sp = JSON.parse(read(`sprites/khareeta-${theme}${sfx}.json`));
      for (const l of poiLayers(s)) for (const n of outputs(l.layout['icon-image'])) assert.ok(sp[n], `${l.id}: ${n} missing in ${theme}${sfx}`);
      for (const n of ['government', 'embassy', 'school', 'doctor', 'bank', 'mosque', 'church', 'pharmacy', 'town_hall']) assert.ok(sp[n], n);
      const r = sfx ? +sfx[1] : 1; assert.equal(sp.government.width, 22 * r); assert.equal(sp.government.pixelRatio, r);
    }
  });
  test(`${theme}: icon mapping for offices, worship by religion, clinics`, () => {
    const e = get(s, 'poi').layout['icon-image'];
    assert.equal(e[0], 'case');
    assert.deepEqual(e[2], ['match', ['get', 'subclass'], 'government', 'government', 'diplomatic', 'embassy', 'generic']);
    assert.deepEqual(e[4], ['match', ['get', 'subclass'], 'muslim', 'mosque', 'christian', 'church', 'worship']);
    assert.equal(e[6], 'doctor');
  });
  test(`${theme}: patch is idempotent and the rest of the style is untouched`, () => {
    const again = patch(JSON.parse(JSON.stringify(s)));
    assert.deepEqual(again, s);
    assert.ok(s.layers.length > 50);
  });
}
test('attribution of the tile source stays (OSM / OpenFreeMap / OpenMapTiles)', () => {
  const html = read('index.html') + read('js/app.js') + read('js/mapstyle.js') + JSON.stringify(styles.light.sources);
  assert.match(html, /OpenStreetMap/);
});
test('no Google / Mapbox / HERE / Bing / Apple endpoints and no API keys in the new code', () => {
  const src = read('js/tile-poi.js') + read('tools/poi/style-poi.mjs') + JSON.stringify(styles.light.sources) + JSON.stringify(styles.dark.sources);
  assert.doesNotMatch(src, /googleapis|maps\.google|api\.mapbox|mapbox\.com|hereapi|virtualearth|bing\.com|apple\.com|access_token|api_key|apikey/i);
  assert.equal(styles.light.sprite, './sprites/khareeta-light'); assert.equal(styles.dark.sprite, './sprites/khareeta-dark');
});
test('app: tile POIs open the sheet, the automatic Overpass layer is off, nav hides tile POIs, SW precaches tile-poi.js', () => {
  const app = read('js/app.js'), poi = read('js/poi.js'), sw = read('sw.js'), core = read('js/core.js');
  assert.match(app, /tileTags\(p\)/); assert.match(app, /tileOsm\(f\.id\)/);
  assert.doesNotMatch(app, /initWorldPois\(|addWorldLayers\(/);
  assert.doesNotMatch(poi, /for \(const id of \['poi', 'poi-dot'\]\) if \(map\.getLayer\(id\)\) map\.setLayoutProperty\(id, 'visibility', 'none'\)/);
  assert.match(poi, /\.\.\.TILE_POI_LAYERS/);
  assert.match(core, /'poi', 'poi-z15', 'poi-dot'/);
  assert.match(sw, /'js\/tile-poi\.js'/);
});

test('tileTags: OpenMapTiles class/subclass → OSM tags', () => {
  assert.deepEqual(tileTags({ class: 'place_of_worship', subclass: 'muslim', name: 'X', 'name:ar': 'س' }), { name: 'X', 'name:ar': 'س', amenity: 'place_of_worship', religion: 'muslim' });
  assert.equal(tileTags({ class: 'office', subclass: 'government', name: 'Amt' }).office, 'government');
  assert.equal(tileTags({ class: 'lodging', subclass: 'hotel', name: 'H' }).tourism, 'hotel');
  assert.equal(tileTags({ class: 'clothing_store', subclass: 'clothes', name: 'C' }).shop, 'clothes');
  assert.equal(tileTags({ class: 'grocery', subclass: 'supermarket', name: 'S' }).shop, 'supermarket');
  assert.equal(tileTags({ class: 'pharmacy', subclass: 'pharmacy', name: 'P' }).amenity, 'pharmacy');
  assert.equal(tileTags({ class: 'hospital', subclass: 'clinic', name: 'K' }).amenity, 'clinic');
  assert.equal(tileTags({ class: 'town_hall', subclass: 'town_hall', name: 'R' }).amenity, 'townhall');
  assert.equal(tileTags({ class: 'park', subclass: 'park', name: 'G' }).leisure, 'park');
  assert.equal(tileTags({ class: 'castle', subclass: 'castle', name: 'B' }).historic, 'castle');
  assert.equal(tileTags({ class: 'bank', subclass: 'bank', name: 'B' }).amenity, 'bank');
  assert.equal(tileTags({}).amenity, '');
});
test('tileOsm: OpenFreeMap feature ids', () => {
  assert.deepEqual(tileOsm(1234561), { osm_type: 'node', osm_id: 123456 });
  assert.deepEqual(tileOsm('982'), { osm_type: 'way', osm_id: 98 });
  assert.deepEqual(tileOsm(73), { osm_type: 'relation', osm_id: 7 });
  assert.equal(tileOsm(70), null); assert.equal(tileOsm(undefined), null); assert.equal(tileOsm(-11), null);
});
test('tileMatchesChip', () => {
  assert.ok(tileMatchesChip('pharmacy', { class: 'pharmacy', subclass: 'pharmacy', name: 'A' }));
  assert.ok(tileMatchesChip('mosque', { class: 'place_of_worship', subclass: 'muslim', name: 'A' }));
  assert.ok(!tileMatchesChip('mosque', { class: 'place_of_worship', subclass: 'christian', name: 'A' }));
  assert.ok(tileMatchesChip('church', { class: 'place_of_worship', subclass: 'christian', name: 'A' }));
  assert.ok(tileMatchesChip('atm', { class: 'bank', subclass: 'bank', name: 'A' }));
  assert.ok(tileMatchesChip('hospital', { class: 'doctors', subclass: 'doctors', name: 'A' }));
  assert.ok(!tileMatchesChip('pharmacy', { class: 'pharmacy', subclass: 'pharmacy' }), 'unnamed');
  assert.ok(!tileMatchesChip('nope', { class: 'pharmacy', name: 'A' }));
});
const F = (id, lon, lat, p) => ({ id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name: 'N' + id, ...p } });
test('tileCategoryItems: filter, Syria skip, box, dedupe tile copies, sort by distance', () => {
  const ref = [13.405, 52.52];
  const fs_ = [
    F(11, 13.41, 52.52, { class: 'pharmacy', subclass: 'pharmacy' }),
    F(11, 13.41, 52.52, { class: 'pharmacy', subclass: 'pharmacy' }),           // same tile feature from a neighbour tile
    F(21, 13.406, 52.52, { class: 'pharmacy', subclass: 'pharmacy' }),
    { ...F(31, 13.40601, 52.52, { class: 'pharmacy', subclass: 'pharmacy' }), properties: { name: 'N21', class: 'pharmacy', subclass: 'pharmacy' } }, // same name 1 m away
    F(41, 13.5, 52.52, { class: 'cafe', subclass: 'cafe' }),
    F(51, 36.29, 33.51, { class: 'pharmacy', subclass: 'pharmacy' }),            // Damascus → bundled data
    F(61, 14.5, 52.52, { class: 'pharmacy', subclass: 'pharmacy' }),             // outside the box
    { id: 71, geometry: { type: 'Polygon', coordinates: [] }, properties: { name: 'x', class: 'pharmacy' } },
  ];
  const r = tileCategoryItems(fs_, 'pharmacy', ref, t => t.name, 100, [13.3, 52.4, 13.6, 52.6]);
  assert.deepEqual(r.map(x => x.name), ['N21', 'N11']);
  assert.equal(r[0].osm_type, 'node'); assert.equal(r[0].osm_id, 2); assert.equal(r[0].id, 'N2'); assert.ok(r[0].tile);
  assert.ok(r[0].d < r[1].d);
  assert.equal(tileCategoryItems(fs_, 'pharmacy', ref).length, 3);
  assert.deepEqual(tileCategoryItems(null, 'pharmacy', ref), []);
});
test('mergeTileItems: live wins, tile adds the rest, sorted', () => {
  const live = [{ id: 'N2', name: 'A', lon: 13.4, lat: 52.5, tags: { name: 'A' }, d: 50 }, { id: 'W9', name: 'B', lon: 13.41, lat: 52.5, tags: { name: 'B' }, d: 400 }];
  const tile = [{ id: 'N2', name: 'A', lon: 13.4, lat: 52.5, tags: { name: 'A' }, d: 50 }, { id: 'N5', name: 'B', lon: 13.4101, lat: 52.5, tags: { name: 'B' }, d: 401 }, { id: 'N7', name: 'C', lon: 13.42, lat: 52.5, tags: { name: 'C' }, d: 200 }];
  assert.deepEqual(mergeTileItems(live, tile).map(x => x.id), ['N2', 'N7', 'W9']);
  assert.deepEqual(mergeTileItems([], tile).map(x => x.id), ['N2', 'N7', 'N5']);
});
test('BANDS / SY_POLY exports', () => {
  assert.equal(BANDS.length, 3); assert.equal(SY_POLY.coordinates[0].length, 5);
});
// style-spec validation when the design tool deps are available locally (not needed in CI)
test('style validates against the MapLibre style spec (if installed)', async t => {
  let spec; try { spec = createRequire(import.meta.url)('@maplibre/maplibre-gl-style-spec'); } catch { t.skip('style-spec not installed'); return; }
  for (const s of Object.values(styles)) { const errs = spec.validateStyleMin(s); assert.deepEqual(errs.map(e => e.message), []); }
});
