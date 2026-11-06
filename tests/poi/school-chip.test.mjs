// Schools category chip: CATS / CHIP_CATS / WORDS / tile match / i18n. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATS } from '../../js/search.js';
import { CHIP_CATS, searchLocal, P } from '../../js/poi.js';
import { tileMatchesChip } from '../../js/tile-poi.js';

const root = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');

test('CATS includes school chip (key, icon, civic colour, edu Overpass)', () => {
  const row = CATS.find(c => c[0] === 'school');
  assert.ok(row, 'school missing from CATS');
  assert.equal(row[1], 'school');
  assert.equal(row[2], CATS.find(c => c[0] === 'police')[2], 'same civic colour as police');
  assert.match(row[3], /school\|kindergarten\|university\|college/);
  const keys = CATS.map(c => c[0]);
  assert.ok(keys.indexOf('police') < keys.indexOf('school'));
  assert.ok(keys.indexOf('school') < keys.indexOf('toilets'));
});

test('CHIP_CATS.school maps to bundled edu category', () => {
  assert.deepEqual(CHIP_CATS.school, ['edu']);
});

test('renderChips uses t(k) so school reuses existing i18n key', () => {
  const S = read('js/search.js');
  assert.match(S, /\$\{esc\(t\(k\)\)\}/);
  assert.doesNotMatch(S, /t\('schools'\)|t\("schools"\)/);
});

test('i18n school key: EN / AR / DE (no raw key)', async () => {
  globalThis.document ??= { documentElement: { lang: '', dir: '', setAttribute() {} } };
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  const { t, setLang } = await import('../../js/i18n.js');
  for (const [l, want] of [['en', 'Schools'], ['ar', 'مدارس'], ['de', 'Schulen']]) {
    setLang(l);
    assert.equal(t('school'), want, l);
    assert.notEqual(t('school'), 'school');
  }
});

test('WORDS / searchLocal: EN AR DE category words → school chip + edu POIs', () => {
  const prev = P.all;
  P.all = [
    { lon: 36.3, lat: 33.51, c: 'edu', s: 'school', osm: 'n1', name: 'مدرسة النموذجية', ar: 'مدرسة النموذجية', en: 'Model School', brand: '', tok: null },
    { lon: 36.31, lat: 33.52, c: 'edu', s: 'university', osm: 'n2', name: 'جامعة دمشق', ar: 'جامعة دمشق', en: 'Damascus University', brand: '', tok: null },
    { lon: 36.29, lat: 33.50, c: 'food', s: 'restaurant', osm: 'n3', name: 'مطعم', ar: 'مطعم', en: 'Restaurant', brand: '', tok: null },
  ];
  try {
    const ref = [36.2919, 33.5132];
    for (const q of ['school', 'schools', 'kindergarten', 'university', 'college', 'مدرسة', 'مدارس', 'روضة', 'جامعة', 'كلية', 'schule', 'schulen', 'universität', 'hochschule']) {
      const r = searchLocal(q, ref, 6);
      assert.equal(r.chip, 'school', q);
      assert.ok(r.pure, q + ' should be pure category');
      assert.ok(r.items.every(i => i.c === 'edu'), q);
      assert.ok(r.items.length >= 1, q);
    }
    // non-edu word must not activate school
    assert.notEqual(searchLocal('restaurant', ref).chip, 'school');
  } finally {
    P.all = prev;
  }
});

test('tileMatchesChip school covers school/kindergarten/university/college', () => {
  assert.ok(tileMatchesChip('school', { class: 'school', subclass: 'school', name: 'A' }));
  assert.ok(tileMatchesChip('school', { class: 'college', subclass: 'college', name: 'B' }));
  assert.ok(tileMatchesChip('school', { class: 'university', subclass: 'university', name: 'C' }));
  assert.ok(tileMatchesChip('school', { class: 'kindergarten', subclass: 'kindergarten', name: 'D' }));
  assert.ok(!tileMatchesChip('school', { class: 'school', subclass: 'school' }), 'unnamed');
  assert.ok(!tileMatchesChip('school', { class: 'pharmacy', subclass: 'pharmacy', name: 'P' }));
});

test('CNAME stays khareeta.app; no API keys in school wiring', () => {
  assert.equal(read('CNAME').trim(), 'khareeta.app');
  const src = read('js/search.js') + read('js/poi.js') + read('js/tile-poi.js');
  assert.doesNotMatch(src, /googleapis|maps\.google|api\.mapbox|mapbox\.com|hereapi|virtualearth|bing\.com|access_token|api_key|apikey/i);
});
