// Share links + "What's here": deep-link parsing, share URL/text, throttle, reverse cache. No network, no Supabase.
// Run: node --test 'tests/share/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeepLink, buildShareUrl, shareText, geoUri, Throttle, RevCache, makeReverse, revKey, reverseUrl, SHARE_I18N } from '../../js/share-core.js';
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('deep link: valid', () => {
  assert.deepEqual(parseDeepLink('?p=33.51320,36.29190&n=Umayyad%20Mosque&z=16&route=1'), { lat: 33.5132, lon: 36.2919, z: 16, name: 'Umayyad Mosque', route: true });
  const d = parseDeepLink('?p=52.520008,13.404954');
  assert.equal(d.lat, 52.52001); assert.equal(d.lon, 13.40495); assert.equal(d.z, 16); assert.equal(d.name, null); assert.equal(d.route, false);
  assert.equal(parseDeepLink('?p=-33.9,-70.6&z=99').z, 20);
  assert.equal(parseDeepLink('?p=1,2&z=abc').z, 16);
  assert.equal(parseDeepLink('?p=1,2&route=yes').route, false);
});
test('deep link: invalid values → null', () => {
  for (const s of ['', '?', '?p=', '?p=n12345', '?p=91,10', '?p=10,181', '?p=abc,def', '?p=1,2,3', '?p=1e3,2', '?p=NaN,1', '?p=Infinity,1', '?p=,', '?p=1,', '?ll=1,2'])
    assert.equal(parseDeepLink(s), null, s);
});
test('deep link: name sanitised + capped', () => {
  const d = parseDeepLink('?p=1,2&n=' + encodeURIComponent('<script>x</script>' + 'a'.repeat(200)));
  assert.ok(!/[<>]/.test(d.name)); assert.ok(d.name.length <= 80);
});
test('share URL round-trips, khareeta.app, 5 decimals', () => {
  const u = buildShareUrl({ lat: 33.513201234, lon: 36.29191, name: 'سوق الحميدية', route: true });
  assert.ok(u.startsWith('https://khareeta.app/?p=33.51320,36.29191&n='));
  assert.ok(u.endsWith('&z=16&route=1'));
  const d = parseDeepLink(new URL(u).search);
  assert.equal(d.name, 'سوق الحميدية'); assert.equal(d.lat, 33.5132); assert.equal(d.route, true);
  assert.equal(geoUri(33.5132, 36.2919), 'geo:33.51320,36.29190');
});
test('share text EN/AR/DE: title + address + link', () => {
  const url = 'https://khareeta.app/?p=1.00000,2.00000&z=16';
  assert.equal(shareText({ lang: 'en', name: 'Cafe', address: 'Main St 1, Berlin', url }), 'Cafe – Khareeta\nMain St 1, Berlin\n' + url);
  assert.equal(shareText({ lang: 'de', name: null, address: 'Unter den Linden', url }), 'Was ist hier? – Khareeta\nUnter den Linden\n' + url);
  assert.equal(shareText({ lang: 'ar', name: 'الجامع', address: 'دمشق', url }), 'الجامع – خريطة\nدمشق\n' + url);
  assert.match(shareText({ lang: 'de', name: 'X', url, lat: 1, lon: 2, geo: true }), /\nAndere Karten-App: geo:1\.00000,2\.00000$/);
  for (const l of ['en', 'ar', 'de']) assert.deepEqual(Object.keys(SHARE_I18N[l]).sort(), Object.keys(SHARE_I18N.en).sort(), l);
});
test('throttle: ≥ 1 s between Nominatim requests', async () => {
  const slept = [];
  const th = new Throttle(1000, { now: () => 0, sleep: async ms => { slept.push(ms); } });
  await Promise.all([1, 2, 3].map(() => th.run(() => 1)));
  assert.deepEqual(slept, [1000, 2000]); // 2nd waits 1 s, 3rd 2 s
  const real = new Throttle(60), at = [];
  await Promise.all([1, 2, 3].map(() => real.run(() => at.push(Date.now()))));
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 55);
});
test('reverse: cached by 5-decimal coords + lang, persisted, bounded', async () => {
  const store = new Map(); const st = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const urls = [];
  const rev = makeReverse({ cache: new RevCache(st, 3), throttle: new Throttle(0), fetchFn: async u => { urls.push(u); return { display_name: 'A, B, C, D, E' }; } });
  assert.equal(await rev(52.520001, 13.404951, 'de'), 'A, B, C, D');
  assert.equal(await rev(52.520004, 13.404954, 'de'), 'A, B, C, D'); // same ~1 m cell
  assert.equal(urls.length, 1);
  assert.match(urls[0], /accept-language=de/); assert.match(urls[0], /^https:\/\/nominatim\.openstreetmap\.org\/reverse\?/);
  await rev(52.52, 13.40495, 'ar'); assert.equal(urls.length, 2);
  const c2 = new RevCache(st, 3); assert.equal(c2.get(revKey(52.52, 13.40495, 'de')), 'A, B, C, D');
  for (let i = 0; i < 5; i++) c2.set('k' + i, 'v'); assert.equal(c2.size, 3);
  assert.equal(JSON.parse(store.get('kh.rev2')).length, 3);
});
test('wiring: SW precache, i18n merge, no coords to analytics, OSM only', () => {
  const sw = read('sw.js'); for (const f of ['js/share-core.js', 'js/whats-here.js']) assert.ok(sw.includes(`'${f}'`), f);
  assert.match(read('js/i18n.js'), /SHARE_I18N/);
  const wh = read('js/whats-here.js');
  for (const m of wh.matchAll(/track\(([^)]*)\)/g)) assert.ok(!/lat|lon/.test(m[1]), m[0]);
  assert.ok(!/google|mapbox|here\.com|bing|apple\.com/i.test(wh + read('js/share-core.js')));
  assert.ok(reverseUrl(1, 2, 'en').includes('email='));
  assert.ok(read('CNAME').trim().length);
});
