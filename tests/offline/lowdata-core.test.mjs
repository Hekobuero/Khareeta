// Datensparmodus / data-saver core (js/lowdata-core.js). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  saveDataOn, resolveLowData, allowMapExtras, allowPlaceExtras, allowStylePrefetch,
} from '../../js/lowdata-core.js';

const rd = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('saveDataOn reads navigator.connection.saveData safely', () => {
  assert.equal(saveDataOn(undefined), false);
  assert.equal(saveDataOn({}), false);
  assert.equal(saveDataOn({ connection: null }), false);
  assert.equal(saveDataOn({ connection: { saveData: true } }), true);
  assert.equal(saveDataOn({ connection: { saveData: false } }), false);
  assert.equal(saveDataOn({ get connection() { throw new Error('no'); } }), false);
});

test('resolveLowData: explicit user choice wins over Save-Data', () => {
  assert.equal(resolveLowData({ lowData: false }, { connection: { saveData: true } }), false);
  assert.equal(resolveLowData({ lowData: true }, { connection: { saveData: false } }), true);
});

test('resolveLowData: absent key defaults to Save-Data', () => {
  assert.equal(resolveLowData({}, { connection: { saveData: true } }), true);
  assert.equal(resolveLowData({}, { connection: { saveData: false } }), false);
  assert.equal(resolveLowData(null, { connection: { saveData: true } }), true);
  assert.equal(resolveLowData({ mapLang: 'ar' }, { connection: { saveData: true } }), true);
});

test('allow* gates flip with settings.lowData', () => {
  assert.equal(allowMapExtras({ lowData: false }), true);
  assert.equal(allowMapExtras({ lowData: true }), false);
  assert.equal(allowPlaceExtras({ lowData: true }), false);
  assert.equal(allowStylePrefetch({ lowData: true }), false);
  assert.equal(allowStylePrefetch({ lowData: false }), true);
});

test('wiring: util resolves lowData, mapstyle/place gate extras, SW precaches core', () => {
  const util = rd('js/util.js'), map = rd('js/mapstyle.js'), place = rd('js/place.js');
  const ui = rd('js/ui.js'), app = rd('js/app.js'), sw = rd('sw.js'), html = rd('index.html');
  assert.match(util, /resolveLowData/);
  assert.match(util, /hasOwnProperty\.call\(_stored, 'lowData'\)/);
  assert.match(map, /allowMapExtras\(settings\)/);
  assert.match(map, /allowStylePrefetch\(settings\)/);
  assert.match(place, /allowPlaceExtras\(settings\)/);
  assert.match(place, /if \(allowPlaceExtras\(settings\)\) jobs\.push\(weather/);
  assert.match(ui, /track\('low_data'/);
  assert.match(app, /lowDataState/);
  assert.match(app, /syncLowDataPill/);
  assert.ok(sw.includes("'js/lowdata-core.js'"));
  assert.match(html, /id="lowDataState"/);
});

test('new UI strings exist in en/ar/de (no raw keys)', () => {
  const src = rd('js/i18n.js');
  for (const k of ['lowData', 'lowDataOn', 'lowDataHint', 'lowDataOnToast', 'lowDataOffToast'])
    assert.equal((src.match(new RegExp('\\b' + k + ':', 'g')) || []).length, 3, k);
});

test('relative paths only in lowdata-core (no network)', () => {
  const s = rd('js/lowdata-core.js');
  assert.ok(!/https?:\/\//.test(s));
  assert.ok(!/\bfetch\s*\(/.test(s));
});
