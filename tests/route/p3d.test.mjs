// P3 bundle 3 (#39 follow-up): AR landmark + distance keeps the "after" relation – maneuver first, then «بعد <landmark>».
// No network. Run: node --test tests/route/p3d.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.document ??= { documentElement: { lang: '', dir: '', setAttribute() {} }, querySelector: () => null, addEventListener() {} };

const { formatLandmarkInstr, stripNestedArAfter } = await import('../../js/landmarks.js');
const { setLang, t } = await import('../../js/i18n.js');
const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');

// same composition as voice.js announce(): landmark maneuver → stripNestedArAfter (distance stage) → inDist
function distPrompt(lang, variant, lm, action, d) {
  setLang(lang);
  const o = t(variant);
  const i = stripNestedArAfter(formatLandmarkInstr(lm, action, { text: lm.relation === 'after' ? o.lmAfter : o.lmAt, art: '' }), lang);
  return fill(o.inDist, { d, i });
}

test('AR voice (MSA + Syrian): «بعد مئة متر، انعطف يسارًا بعد جامع الجوزية»', () => {
  const lm = { name: 'جامع الجوزية', kind: 'worship', relation: 'after' };
  assert.equal(distPrompt('ar', 'voMsa', lm, 'انعطف يسارًا', 'مئة متر'), 'بعد مئة متر، انعطف يسارًا بعد جامع الجوزية.');
  assert.equal(distPrompt('ar', 'vo', lm, 'لفّ يسار', 'مية متر'), 'بعد مية متر، لفّ يسار بعد جامع الجوزية.');
  // never the old broken form «…، جامع الجوزية، انعطف…»
  assert.doesNotMatch(distPrompt('ar', 'voMsa', lm, 'انعطف يسارًا', 'مئة متر'), /متر، جامع/);
});

test('AR banner: maneuver, then «بعد/عند <landmark>»', () => {
  setLang('ar');
  assert.equal(formatLandmarkInstr({ name: 'جامع الجوزية', relation: 'after' }, 'انعطف يسارًا', { text: t('lmAfter') }), 'انعطف يسارًا بعد جامع الجوزية');
  assert.equal(formatLandmarkInstr({ name: 'جامع الجوزية', relation: 'at' }, 'انعطف يسارًا', { text: t('lmAt') }), 'انعطف يسارًا عند جامع الجوزية');
});

test('EN/DE landmark prompts unchanged', () => {
  const lm = { name: 'Al-Jawziyya Mosque', kind: 'worship', relation: 'after' };
  assert.equal(distPrompt('en', 'vo', lm, 'turn left', '100 metres'), 'In 100 metres, after Al-Jawziyya Mosque, turn left.');
});
