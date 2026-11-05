import { test } from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const C = readFileSync(new URL('../../js/core.js', import.meta.url), 'utf8');
const R = readFileSync(new URL('../../js/route.js', import.meta.url), 'utf8'), S = readFileSync(new URL('../../js/search.js', import.meta.url), 'utf8'), I = readFileSync(new URL('../../js/i18n.js', import.meta.url), 'utf8');
test('nav start asks for GPS in the tap and refuses without it', () => {
  assert.match(R, /getCurrentPosition\(/); assert.match(R, /navLocNeeded\(\)/);
  assert.match(R, /N\.isSim = !!sim \|\| !\('geolocation' in navigator\)/);
  assert.match(R, /requestPermission/); assert.match(R, /webkitCompassHeading/);
});
test('manual pan disables follow, no silent auto-refollow', () => { assert.match(R, /USER_MOVE/); assert.match(R, /navRecenter/); });
test('category chips stay in the current view', () => {
  assert.match(S, /CAT_FIT_M/); assert.match(S, /if \(!inSyria\(/); assert.match(S, /const ref = chipRef\(\), r = filterResults\(ref/);
});
test('i18n EN/AR/DE', () => { for (const k of ['navLocNeeded', 'recenter']) assert.ok((I.match(new RegExp(k + '\\s*:', 'g')) || []).length >= 3, k); });
test('navHeading priority', () => {
  const src = R.match(/export function navHeading[\s\S]*?\n}\n/)[0];
  const bearing = (a, b) => { const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r), x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r); return (Math.atan2(y, x) / r + 360) % 360; };
  const hav = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110540);
  const f = new Function('bearing', 'dist', 'haversine', 'distM', src.replace('export ', '') + '; return navHeading;')(bearing, hav, hav, hav);
  assert.equal(f({ heading: 90, speed: 5, compass: 10, compassAge: 0 }), 90);
  assert.equal(f({ heading: null, speed: 0.5, compass: 200, compassAge: 500 }), 200);
  assert.ok(Math.abs(f({ heading: null, speed: 0.5, compassAge: 1e9, prev: [13.4, 52.52], p: [13.401, 52.52] }) - 90) < 2);
  assert.equal(f({ speed: 0, compassAge: 1e9, prev: [13.4, 52.52], p: [13.4, 52.52], routeBearing: 33 }), 33);
});

const fn = (src, name) => new Function(src.match(new RegExp('export function ' + name + '[^\\n]*\\n(?:  [^\\n]*\\n)*?}\\n|export function ' + name + '[^\\n]*}\\n'))[0].replace('export ', '') + '; return ' + name + ';')();
const hav = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110540);
test('chip reference point: GPS inside view, else map centre', () => {
  const pick = fn(C, 'pickChipRef'), view = [36.2, 33.4, 36.4, 33.6], c = [36.3, 33.5];
  assert.deepEqual(pick([36.25, 33.45], view, c), [36.25, 33.45]);
  assert.deepEqual(pick([13.4, 52.5], view, c), c);
  assert.deepEqual(pick(null, view, c), c);
});
test('live + Damascus lists sort and show km from the same chipRef point', () => {
  assert.match(S, /const ref = chipRef\(\); \/\/ same point/); assert.doesNotMatch(S.match(/export async function searchCategoryLive[\s\S]*?\n}\n/)[0], /refPoint\(\)/);
  assert.match(S, /item\.d != null \? fmtDist\(item\.d\)/);
  const sortByRef = fn(S, 'sortByRef'), ref = [36.3, 33.5];
  const pts = Array.from({ length: 40 }, (_, i) => [36.3 + Math.sin(i * 7) * 0.05, 33.5 + Math.cos(i * 3) * 0.05]);
  const res = sortByRef(pts.map(([lon, lat]) => ({ lon, lat, d: hav(ref, [lon, lat]) })));
  for (let i = 1; i < res.length; i++) assert.ok(res[i].d >= res[i - 1].d, 'monotonic');
  for (const r of res) assert.equal(r.d, hav(ref, [r.lon, r.lat])); // km shown = sort key
});
test('live search widens when empty (2x, 4x, max ~10 km); chip zoom >= z12', () => {
  const src = S.match(/export const LIVE_MAXD[^\n]*\n/)[0].replace('export ', '') + S.match(/export function liveBoxes[\s\S]*?\n}\n/)[0].replace('export ', '');
  const lb = new Function(src + '; return liveBoxes;')();
  const z15 = lb(33.505, 36.295, 33.515, 36.305, [36.3, 33.51]);
  assert.equal(z15.length, 3); assert.ok(Math.abs((z15[1][2] - z15[1][0]) - 0.02) < 1e-9); assert.ok(Math.abs((z15[2][2] - z15[2][0]) - 0.04) < 1e-9);
  for (const b of lb(33, 36, 34, 37, [36.5, 33.5])) assert.ok(b[2] - b[0] <= 0.18 + 1e-9);
  assert.match(S, /CHIP_MIN_Z = 12/); assert.match(S, /minZoom: CHIP_MIN_Z/);
  assert.match(S, /if \(j\.elements\?\.length\) break;/);
});
