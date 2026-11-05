// P3 follow-ups for "What's here?" / share / open-now hint. Pure Node, no network, no Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Throttle, RevCache, makeReverse, EventGate, pointKey, formatAddress, addrFromReverse, hintCount, buildShareUrl, SHARE_I18N, REV_LS_KEY } from '../../js/share-core.js';
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('(1) queued long-press lookups: only the latest is fetched, older waiting ones are dropped', async () => {
  const urls = [];
  const rev = makeReverse({ cache: new RevCache(null), throttle: new Throttle(30), latest: true, fetchFn: async u => { urls.push(u); return { display_name: u.match(/lat=([\d.]+)/)[1] }; } });
  const ps = [1, 2, 3, 4].map(i => rev(10 + i, 20, 'de'));
  const res = await Promise.allSettled(ps);
  // 1st goes out immediately (nothing queued before it), 2+3 were still waiting → dropped, 4 (latest) fetched
  assert.equal(res[0].status, 'fulfilled');
  assert.equal(res[1].status, 'rejected'); assert.equal(res[1].reason.name, 'AbortError');
  assert.equal(res[2].status, 'rejected');
  assert.equal(res[3].status, 'fulfilled'); assert.equal(res[3].value, '14.00000');
  assert.equal(urls.length, 2);
  // a dropped request is not cached / not stuck inflight: asking again fetches
  assert.equal(await rev(12, 20, 'de'), '12.00000');
});
test('(1) non-latest reverse (share my location) is never dropped; wiring uses latest for long-press', async () => {
  const rev = makeReverse({ cache: new RevCache(null), throttle: new Throttle(5), fetchFn: async () => ({ display_name: 'x' }) });
  const r = await Promise.allSettled([1, 2, 3].map(i => rev(i, 1, 'en')));
  assert.ok(r.every(x => x.status === 'fulfilled'));
  const wh = read('js/whats-here.js');
  assert.match(wh, /latest: true/); assert.match(wh, /reverseLatest\(lat, lon/);
});
test('(2) whats_here analytics: max 1 per point / 5 s', () => {
  let now = 0; const g = new EventGate(5000, () => now);
  const k = pointKey(52.520001, 13.404951);
  assert.equal(g.ok(k), true); assert.equal(g.ok(pointKey(52.520004, 13.404954)), false); // same point (5 decimals)
  assert.equal(g.ok(pointKey(33.5132, 36.2919)), true); // other point
  now = 4999; assert.equal(g.ok(k), false);
  now = 5000; assert.equal(g.ok(k), true);
  const wh = read('js/whats-here.js');
  assert.match(wh, /if \(whGate\.ok\(pointKey\(lat, lon\)\)\) track\('whats_here', \{\}\)/);
  assert.equal([...wh.matchAll(/track\('whats_here'/g)].length, 1);
});
test('(3) address from road + house_number + suburb + city, locale order, fallback display_name', () => {
  const ber = { road: 'Unter den Linden', house_number: '12', suburb: 'Mitte', city: 'Berlin', postcode: '10117', country: 'Deutschland' };
  assert.equal(formatAddress(ber, 'de'), 'Unter den Linden 12, Mitte, Berlin');
  assert.equal(formatAddress(ber, 'en'), '12 Unter den Linden, Mitte, Berlin');
  const dam = { road: 'شارع بغداد', house_number: '5', neighbourhood: 'القصاع', city: 'دمشق' };
  assert.equal(formatAddress(dam, 'ar'), 'شارع بغداد 5، القصاع، دمشق');
  assert.equal(formatAddress({ road: 'Straight Street', suburb: 'Bab Touma', city: 'Damascus' }, 'en'), 'Straight Street, Bab Touma, Damascus');
  assert.equal(formatAddress({ road: 'X', town: 'Y' }, 'de'), 'X, Y');
  assert.equal(formatAddress({ road: 'Berlin', city: 'Berlin' }, 'de'), 'Berlin'); // no duplicates
  assert.equal(formatAddress({ city: 'Berlin', country: 'DE' }, 'de'), ''); // nothing street-level → fallback
  assert.equal(addrFromReverse({ address: { city: 'Berlin' }, display_name: 'A, B, C, D, E' }, 'de'), 'A, B, C, D');
  assert.equal(addrFromReverse({ address: ber, display_name: 'zzz' }, 'de'), 'Unter den Linden 12, Mitte, Berlin');
  assert.equal(addrFromReverse({ error: 'x' }), '');
  assert.equal(REV_LS_KEY, 'kh.rev2'); // old display_name cache not reused
});
test('(4) share my location: link without n=', () => {
  const u = buildShareUrl({ lat: 1, lon: 2, name: null });
  assert.ok(!/[?&]n=/.test(u));
  const wh = read('js/whats-here.js');
  assert.match(wh, /name: t\('myLocName'\), addr \}, \{ linkName: false \}/);
  assert.match(wh, /name: linkName \? name : null/);
});
test('(5) hint count: ≤ 99 exact, else 99+, locale digits (ar-SY for AR)', () => {
  assert.equal(hintCount(0), '0'); assert.equal(hintCount(7, 'de-DE'), '7'); assert.equal(hintCount(99, 'de-DE'), '99');
  assert.equal(hintCount(100, 'de-DE'), '99+'); assert.equal(hintCount(12345, 'en-GB'), '99+');
  assert.equal(hintCount(42, 'ar-SY-u-nu-arab'), '٤٢'); assert.equal(hintCount(500, 'ar-SY-u-nu-arab'), '٩٩+');
  assert.equal(hintCount(42, 'ar-SY-u-nu-latn'), '42');
  assert.match(read('js/fmt.js'), /'ar-SY-u-nu-/);
  assert.match(read('js/search.js'), /hintCount\(r\.hiddenNoHours, locale\(\)\)/);
});
test('(5) "Show anyway" EN/AR/DE + shows the hidden places again', () => {
  assert.equal(SHARE_I18N.en.ohShowAnyway, 'Show anyway');
  assert.equal(SHARE_I18N.de.ohShowAnyway, 'Trotzdem anzeigen');
  assert.equal(SHARE_I18N.ar.ohShowAnyway, 'عرض الكل');
  const s = read('js/search.js');
  assert.match(s, /id="ohShow"/); assert.match(s, /setFilter\(App\.map, cats, true, true\); showFilterSheet\(false\)/);
  const poi = read('js/poi.js');
  assert.match(poi, /list = list\.filter\(r => st\(r\) \? st\(r\)\.open : state\.showNoHours\)/);
  assert.match(poi, /hiddenNoHours: state\.openNow && !state\.showNoHours \? noHours : 0/);
  assert.match(poi, /openIdx\(cats, state\.showNoHours\)/);
});
test('rules: CNAME present, OSM only, no keys', () => {
  assert.ok(read('CNAME').trim().length);
  const src = read('js/share-core.js') + read('js/whats-here.js');
  assert.ok(!/google|mapbox|here\.com|bing|apple\.com|api[_-]?key/i.test(src));
});
