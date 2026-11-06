// Printable map/route export (js/map-export-core.js). No network, no MapLibre, no Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAP_EXPORT_I18N, PRINT_ATTR, buildPrintHtml, normalizePrintMeta, safeMapDataUrl, printFilename, escHtml,
} from '../../js/map-export-core.js';

const rd = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('MAP_EXPORT_I18N keys match across en/ar/de', () => {
  for (const l of ['ar', 'de'])
    assert.deepEqual(Object.keys(MAP_EXPORT_I18N[l]).sort(), Object.keys(MAP_EXPORT_I18N.en).sort(), l);
  assert.equal(MAP_EXPORT_I18N.de.mapExportPrintShort, 'PDF');
  assert.equal(MAP_EXPORT_I18N.ar.mapExportPrintShort, 'PDF');
});

test('normalizePrintMeta route + place', () => {
  const r = normalizePrintMeta({
    kind: 'route', from: 'Damascus', to: 'Aleppo', via: ['Homs', ''], modeLabel: 'Auto',
    durationLabel: '4 h', distanceLabel: '350 km',
    steps: [{ text: 'Nach der Moschee rechts', distLabel: '120 m' }, { text: '' }],
  }, 'de');
  assert.equal(r.kind, 'route');
  assert.deepEqual(r.via, ['Homs']);
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].text, 'Nach der Moschee rechts');
  const p = normalizePrintMeta({ kind: 'place', name: 'Café', address: 'Damascus', lat: 1, lon: 2, coords: '1, 2' }, 'en');
  assert.equal(p.kind, 'place');
  assert.equal(p.name, 'Café');
});

test('safeMapDataUrl rejects remote / short / scripty', () => {
  assert.equal(safeMapDataUrl('https://evil.example/x.png'), '');
  assert.equal(safeMapDataUrl('data:text/html;base64,aaa'), '');
  assert.equal(safeMapDataUrl('data:image/png;base64,short'), '');
  assert.ok(safeMapDataUrl(tinyPng).startsWith('data:image/png'));
});

test('buildPrintHtml: attribution, steps, RTL, no external URLs, no auto network', () => {
  const html = buildPrintHtml({
    lang: 'de',
    autoPrint: false,
    mapDataUrl: tinyPng,
    meta: {
      kind: 'route',
      from: 'Damaskus',
      to: 'Aleppo',
      via: ['Homs'],
      modeLabel: 'Auto',
      durationLabel: '4 Std.',
      distanceLabel: '350 km',
      steps: [
        { text: 'Nach der Omari-Moschee rechts abbiegen', distLabel: '120 m' },
        { text: 'Ziel erreicht' },
      ],
    },
  });
  assert.match(html, /OpenStreetMap/);
  assert.match(html, /OpenFreeMap/);
  assert.match(html, /Nach der Omari-Moschee/);
  assert.match(html, /Damaskus/);
  assert.match(html, /dir="ltr"/); // de
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /google|mapbox|here\.com|bing|googleapis|gstatic/i);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.ok(html.includes(PRINT_ATTR) || html.includes('© OpenStreetMap'));
  assert.doesNotMatch(html, /try\{print\(\)\}/);

  const ar = buildPrintHtml({
    lang: 'ar', autoPrint: false, noMap: true,
    meta: { kind: 'route', from: 'دمشق', to: 'حلب', steps: [{ text: 'انعطف يمينًا' }] },
  });
  assert.match(ar, /dir="rtl"/);
  assert.match(ar, /انعطف يمينًا/);
  assert.match(ar, /غير متاحة دون اتصال|mapExportNoMap|الخريطة/);
});

test('buildPrintHtml autoPrint injects print() once', () => {
  const html = buildPrintHtml({ lang: 'en', autoPrint: true, meta: { kind: 'place', name: 'X' }, noMap: true });
  assert.equal((html.match(/print\(\)/g) || []).length, 1);
});

test('escHtml + filename', () => {
  assert.equal(escHtml('<b>&'), '&lt;b&gt;&amp;');
  assert.match(printFilename('route'), /^khareeta-route-\d+$/);
  assert.match(printFilename('place'), /^khareeta-place-\d+$/);
});

test('wiring: SW precache, route/place buttons, analytics, i18n merge, no proprietary', () => {
  const sw = rd('sw.js'), route = rd('js/route.js'), place = rd('js/place.js');
  const i18n = rd('js/i18n.js'), an = rd('js/analytics.js'), ex = rd('js/map-export.js');
  assert.ok(sw.includes("'js/map-export-core.js'"));
  assert.ok(sw.includes("'js/map-export.js'"));
  assert.match(route, /id="rPrint"/);
  assert.match(route, /printRouteSheet/);
  assert.match(place, /id="pPrint"/);
  assert.match(place, /printPlace/);
  assert.match(an, /map_export/);
  assert.match(i18n, /MAP_EXPORT_I18N/);
  assert.match(ex, /settings\.lowData/);
  assert.doesNotMatch(rd('js/map-export-core.js'), /https?:\/\//);
  assert.doesNotMatch(rd('js/map-export-core.js'), /google|mapbox|here\.com|bing|googleapis/i);
});

test('i18n.js resolves mapExport* through all three languages (no raw keys)', async () => {
  globalThis.localStorage ??= { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
  globalThis.document ??= { documentElement: { lang: '', dir: '', setAttribute() {} }, querySelector: () => null, addEventListener() {} };
  const { setLang, t, getLang } = await import('../../js/i18n.js');
  const prev = getLang();
  try {
    for (const lang of ['en', 'ar', 'de']) {
      setLang(lang);
      for (const k of ['mapExportPrint', 'mapExportPrintShort', 'mapExportSteps', 'mapExportReady', 'mapExportLowData']) {
        const v = t(k);
        assert.equal(typeof v, 'string');
        assert.ok(v && v !== k, `${lang}.${k}`);
      }
    }
  } finally { setLang(prev); }
});
