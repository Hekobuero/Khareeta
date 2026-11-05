// P3 bundle 3 (#38 follow-up): fuzzy short Latin typos prefer major cities, Arabic presentation forms (NFKC),
// one in-flight Photon request per query while typing. fetch is mocked – no Photon/Nominatim/OSM calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex, searchIndex, gazetteerEntries, normText } from '../../js/search-core.js';
import { cleanQuery, photonSearch, photonInflightCount } from '../../js/suggest.js';

const g = JSON.parse(readFileSync(new URL('../../data/gazetteer-sy.json', import.meta.url), 'utf8'));
const ix = buildIndex(gazetteerEntries(g));
const top = q => searchIndex(ix, q, { limit: 3 })[0];

test('"Hmos" → Homs (city) before Hosh Sahya; other short typos of major cities', () => {
  assert.equal(top('Hmos').en, 'Homs');
  assert.equal(top('Homs').en, 'Homs');
  assert.equal(top('Alepo').en, 'Aleppo');
  assert.equal(top('Damscus').en, 'Damascus');
  // exact smaller places still win on an exact query
  assert.equal(top('Hosh Sahya').en, 'Hosh Sahya');
});

test('Arabic presentation forms are NFKC-normalised before matching', () => {
  assert.equal(normText('ﺣﻠﺐ'), normText('حلب'));
  assert.equal(normText('ﺣﻤﺺ'), 'حمص');
  assert.equal(normText('ﻣﺪﻳﻨﺔ'), normText('مدينه')); // ta marbuta rule still applies after NFKC
  assert.equal(normText('ﺃﺭﻳﺤﺎ'), normText('اريحا')); // alef-hamza rule after NFKC
  assert.equal(cleanQuery('ﺣﻠﺐ'), 'حلب');
  assert.equal(top('ﺣﻠﺐ').en, 'Aleppo');
  assert.equal(top('ﺣﻤﺺ').en, 'Homs');
});

const jsonRes = feats => ({ ok: true, json: async () => ({ features: feats }) });

test('typing: exactly one Photon request per query; identical in-flight queries coalesce', async () => {
  const urls = []; const orig = globalThis.fetch; let release;
  const gate = new Promise(r => { release = r; });
  globalThis.fetch = async (u) => { urls.push(String(u)); await gate; return jsonRes([{ geometry: { coordinates: [36.72, 34.73] }, properties: { osm_type: 'N', osm_id: 1, osm_key: 'place', osm_value: 'city', name: 'Homs' } }]); };
  try {
    const opts = { center: [36.7, 34.7], zoom: 10, view: [36.5, 34.5, 36.9, 34.9], single: true };
    const a = photonSearch('Homs', opts), b = photonSearch('Homs', opts);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(urls.length, 1, 'one request for two identical in-flight queries');
    assert.equal(photonInflightCount(), 1);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra[0].properties.name, 'Homs'); assert.equal(rb.length, 1);
    assert.equal(ra[0].properties.placeHit, true, 'settlement in view region keeps the cross-script place flag');
    assert.equal(photonInflightCount(), 0);
    assert.ok(urls.every(u => u.startsWith('https://photon.komoot.io/api/')));
  } finally { globalThis.fetch = orig; }
});

test('typing: aborting a superseded keystroke does not cancel a still-waiting identical query', async () => {
  const urls = []; const orig = globalThis.fetch;
  globalThis.fetch = async (u, o) => { urls.push(String(u)); await new Promise(r => setTimeout(r, 20)); if (o?.signal?.aborted) throw Object.assign(new Error('a'), { name: 'AbortError' }); return jsonRes([]); };
  try {
    const c1 = new AbortController();
    const p1 = photonSearch('Hama', { single: true, signal: c1.signal });
    const p2 = photonSearch('Hama', { single: true });
    c1.abort();
    await assert.rejects(p1, e => e.name === 'AbortError');
    assert.deepEqual(await p2, []);
    assert.equal(urls.length, 1);
  } finally { globalThis.fetch = orig; }
});

test('placeSuggest (per keystroke) uses the single-request Photon mode', () => {
  const s = readFileSync(new URL('../../js/search.js', import.meta.url), 'utf8');
  const fn = s.slice(s.indexOf('export async function placeSuggest'), s.indexOf('export function offlineNotice'));
  assert.equal((fn.match(/photonSearch\(/g) || []).length, 1);
  assert.match(fn, /single: true/);
});
