// "Open now": own parser only; Damascus time inside Syria, device-local time outside. Run under several TZ values in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ohStatus, tzOffsetFor } from '../../js/hours.js';
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const DAM = [36.2919, 33.5132], BER = [13.405, 52.52];
const H = 'Mo-Su 09:00-18:00';
test('inside Syria: Damascus wall clock, independent of device TZ', () => {
  const at = new Date(Date.UTC(2026, 10, 4, 6, 30)); // 09:30 Damascus
  assert.equal(tzOffsetFor(DAM, at), 180);
  assert.equal(ohStatus(H, at, DAM).open, true);
  assert.equal(ohStatus(H, new Date(Date.UTC(2026, 10, 4, 15, 30)), DAM).open, false); // 18:30 Damascus
  assert.equal(tzOffsetFor(null, at), 180); // no position → Damascus (bundled POIs)
});
test('outside Syria: device-local time', () => {
  const local10 = new Date(2026, 10, 4, 10, 0), local20 = new Date(2026, 10, 4, 20, 0);
  assert.equal(tzOffsetFor(BER, local10), -local10.getTimezoneOffset());
  assert.equal(ohStatus(H, local10, BER).open, true);
  assert.equal(ohStatus(H, local20, BER).open, false);
  assert.match(ohStatus(H, local10, BER).text, /18:00/);
});
test('unparsable hours → null (counted as "no opening hours" by the filter)', () => {
  assert.equal(ohStatus('by appointment, ask Ahmad', new Date(), BER), null);
  const poi = read('js/poi.js');
  assert.match(poi, /known = list\.filter\(r => st\(r\)\)/);
  assert.match(poi, /list = list\.filter\(r => st\(r\) \? st\(r\)\.open : state\.showNoHours\)/); // unparsable = no hours (hidden unless \"Show anyway\")
});
test('no opening_hours.js library shipped', () => {
  assert.equal(existsSync(new URL('../../js/vendor', import.meta.url)), false);
  assert.ok(!/opening_hours\.js|oh-lib|suncalc/.test(read('sw.js') + read('js/search.js') + read('js/place.js')));
});
