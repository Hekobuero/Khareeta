import { test } from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const R = readFileSync(new URL('../../js/route.js', import.meta.url), 'utf8'), S = readFileSync(new URL('../../js/search.js', import.meta.url), 'utf8'), I = readFileSync(new URL('../../js/i18n.js', import.meta.url), 'utf8');
test('nav start asks for GPS in the tap and refuses without it', () => {
  assert.match(R, /getCurrentPosition\(/); assert.match(R, /navLocNeeded\(\)/);
  assert.match(R, /N\.isSim = !!sim \|\| !\('geolocation' in navigator\)/);
  assert.match(R, /requestPermission/); assert.match(R, /webkitCompassHeading/);
});
test('manual pan disables follow, no silent auto-refollow', () => { assert.match(R, /USER_MOVE/); assert.match(R, /navRecenter/); });
test('category chips stay in the current view', () => {
  assert.match(S, /CAT_FIT_M/); assert.match(S, /if \(!inSyria\(/); assert.match(S, /const ref = center\(\)/);
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
