// Overture shops layer: data format, licence/privacy rules and the pure helpers in js/overture-data.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { socialLink, normPhone, website } from '../../js/links.js';
import { tilesFor, ovActive, ovItem, ovFeature, ovCatLabel, OV_BBOX } from '../../js/overture-data.js';

const DIR = new URL('../../data/overture/', import.meta.url);
const ix = JSON.parse(readFileSync(new URL('index.json', DIR)));
const tiles = Object.fromEntries(Object.keys(ix.tiles).map(k => [k, JSON.parse(readFileSync(new URL(`t${k}.json`, DIR)))]));
const rows = Object.values(tiles).flatMap(t => t.f);

test('index matches tile files', () => {
  const files = readdirSync(DIR).filter(f => /^t.*\.json$/.test(f)).map(f => f.slice(1, -5)).sort();
  assert.deepEqual(files, Object.keys(ix.tiles).sort());
  for (const [k, t] of Object.entries(tiles)) { assert.equal(t.dv, ix.dv); assert.equal(t.f.length, ix.tiles[k]); }
  assert.equal(rows.length, ix.rows);
  assert.ok(rows.length > 1000);
  assert.equal(ix.groups.length, ix.cats.length);
});
test('total size stays small (< 3 MB)', () => {
  const b = readdirSync(DIR).reduce((s, f) => s + statSync(new URL(f, DIR)).size, 0);
  assert.ok(b < 3e6, `${b} bytes`);
});
test('rows: inside Syria, in their tile, valid shape', () => {
  for (const [k, t] of Object.entries(tiles)) {
    const [x, y] = k.split('_').map(Number);
    for (const r of t.f) {
      assert.ok(r.length >= 4 && r.length <= 8);
      const [lon, lat, name, ci] = r;
      assert.ok(lon >= OV_BBOX[0] && lon <= OV_BBOX[2] && lat >= OV_BBOX[1] && lat <= OV_BBOX[3]);
      assert.equal(Math.floor(lon * 10), x); assert.equal(Math.floor(lat * 10), y);
      assert.ok(typeof name === 'string' && name.length > 0);
      assert.ok(Number.isInteger(ci) && ix.cats[ci]);
    }
  }
});
test('privacy & licence: no e-mail addresses, no Foursquare, licence file present', () => {
  const all = readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => readFileSync(new URL(f, DIR), 'utf8')).join('\n');
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(all.replace(/https?:\/\/[^"]+/g, '')), 'no e-mail');
  assert.ok(!/foursquare|fsq/i.test(all.replace(/Foursquare records excluded/, '').replace(/https?:\/\/[^"]+/g, '')), 'no Foursquare source ids');
  assert.match(readFileSync(new URL('LICENSE.txt', DIR), 'utf8'), /CDLA-Permissive-2\.0/);
  assert.match(ix.source, /Overture Maps Foundation/);
});
test('no non-business categories', () => {
  for (const c of ix.cats) assert.ok(!/religious|worship|government|monument|landmark|historic|museum|mountain|castle|airport/.test(c) && c !== 'park', c);
});
test('links pass js/links.js validation', () => {
  let bad = 0, n = 0;
  for (const r of rows) {
    if (r[4]) { n++; if (!normPhone(r[4])) bad++; }
    if (r[6]) { n++; if (!socialLink('facebook', r[6])) bad++; }
    if (r[7]) { n++; if (!socialLink('instagram', r[7])) bad++; }
    if (r[5]) assert.match(r[5], /^https?:\/\//i);
  }
  assert.ok(bad / n < 0.02, `${bad}/${n} invalid`); // the sheet drops the rest via links.js
});
test('tilesFor / ovActive', () => {
  const dam = [36.27, 33.5, 36.32, 33.53];
  const ks = tilesFor(dam, ix);
  assert.ok(ks.includes('362_335'));
  assert.deepEqual(tilesFor([13.3, 52.5, 13.5, 52.6], ix), []);
  assert.ok(tilesFor([35, 32, 43, 38], ix).length <= 40);
  assert.equal(ovActive(true, 14, dam), true);
  assert.equal(ovActive(true, 13.9, dam), false);
  assert.equal(ovActive(false, 16, dam), false);
  assert.equal(ovActive(true, 16, [13.3, 52.5, 13.5, 52.6]), false);
});
test('ovItem builds an unverified, OSM-free place item', () => {
  const r = rows.find(r => r[4] && r[6]);
  const it = ovItem(r, ix, 'k');
  assert.equal(it.ov, true); assert.equal(it.full, true); assert.equal(it.osm_type, undefined);
  assert.equal(it.tags.phone, r[4]); assert.equal(it.tags['contact:facebook'], r[6]);
  assert.ok(!('email' in it.tags));
  const f = ovFeature(r, ix, 7);
  assert.deepEqual(f.geometry.coordinates, [r[0], r[1]]); assert.equal(f.properties.i, 7);
  assert.equal(website({ website: 'javascript:alert(1)' }), null);
});
test('category labels in EN/AR/DE', () => {
  assert.equal(ovCatLabel('restaurant', 'ar'), 'مطعم');
  assert.equal(ovCatLabel('dental_clinic', 'de'), 'Zahnarztpraxis');
  assert.equal(ovCatLabel('some_new_thing', 'en'), 'Some new thing');
});
test('i18n strings exist in all languages', async () => {
  const src = readFileSync(new URL('../../js/i18n.js', import.meta.url), 'utf8');
  for (const k of ['ovLayer', 'ovUnverified', 'ovAttr', 'ovAddOsm', 'cOverture']) assert.equal(src.split(k + ':').length - 1, 3, k);
});
