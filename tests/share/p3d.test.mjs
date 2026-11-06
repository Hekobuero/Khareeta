// P3 bundle 3 (#41/#40 follow-up): bidi-isolated route stop names on the share card, offline no-basemap hint,
// ≥44 px route chip hit area, uniform action-row height. No network, no MapLibre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawShareCard, SHARE_IMAGE_I18N, labelValue, balanceIsolates, FSI, PDI } from '../../js/share-image-core.js';
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

function ctx() {
  const calls = []; const canvas = { width: 0, height: 0 };
  return { canvas, calls, font: '', fillStyle: '', textAlign: 'left', textBaseline: 'alphabetic', direction: 'ltr',
    beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, fillRect() {}, drawImage() {}, save() {}, restore() {}, clip() {},
    createLinearGradient() { return { addColorStop() {} }; },
    fillText(t, x, y) { calls.push({ t: String(t), x, y, dir: this.direction, align: this.textAlign }); },
    measureText(t) { const size = +(this.font.match(/(\d+)px/) || [0, 28])[1]; return { width: [...String(t)].length * size * 0.55 }; } };
}
const route = { kind: 'route', from: 'مسجد الأموي', to: 'Bab Touma', via: ['سوق الحميدية'], title: '18 min' };

test('DE/EN route card: Arabic stop names are bidi-isolated after the colon', () => {
  for (const lang of ['de', 'en']) {
    const c = ctx(); drawShareCard(c, { meta: route, lang });
    const from = c.calls.find(x => x.t.startsWith(SHARE_IMAGE_I18N[lang].shareFrom + ': '));
    assert.ok(from, lang);
    assert.equal(from.t, `${SHARE_IMAGE_I18N[lang].shareFrom}: ${FSI}مسجد الأموي${PDI}`);
    const via = c.calls.find(x => x.t.startsWith(SHARE_IMAGE_I18N[lang].shareViaStops + ': '));
    assert.ok(via.t.includes(`${FSI}سوق الحميدية${PDI}`));
  }
  // AR card isolates a Latin name the same way
  const c = ctx(); drawShareCard(c, { meta: route, lang: 'ar' });
  assert.ok(c.calls.some(x => x.t === `إلى: ${FSI}Bab Touma${PDI}`));
});

test('isolates stay balanced when a long name wraps', () => {
  assert.equal(labelValue('Von', 'X'), `Von: ${FSI}X${PDI}`);
  assert.equal(balanceIsolates(`Von: ${FSI}مسجد`), `Von: ${FSI}مسجد${PDI}`);
  assert.equal(balanceIsolates(`الأموي${PDI}`), `${FSI}الأموي${PDI}`);
  const c = ctx(); drawShareCard(c, { meta: { ...route, from: 'مسجد '.repeat(30).trim() }, lang: 'de' });
  for (const x of c.calls) {
    const o = [...x.t].filter(ch => ch === FSI).length, cl = [...x.t].filter(ch => ch === PDI).length;
    assert.equal(o, cl, x.t);
  }
});

test('offline without cached tiles: hint on the card (EN/AR/DE), attribution kept, no crash', async () => {
  for (const lang of ['en', 'ar', 'de']) {
    assert.ok(SHARE_IMAGE_I18N[lang].shareImageNoMap, lang);
    const c = ctx(); const r = drawShareCard(c, { meta: route, lang, noMap: true, mapImage: null });
    assert.equal(r.noMap, true);
    assert.ok(c.calls.some(x => x.t === SHARE_IMAGE_I18N[lang].shareImageNoMap), lang);
    assert.ok(c.calls.some(x => /OpenStreetMap/.test(x.t)));
  }
  const c = ctx(); drawShareCard(c, { meta: route, lang: 'de' });
  assert.ok(!c.calls.some(x => x.t === SHARE_IMAGE_I18N.de.shareImageNoMap), 'no hint when the map is there');
  assert.notEqual(SHARE_IMAGE_I18N.ar.shareImageNoMap, SHARE_IMAGE_I18N.en.shareImageNoMap);
});

test('basemapMissing: only offline and only when no vector-tile features are rendered', async () => {
  const { basemapMissing } = await import('../../js/share-image-core.js');
  const empty = { queryRenderedFeatures: () => [{ source: 'khareeta-route', layer: { id: 'route' } }, { source: 'kh-ui-guard', layer: { id: 'kh-ui-guard' } }] };
  const tiles = { queryRenderedFeatures: () => [{ source: 'openmaptiles', layer: { id: 'water' } }] };
  assert.equal(basemapMissing(empty, false), true);
  assert.equal(basemapMissing(tiles, false), false);
  assert.equal(basemapMissing(empty, true), false, 'online never claims "no map"');
  const si = read('js/share-image.js');
  assert.match(si, /toast\(t\('shareImageNoMap'\)/);
});

test('route chips (.ochip): 44 px hit target, 36 px visible pill; action row uniform min-height 84 px', () => {
  const css = read('css/app.css');
  const ochip = css.match(/\n\.ochip\{[^}]*\}/)[0];
  assert.match(ochip, /height:44px/);
  assert.match(ochip, /border:4px solid transparent/);
  assert.match(ochip, /background-clip:padding-box/);
  assert.match(css, /\.arow\.actions \.abtn\{[^}]*min-height:84px/);
  // P3 AR clip: route sheet chips wrap so «الخطوات» stays in the 390 px viewport
  assert.match(css, /\.ochips\.rchips\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.ochips\.rchips\{[^}]*overflow-x:visible/);
});
