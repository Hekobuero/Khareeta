// Share-as-image card composition (js/share-image-core.js). No network, no MapLibre, no Supabase.
// Run: node --test 'tests/share/share-image.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ATTR, BRAND, CARD_W, MAP_H, SHARE_IMAGE_I18N, THEME,
  drawShareCard, normalizeCardMeta, fmtCoordPair, wrapLines, isPng, pngSize,
} from '../../js/share-image-core.js';

const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

/** Minimal 2d context mock that records text + fills and supports measureText. */
function mockCtx() {
  const calls = [];
  const canvas = { width: 0, height: 0 };
  const ctx = {
    canvas, calls,
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'alphabetic', direction: 'ltr',
    beginPath() { calls.push(['beginPath']); },
    moveTo(...a) { calls.push(['moveTo', ...a]); },
    arcTo(...a) { calls.push(['arcTo', ...a]); },
    closePath() { calls.push(['closePath']); },
    fill() { calls.push(['fill']); },
    fillRect(...a) { calls.push(['fillRect', ...a]); },
    fillText(t, x, y, mw) { calls.push(['fillText', String(t), x, y, mw]); },
    drawImage() { calls.push(['drawImage']); },
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    clip() { calls.push(['clip']); },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    measureText(t) {
      // approx CJK/Arabic as wider; Latin ~0.55em
      const s = String(t);
      const size = +(this.font.match(/(\d+)px/) || [0, 28])[1];
      let w = 0;
      for (const ch of s) w += /[\u0600-\u06FF]/.test(ch) ? size * 0.7 : size * 0.55;
      return { width: w };
    },
  };
  return ctx;
}

test('i18n keys EN/AR/DE match', () => {
  for (const l of ['en', 'ar', 'de'])
    assert.deepEqual(Object.keys(SHARE_IMAGE_I18N[l]).sort(), Object.keys(SHARE_IMAGE_I18N.en).sort(), l);
  assert.equal(SHARE_IMAGE_I18N.de.shareAsImage, 'Als Bild teilen');
  assert.equal(SHARE_IMAGE_I18N.en.shareAsImage, 'Share as image');
  assert.match(SHARE_IMAGE_I18N.ar.shareAsImage, /صورة/);
});

test('fmtCoordPair + normalize place/route', () => {
  assert.equal(fmtCoordPair(33.513801, 36.276512), '33.51380, 36.27651');
  assert.equal(fmtCoordPair('x', 1), '');
  const p = normalizeCardMeta({ kind: 'place', name: 'Café', address: 'Main 1', lat: 33.5, lon: 36.2, statusText: 'Open now', statusCls: 'open' }, 'en');
  assert.equal(p.kind, 'place'); assert.equal(p.name, 'Café'); assert.equal(p.statusCls, 'open');
  assert.match(p.coords, /33\.50000/);
  const r = normalizeCardMeta({ kind: 'route', from: 'A', to: 'B', via: ['C', '', null], modeLabel: 'Drive', durationLabel: '12 min', distanceLabel: '3.1 km' }, 'de');
  assert.equal(r.kind, 'route'); assert.deepEqual(r.via, ['C']); assert.equal(r.modeLabel, 'Drive');
});

test('wrapLines respects max width + ellipsis', () => {
  const measure = s => s.length * 10;
  const lines = wrapLines(measure, 'one two three four five six', 50, 2);
  assert.ok(lines.length <= 2);
  assert.ok(lines.at(-1).endsWith('…') || lines.join(' ').length <= 12);
});

test('drawShareCard place: attribution ON card, brand, RTL-safe Arabic', () => {
  const ctx = mockCtx();
  const out = drawShareCard(ctx, {
    meta: { kind: 'place', name: 'الجامع الأموي', address: 'دمشق', lat: 33.5126, lon: 36.3067, statusText: 'مفتوح الآن', statusCls: 'open' },
    lang: 'ar', dark: false,
  });
  assert.equal(out.width, CARD_W);
  assert.ok(out.height >= MAP_H + 200);
  assert.equal(out.attribution, ATTR);
  assert.equal(ctx.canvas.width, CARD_W);
  assert.equal(ctx.canvas.height, out.height);
  const texts = ctx.calls.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(texts.some(t => t.includes('OpenStreetMap')), texts);
  assert.ok(texts.some(t => t.includes('OpenFreeMap')), texts);
  assert.ok(texts.some(t => t.includes('OpenMapTiles')), texts);
  assert.ok(texts.some(t => t.includes('الجامع')), texts);
  assert.ok(texts.some(t => t.includes(BRAND) || t.includes('Khareeta')), texts);
});

test('drawShareCard route DE dark: from/to/via/mode', () => {
  const ctx = mockCtx();
  drawShareCard(ctx, {
    meta: {
      kind: 'route', from: 'Bahnhof', to: 'Markt', via: ['Park'],
      modeLabel: 'Zu Fuß', durationLabel: '18 Min.', distanceLabel: '1,4 km',
      title: '18 Min. · 1,4 km · Zu Fuß',
    },
    lang: 'de', dark: true,
  });
  const texts = ctx.calls.filter(c => c[0] === 'fillText').map(c => c[1]).join('\n');
  assert.match(texts, /Bahnhof/);
  assert.match(texts, /Markt/);
  assert.match(texts, /Park/);
  assert.match(texts, /OpenStreetMap/);
  assert.equal(THEME.dark.surface, '#1C1C1E');
});

test('isPng / pngSize magic bytes', () => {
  const good = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x04, 0xb0, 0, 0, 0x03, 0xe8);
  assert.equal(isPng(good), true);
  assert.deepEqual(pngSize(good), { width: 1200, height: 1000 });
  assert.equal(isPng(Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7)), false);
});

test('wiring: SW precache, i18n merge, buttons, analytics, no coords in track, OSM only, no paid maps', () => {
  const sw = read('sw.js');
  for (const f of ['js/share-image-core.js', 'js/share-image.js']) assert.ok(sw.includes(`'${f}'`), f);
  const i18n = read('js/i18n.js');
  assert.match(i18n, /SHARE_IMAGE_I18N/);
  const place = read('js/place.js');
  assert.match(place, /pShareImg/);
  assert.match(place, /shareAsImage/);
  assert.match(place, /id="pShare"/); // link share kept
  const wh = read('js/whats-here.js');
  assert.match(wh, /whShareImg/);
  assert.match(wh, /shareAsImage/);
  const route = read('js/route.js');
  assert.match(route, /rShareImg/);
  assert.match(route, /shareRouteImage/);
  const app = read('js/app.js');
  assert.match(app, /preserveDrawingBuffer:\s*true/);
  const an = read('js/analytics.js');
  assert.match(an, /share_image/);
  const mig = read('supabase/migrations/20261105_share_image_event.sql');
  assert.match(mig, /DO NOT run automatically/);
  assert.match(mig, /share_image/);
  // track() calls in share-image must never pass lat/lon/name/address
  const si = read('js/share-image.js');
  for (const m of si.matchAll(/track\(([^)]*)\)/g)) assert.ok(!/\blat\b|\blon\b|name|address|coord/i.test(m[1]), m[0]);
  for (const bad of ['mapbox', 'googleapis', 'here.com', 'bing.com', 'apple.com/maps']) {
    assert.ok(!si.toLowerCase().includes(bad), bad);
    assert.ok(!read('js/share-image-core.js').toLowerCase().includes(bad), bad);
  }
  // excluded P3s must NOT land in this PR
  assert.ok(!/data-saver|min-height:\s*63|انعطف يسارًا بعد/.test(place + wh + route + si));
});
