// P3 backlog 2 (no network): nav camera lead, Overpass 5xx retry cap + Nominatim fallback, plural helpers (all languages),
// admin dropdown contrast, town/city label collision (variable anchor), What's-here report menu [hidden], token dedupe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../../', import.meta.url), read = p => readFileSync(new URL(p, root), 'utf8');
globalThis.localStorage ??= { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.document ??= { documentElement: { lang: '', dir: '' }, querySelector: () => null, addEventListener() {} };
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(b[1] * Math.PI / 180), (a[1] - b[1]) * 110540);

test('navLead: camera/arrow lead ahead along the heading (fixes the 16–19 m lag), capped, none when slow', () => {
  const src = read('js/route.js'), m = src.match(/export function navLead[\s\S]*?\n}\n/);
  assert.ok(m, 'navLead exists');
  const navLead = new Function(m[0].replace('export ', '') + '; return navLead;')();
  const p = [13.405, 52.52];
  assert.deepEqual(navLead(p, 90, 1), p, 'walking speed: no lead');
  assert.deepEqual(navLead(p, null, 20), p, 'no heading: no lead');
  const car = navLead(p, 0, 18); // 65 km/h → ~16 m ahead, north
  assert.ok(Math.abs(dist(car, p) - 16.2) < 0.5, String(dist(car, p))); assert.ok(car[1] > p[1]);
  assert.ok(dist(navLead(p, 90, 60), p) <= 25.3, 'capped at 25 m');
  assert.match(src, /const shown = navLead\(/); assert.match(src, /easeTo\([^)]*shown|center: shown/);
});

test('overpass: a 5xx stops after 2 attempts (not every mirror); success still resolves', async () => {
  const calls = []; globalThis.fetch = async (u) => { calls.push(u); return { ok: false, status: 503, json: async () => ({}), text: async () => '' }; };
  const { overpass } = await import('../../js/util.js');
  const e = await overpass('[out:json];node(1);out;', 2000, 5).catch(e => e);
  assert.ok(e instanceof Error && e.overloaded, String(e?.message)); assert.equal(calls.length, 2);
  calls.length = 0; const e2 = await overpass('x', 2000, 5000, { tries: 1 }).catch(e => e);
  assert.ok(e2 instanceof Error); assert.equal(calls.length, 1, 'tries cap');
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ elements: [] }) });
  assert.deepEqual((await overpass('x', 2000, 5)).elements, []);
  const s = read('js/search.js');
  assert.match(s, /if \(opDown\) throw/); assert.match(s, /overpass\(q, \d+, \d+, \{ tries: 2 \}\)/);
});

test('tN plurals: AR lines 0/1/2/3/13/100, stops + lines in EN/AR/DE, no regex hack left', async () => {
  const { tN } = await import('../../js/i18n.js');
  const ar = n => tN('trLinesN', n, { lang: 'ar' });
  assert.equal(ar(0), 'لا خطوط'); assert.equal(ar(1), 'خط واحد'); assert.equal(ar(2), 'خطّان');
  assert.equal(ar(3), '3 خطوط'); assert.equal(ar(13), '13 خطًا'); assert.equal(ar(100), '100 خط');
  for (const l of ['en', 'ar', 'de']) for (const p of ['trLinesN', 'trStopsN']) for (const n of [0, 1, 2, 3, 11, 13, 100, 1234]) {
    const v = tN(p, n, { lang: l }); assert.ok(v && !v.includes('{n}') && !v.startsWith('tr'), `${l} ${p} ${n} → ${v}`);
  }
  assert.match(tN('trStopsN', 1234, { lang: 'de' }), /1\.234/);
  assert.match(read('js/transit.js'), /tN\('trLinesN'/);
});

test('admin header dropdown is opaque with white text (readable at 390 px)', () => {
  const a = read('admin.html');
  assert.match(a, /appearance:\s*none/); assert.match(a, /color-scheme:\s*dark/); assert.match(a, /#095a41/i);
});

test('map styles: town/city labels use a variable anchor (Nusaybin vs Qamishli collision)', () => {
  for (const f of ['map-style-light.json', 'map-style-dark.json']) {
    const s = JSON.parse(read(f));
    for (const id of ['place-town', 'place-city']) {
      const l = s.layers.find(x => x.id === id); assert.ok(l, `${f} ${id}`);
      assert.ok(Array.isArray(l.layout['text-variable-anchor']) && l.layout['text-variable-anchor'].length >= 4, `${f} ${id}`);
      assert.ok(l.layout['text-radial-offset'] > 0);
    }
  }
});

test("What's-here report menu: [hidden] beats display:grid, closed on every wire/open", () => {
  assert.match(read('css/app.css'), /\.rm-menu\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(read('js/report-entry.js'), /set\(false\)/);
});

test('report queue without Web Locks: localStorage lock + BroadcastChannel claim', () => {
  const s = read('js/analytics.js');
  assert.match(s, /kh\.rq\.lock/); assert.match(s, /BroadcastChannel\('kh-report'\)/); assert.match(s, /export function _resetReportLock/);
});
