import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rd = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
test('new files are precached by the service worker', () => {
  const sw = rd('sw.js');
  for (const f of ['js/search-core.js', 'js/saved-core.js', 'js/saved.js', 'js/offline-search.js', 'data/gazetteer-sy.json']) assert.ok(sw.includes(`'${f}'`), f);
});
test('new UI strings exist in en/ar/de', () => {
  const src = rd('js/i18n.js');
  for (const k of ['svEdit', 'svDelete', 'svExport', 'svImport', 'svImported', 'svImportErr', 'svName', 'svKind', 'svDone', 'svRoute', 'svFav', 'svLocal', 'svRemoved', 'svExported', 'offLocalOnly', 'gzCity', 'gzVillage', 'svSaveAria'])
    assert.equal((src.match(new RegExp('\\b' + k + ':', 'g')) || []).length, 3, k);
});
test('no external services in new modules, relative paths only', () => {
  for (const f of ['js/search-core.js', 'js/saved-core.js', 'js/saved.js', 'js/offline-search.js']) {
    const s = rd(f); assert.ok(!/https?:\/\//.test(s), f); assert.ok(!/fetch\(['"`]\//.test(s), f);
  }
});
