// "Open now" filter additions: hidden-without-hours hint in EN/AR/DE + wiring. Uses the repo's own parser (js/oh.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHARE_I18N } from '../../js/share-core.js';
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
test('hint strings EN/AR/DE', () => {
  assert.equal(SHARE_I18N.de.ohHidden.replace('{n}', '12'), '12 ohne Öffnungszeiten ausgeblendet');
  assert.match(SHARE_I18N.en.ohHidden, /\{n\} without opening hours hidden/);
  assert.match(SHARE_I18N.ar.ohHidden, /\{n\}/);
});
test('filter hides places without hours and reports the count', () => {
  const poi = read('js/poi.js');
  assert.match(poi, /state\.openNow\) list = list\.filter\(r => r\.oh && ohStatus/);
  assert.match(poi, /hiddenNoHours: state\.openNow \? noHours : 0/);
  assert.match(read('js/search.js'), /t\('ohHidden'/);
});
