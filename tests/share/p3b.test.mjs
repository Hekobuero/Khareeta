// #34 P3 follow-ups: throttle slot only at the real send; AR count line uniformly through nf. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.fetch = () => { throw new Error('network access in tests is forbidden'); };
import { Throttle, RevCache, makeReverse } from '../../js/share-core.js';
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

// virtual clock: sleep advances time
function clock() {
  let now = 0; const timers = [];
  const sleep = ms => new Promise(r => timers.push({ at: now + ms, r }));
  const run = async () => { for (let i = 0; i < 1000; i++) { await new Promise(r => setImmediate(r)); if (!timers.length) return; timers.sort((a, b) => a.at - b.at); const x = timers.shift(); now = Math.max(now, x.at); x.r(); } };
  return { now: () => now, sleep, run };
}

test('throttle: dropped requests reserve no slot; 10 fast clicks → last address after ≤ 1 s', async () => {
  const c = clock(), fetched = [];
  const th = new Throttle(1000, { now: c.now, sleep: c.sleep });
  const rev = makeReverse({ cache: new RevCache(null), throttle: th, latest: true, fetchFn: async u => { fetched.push([c.now(), u]); return { display_name: u.match(/lat=([\d.]+)/)[1] }; } });
  const ps = Array.from({ length: 10 }, (_, i) => rev(10 + i, 20, 'de'));
  const all = Promise.allSettled(ps); await c.run(); const res = await all;
  assert.equal(fetched.length, 2, 'first + latest only');
  assert.equal(res[9].status, 'fulfilled'); assert.equal(res[9].value, '19.00000');
  assert.ok(fetched[1][0] <= 1000, 'last address at ≤ 1 s, got ' + fetched[1][0]);
  for (let i = 1; i < 9; i++) assert.equal(res[i].reason?.name, 'AbortError');
  // after the burst, the next slot follows the last REAL request (not 10 reserved slots)
  assert.equal(th.next, fetched[1][0] + 1000);
});
test('throttle: non-dropped requests still keep the 1 s gap (Nominatim policy)', async () => {
  const c = clock(), at = [];
  const th = new Throttle(1000, { now: c.now, sleep: c.sleep });
  const all = Promise.all([1, 2, 3].map(() => th.run(async () => at.push(c.now()))));
  await c.run(); await all;
  assert.deepEqual(at, [0, 1000, 2000]);
});
test('AR count line: radius goes through nf too (no "١٠ كم" mixed with "1,853")', async () => {
  const I = read('js/i18n.js');
  assert.ok(!I.includes('ضمن ١٠ كم'));
  assert.match(I, /nearbyN: '\{n\} ضمن \{r\} كم'/); assert.match(I, /nearbyN: '\{n\} within \{r\} km'/); assert.match(I, /nearbyN: '\{n\} im Umkreis von \{r\} km'/);
  const S = read('js/search.js');
  const calls = [...S.matchAll(/t\('nearbyN', \{([^}]*)\}\)/g)].map(m => m[1]);
  assert.ok(calls.length >= 2); for (const a of calls) assert.match(a, /n: nf\([^)]*\), r: nf\(10\)/);
  const line = S.split('\n').find(l => l.includes('const countTxt'));
  for (const m of line.matchAll(/\{ n: ([^}]*) \}/g)) assert.match(m[1], /^nf\(/);
  // rendering with both digit settings: one digit system per line
  for (const [loc, re] of [['ar-SY-u-nu-latn', /^[0-9,. ]+ضمن [0-9]+ كم$/], ['ar-SY-u-nu-arab', /^[٠-٩٬٫ ]+ضمن [٠-٩]+ كم$/]]) {
    const f = new Intl.NumberFormat(loc);
    const s = '{n} ضمن {r} كم'.replace('{n}', f.format(1853)).replace('{r}', f.format(10));
    assert.match(s, re, s);
  }
});
