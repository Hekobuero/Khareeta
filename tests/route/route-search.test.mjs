// QA P2: the route start/stop/destination field must use the same search pipeline + normalisation as the main search
// (Arabic queries such as "قصر العظم" returned nothing in the waypoint field). Run: node --test 'tests/route/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanQuery, photonLang, rank, dedupe } from '../../js/suggest.js';

const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('cleanQuery strips tashkeel, tatweel, bidi/zero-width marks and extra spaces', () => {
  assert.equal(cleanQuery('قصر العظم'), 'قصر العظم');
  assert.equal(cleanQuery('قَصْر العَظْم'), 'قصر العظم');
  assert.equal(cleanQuery('قصــر  العظم\u200f'), 'قصر العظم');
  assert.equal(cleanQuery('\u202bقصر\u200c العظم\u202c '), 'قصر العظم');
  assert.equal(cleanQuery('  Azm   Palace '), 'Azm Palace');
  assert.equal(cleanQuery(null), '');
});

test('photonLang: Arabic UI → native names (default), same for every field', () => {
  assert.equal(photonLang('ar'), 'default'); assert.equal(photonLang('en'), 'en'); assert.equal(photonLang('de'), 'de');
});

test('route stops use placeSuggest (the main search pipeline), not their own Photon call', () => {
  const r = read('js/route.js'), s = read('js/search.js');
  assert.match(r, /import \{ placeSuggest \} from '\.\/search\.js'/);
  assert.match(r, /await placeSuggest\(q, \{ signal: ctl\.signal \}\)/);
  assert.doesNotMatch(r, /photonSearch\(/);
  assert.match(s, /export async function placeSuggest/);
  // the main search goes through the same function, and the pipeline includes the local (normalised) POI index
  assert.match(s, /await placeSuggest\(text, \{ signal: photonCtl\.signal \}\)/);
  const fn = s.slice(s.indexOf('export async function placeSuggest'), s.indexOf('export function offlineNotice'));
  for (const k of ['cleanQuery(raw)', 'poiLocal(text)', 'localSearch(text)', 'photonLang(getLang())', 'rank(res, text, bbox)', 'dedupe(']) assert.ok(fn.includes(k), k);
  // Photon failure (offline / 504) must not hide local hits
  assert.match(fn, /catch \(e\) \{ if \(e\.name === 'AbortError' \|\| signal\?\.aborted\) throw e; \}/);
});

test('Arabic hits from Photon survive ranking + de-duplication', () => {
  const hit = (name, lon, lat, id, tags = { historic: 'castle' }) => ({ id, name, sub: 'دمشق', lon, lat, cc: 'SY', tags });
  const list = [hit('قصر العظم', 36.307, 33.5102, 'W102768609'), hit('قصر العظم', 36.3071, 33.5101, 'N1')];
  const { settlements, rest } = rank(list, 'قصر العظم');
  const out = dedupe([...settlements, ...rest]);
  assert.equal(out.length, 1); assert.equal(out[0].name, 'قصر العظم');
});
