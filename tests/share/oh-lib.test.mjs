// Vendored opening_hours.js (lazy) – parses what js/oh.js can't, device-local time, size + license notice present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { loadOHLib, libState, ohLibReady } from '../../js/oh-lib.js';
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
test('lazy: not loaded until asked', () => assert.equal(ohLibReady(), false));
test('library: open/closed + next change in local time', async () => {
  await loadOHLib(() => import('../../js/vendor/opening_hours.js'));
  const wed10 = new Date(2026, 10, 4, 10, 0), wed20 = new Date(2026, 10, 4, 20, 0);
  const a = libState('Mo-Fr 09:00-18:00', wed10); assert.equal(a.open, true); assert.equal(a.closes.getHours(), 18);
  const b = libState('Mo-Fr 09:00-18:00', wed20); assert.equal(b.open, false); assert.equal(b.opens.getHours(), 9);
  assert.equal(libState('Mo-Fr 09:00-12:00,13:00-18:00; PH off', wed10).open, true);
  assert.equal(libState('sunrise-sunset', wed10)?.open !== undefined, true);
  assert.equal(libState('not hours at all', wed10), null);
});
test('vendored locally with license, lazy (not in index.html), size noted', () => {
  assert.ok(statSync(new URL('../../js/vendor/opening_hours.js', import.meta.url)).size < 1_400_000);
  assert.match(read('js/vendor/opening_hours.LICENSE.txt'), /LESSER GENERAL PUBLIC LICENSE/);
  assert.ok(!read('index.html').includes('opening_hours'));
  assert.ok(!/from '\.\/vendor/.test(read('js/oh-lib.js'))); // only dynamic import
  assert.ok(!/https?:\/\//.test(read('js/vendor/opening_hours.js').match(/^import .*$/m)[0]));
});
