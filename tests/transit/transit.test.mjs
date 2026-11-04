// Transit lines: pure helpers (js/transit-core.js), committed data files, SW + i18n wiring. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { normT, tName, tAlt, lineLabel, shortRef, searchLines, sortLines, linesAtStop, stopCounts, linesGeoJSON, stopsGeoJSON, lineBounds, cityFor, osmUrl, TRANSIT_CITIES } from '../../js/transit-core.js';

const root = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const D = {
  stops: [{ id: 1, c: [36.3, 33.5], name: 'باب توما', name_en: 'Bab Touma' }, { id: 2, c: [36.31, 33.51], name_ar: 'المزة' }, { id: 3, c: [36.2, 33.4] }],
  lines: [
    { id: 10, mode: 'share_taxi', ref: '12', name: 'مزة - باب توما', name_en: 'Mezzeh - Bab Touma', from: 'المزة', to: 'باب توما', stops: [1, 0], geom: [[[36.3, 33.5], [36.31, 33.51]]] },
    { id: 11, mode: 'bus', ref: '2', name_ar: 'خط الجامعة', stops: [0], geom: [] },
    { id: 12, mode: 'minibus', stops: [], geom: [[[36.1, 33.3], [36.2, 33.4]]] },
  ],
};

test('normT folds Arabic variants, digits and punctuation', () => {
  assert.equal(normT('أَحْمَد'), 'احمد');
  assert.equal(normT('مدرسة'), 'مدرسه');
  assert.equal(normT('١٢'), '12');
  assert.equal(normT('  Bab-Touma '), 'bab touma');
});
test('names follow the UI language with fallbacks', () => {
  assert.equal(tName(D.lines[0], 'en'), 'Mezzeh - Bab Touma');
  assert.equal(tName(D.lines[0], 'ar'), 'مزة - باب توما');
  assert.equal(tName(D.lines[1], 'de'), 'خط الجامعة');
  assert.equal(tAlt(D.stops[0], 'en'), 'باب توما');
  assert.equal(lineLabel(D.lines[2], 'en'), '');
  assert.equal(lineLabel({ id: 7, ref: 'Mezzeh Jabal - Karajat' }, 'en'), 'Mezzeh Jabal - Karajat');
  assert.equal(lineLabel({ id: 8, ref: '12' }, 'en'), '');
  assert.equal(shortRef('12'), '12'); assert.equal(shortRef('B 104'), 'B 104'); assert.equal(shortRef('1 الدائري الجنوبي'), ''); assert.equal(shortRef(''), '');
  assert.equal(lineLabel({ id: 1, from: 'A', to: 'B' }, 'en'), 'A → B');
});
test('search by ref, name, from/to and stop name; exact ref first', () => {
  assert.deepEqual(searchLines(D, '12').map(l => l.id), [10]);
  assert.deepEqual(searchLines(D, 'bab touma').map(l => l.id).sort(), [10, 11]);
  assert.deepEqual(searchLines(D, 'الجامعه').map(l => l.id), [11]);
  assert.deepEqual(searchLines(D, 'مزه').map(l => l.id), [10]);
  assert.equal(searchLines(D, '').length, 3);
  assert.equal(searchLines(D, 'zzz').length, 0);
  assert.deepEqual(sortLines(D.lines).map(l => l.ref || ''), ['2', '12', '']);
});
test('stop → lines index and counts', () => {
  assert.deepEqual(linesAtStop(D, 0).map(l => l.id), [10, 11]);
  assert.deepEqual(stopCounts(D), [2, 1, 0]);
});
test('GeoJSON: lines with geometry only; stops served only (or the given subset)', () => {
  const g = linesGeoJSON(D); assert.equal(g.features.length, 2); assert.equal(g.features[0].geometry.type, 'MultiLineString');
  assert.equal(stopsGeoJSON(D).features.length, 2);
  assert.deepEqual(stopsGeoJSON(D, [1]).features.map(f => f.properties.i), [1]);
  assert.deepEqual(lineBounds(D.lines[0], D), [[36.3, 33.5], [36.31, 33.51]]);
  assert.equal(lineBounds({ geom: [], stops: [] }, D), null);
});
test('cityFor picks the nearest city bbox, null far away', () => {
  const ix = { cities: { damascus: { bbox: [36.12, 33.36, 36.48, 33.62] }, aleppo: { bbox: [37.02, 36.1, 37.3, 36.3] } } };
  assert.equal(cityFor(36.29, 33.51, ix), 'damascus');
  assert.equal(cityFor(37.15, 36.2, ix), 'aleppo');
  assert.equal(cityFor(13.4, 52.5, ix), null);
  assert.equal(osmUrl('relation', '5'), 'https://www.openstreetmap.org/relation/5');
});
test('committed data files: OSM only, consistent references, compact', () => {
  const ix = JSON.parse(read('data/transit/index.json'));
  assert.equal(ix.source, 'OpenStreetMap');
  for (const c of TRANSIT_CITIES) {
    assert.ok(ix.cities[c], c);
    const raw = read(`data/transit/${c}.json`), d = JSON.parse(raw);
    assert.equal(d.source, 'OpenStreetMap'); assert.match(d.attribution, /OpenStreetMap contributors/); assert.equal(d.license, 'ODbL 1.0');
    assert.equal(d.counts.routes, d.lines.length); assert.equal(d.counts.stops, d.stops.length);
    assert.equal(ix.cities[c].routes, d.lines.length);
    assert.ok(raw.length < 3_000_000, `${c} too large: ${raw.length}`);
    for (const l of d.lines) {
      assert.ok(Number.isInteger(l.id) && l.id > 0);
      assert.ok(['bus', 'share_taxi', 'minibus'].includes(l.mode), l.mode);
      for (const i of l.stops) assert.ok(d.stops[i], `stop ${i}`);
      for (const g of l.geom) for (const [x, y] of g) assert.ok(x > 35 && x < 43 && y > 32 && y < 38);
    }
  }
});
test('wiring: SW precaches + caches transit, i18n EN/AR/DE, layer off by default, no third-party map APIs', async () => {
  const sw = read('sw.js');
  assert.match(sw, /'js\/transit\.js'/); assert.match(sw, /'js\/transit-core\.js'/); assert.match(sw, /isTransit\(url\.pathname\)/);
  assert.match(read('js/util.js'), /transit: false/);
  const { t, setLang } = await import('../../js/i18n.js').catch(() => ({}));
  if (t && setLang) {
    globalThis.localStorage ??= { getItem() { return null; }, setItem() {} };
    globalThis.document ??= { documentElement: { lang: '', dir: '' } };
    for (const l of ['en', 'ar', 'de']) { setLang(l); for (const k of ['trLayer', 'trSrc', 'trImprove', 'trStops', 'trAtStop', 'trEmpty']) assert.notEqual(t(k), k, `${l}.${k}`); }
  }
  const src = read('js/transit.js') + read('js/transit-core.js') + read('scripts/transit/build_transit.py');
  assert.doesNotMatch(src, /google|mapbox\.com|here\.com|bing|apple\.com|api[_-]?key/i);
  assert.ok(existsSync(new URL('CNAME', root)));
});

test('city buttons use UI-language names (EN/AR/DE)', async () => {
  const { S } = await import('../../js/i18n.js').catch(() => ({}));
  const src = read('js/i18n.js');
  for (const [k, v] of [['trC_damascus', 'Damascus'], ['trC_damascus', 'دمشق'], ['trC_damascus', 'Damaskus'], ['trC_aleppo', 'Aleppo'], ['trC_aleppo', 'حلب']]) assert.ok(src.includes(`${k}: "${v}"`), k + v);
  assert.match(read('js/transit.js'), /const k = 'trC_' \+ c, v = t\(k\)/);
});

test('P3: Arabic stop plurals via Intl.PluralRules; list sheet hides the pill; desktop fitLine symmetric', () => {
  const i18n = read('js/i18n.js'), tr = read('js/transit.js');
  const ar = i18n.split('\n').find(l => l.includes('trC_aleppo: "حلب"'));
  const form = (n, lang, line) => { const c = new Intl.PluralRules(lang).select(n); const m = line.match(new RegExp(`trStopsN_${c}: "([^"]+)"`)) || line.match(/trStopsN_other: "([^"]+)"/); return m[1].replace('{n}', n); };
  assert.equal(form(13, 'ar', ar), '13 موقفًا'); assert.equal(form(1, 'ar', ar), 'موقف واحد'); assert.equal(form(2, 'ar', ar), 'موقفان');
  assert.equal(form(5, 'ar', ar), '5 مواقف'); assert.equal(form(100, 'ar', ar), '100 موقف');
  const de = i18n.split('\n').find(l => l.includes('trOpenList: "Linien zeigen"')); assert.equal(form(1, 'de', de), '1 Haltestelle'); assert.equal(form(7, 'de', de), '7 Haltestellen');
  assert.match(tr, /new Intl\.PluralRules\(lang\)/); assert.doesNotMatch(tr, /\$\{l\.stops\.length\} \$\{t\('trStops'\)\}/);
  assert.match(tr, /openSheet\(html, 'half', trSheetClosed\);\n\s*document\.body\.classList\.add\('tr-line-open'\)/);
  assert.match(tr, /if \(desktop\(\)\) \{ const map = App\.map, c = map\.getPadding\(\), e = 60; fitTo\(bb, \{ top: c\.top \+ e, bottom: c\.bottom \+ e, left: c\.left \+ e, right: c\.right \+ e \}/);
});

test('polish: city download caches transit, unnamed label in EN/AR/DE, no "#id" titles, short-ref badge', () => {
  const rd = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const off = rd('js/offline.js'), tr = rd('js/transit.js'), i18n = rd('js/i18n.js'), css = rd('css/app.css');
  assert.match(off, /if \(!res\.aborted\) await cacheTransit\(city\.id\)/);
  assert.match(off, /caches?Api\.open\('kh-transit'\)|cacheApi\.open\('kh-transit'\)/);
  assert.equal(i18n.split('trNoName: ').length - 1, 3);
  assert.ok(!/'#' \+ l\.id/.test(rd('js/transit-core.js')));
  assert.match(tr, /badgeRef\(l\.ref\) \|\|/);
  assert.match(css, /\.tr-ref\{max-width:64px;[^}]*text-overflow:ellipsis/);
  for (const c of TRANSIT_CITIES) for (const l of JSON.parse(rd(`data/transit/${c}.json`)).lines) assert.ok(l.geom.some(g => g.length > 1), `${c} ${l.id} has a path`);
});

test('polish 2: number badge, city fit centre, purge transit, empty lines dropped', async () => {
  const core = await import('../../js/transit-core.js');
  assert.equal(core.badgeRef('1 الدائري الجنوبي'), '1');
  assert.equal(core.badgeRef('12'), '12');
  assert.equal(core.badgeRef('Mezzeh Jabal - Karajat'), '');
  assert.equal(core.badgeRef('1234567 x'), '');
  const fb = core.cityFitBounds('damascus', [36.12, 33.36, 36.48, 33.62]);
  assert.ok(Math.abs((fb[0][0] + fb[1][0]) / 2 - 36.3065) < 1e-9 && Math.abs((fb[0][1] + fb[1][1]) / 2 - 33.5115) < 1e-9);
  const { purgeCity } = await import('../../js/cities.js');
  const deleted = []; const mk = keys => ({ delete: async k => { deleted.push(k.url || k); return true; }, keys: async () => keys.map(url => ({ url })) });
  const api = { delete: async () => true, open: async n => n === 'kh-transit' ? mk(['https://x/data/transit/index.json', 'https://x/data/transit/aleppo.json', 'https://x/data/transit/damascus.json']) : mk([]) };
  await purgeCity(api, 'aleppo', []);
  assert.deepEqual(deleted, ['https://x/data/transit/aleppo.json']);
  const fs = await import('node:fs');
  for (const c of ['damascus', 'aleppo']) {
    const d = JSON.parse(fs.readFileSync(new URL(`../../data/transit/${c}.json`, import.meta.url)));
    for (const l of d.lines) assert.ok(l.name || l.name_ar || l.name_en || (l.stops || []).length, `${c} ${l.id}`);
  }
  assert.match(fs.readFileSync(new URL('../../js/transit.js', import.meta.url), 'utf8'), /fitArea\(cityFitBounds/);
});
