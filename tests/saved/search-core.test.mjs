import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normText, stripArticle, damerau, matchScore, buildIndex, searchIndex, gazetteerEntries, keysOf } from '../../js/search-core.js';

const gz = JSON.parse(readFileSync(new URL('../../data/gazetteer-sy.json', import.meta.url)));
const idx = buildIndex(gazetteerEntries(gz));
const top = q => searchIndex(idx, q, { limit: 3 })[0];

test('arabic normalisation: taa marbuta, alef forms, tashkeel, tatweel', () => {
  assert.equal(normText('حمصة'), normText('حمصه'));
  assert.equal(normText('اللاذقيّة'), normText('اللاذقيه'));
  assert.equal(normText('إدلب'), normText('ادلب'));
  assert.equal(normText('دمـــشق'), normText('دمشق'));
  assert.equal(normText('مُسْتَشْفَى'), normText('مستشفي'));
  assert.equal(stripArticle(normText('اللاذقيه')), normText('لاذقيه'));
});
test('damerau-levenshtein incl. transposition', () => {
  assert.equal(damerau('damascus', 'damaskus'), 1);
  assert.equal(damerau('homs', 'hmos'), 1);
  assert.equal(damerau('abc', 'abc'), 0);
});
test('fuzzy matching scores', () => {
  const n = normText;
  assert.equal(matchScore(n('حمصة'), n('حمصه')), 100);
  assert.ok(matchScore(n('حمصي'), n('حمص')) >= 50);
  assert.ok(matchScore(n('damaskus'), n('damascus')) >= 50);
  assert.equal(matchScore(n('aleppo'), n('xyzq')), 0);
});
test('gazetteer: typos and variants find the right city', () => {
  for (const [q, en] of [['حمص', 'Homs'], ['حمصه', 'Homs'], ['اللاذقية', 'Latakia'], ['لاذقيه', 'Latakia'], ['Damascus', 'Damascus'],
    ['Damaskus', 'Damascus'], ['دمشق', 'Damascus'], ['Halab', 'Aleppo'], ['Lattakia', 'Latakia'], ['Hims', 'Homs']]) {
    const r = top(q); assert.ok(r, q); assert.equal(r.en, en, q + ' → ' + r.en);
  }
});
test('gazetteer is compact and well-formed', () => {
  assert.equal(gz.v, 1); assert.ok(gz.p.length > 1000);
  assert.ok(readFileSync(new URL('../../data/gazetteer-sy.json', import.meta.url)).length < 400_000);
  for (const p of gz.p.slice(0, 50)) { assert.ok(p[2] > 350000 && p[2] < 430000); assert.ok(p[3] > 320000 && p[3] < 375000); }
});
