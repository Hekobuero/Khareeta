// Start language = phone language (de/en/ar, otherwise en). Run: node --test 'tests/lang/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLang } from '../../js/i18n.js';

const cases = [
  [['de-DE'], null, 'de'], [['ar-SY'], null, 'ar'], [['en-US'], null, 'en'],
  [['fr-FR'], null, 'en'], [['fr-FR', 'de'], null, 'de'], [['de-DE'], 'ar', 'ar'],
  [['DE-at'], null, 'de'], [['en-GB', 'ar'], null, 'en'], [[], null, 'en'], [undefined, null, 'en'],
];
for (const [list, saved, want] of cases)
  test(`${JSON.stringify(list)} saved=${saved} -> ${want}`, () => assert.equal(pickLang(list, saved), want));
