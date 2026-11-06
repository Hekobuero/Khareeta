// i18n.js load path + cache-bust (DuckDuckGo iOS showed the raw key "emChip"). No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EN, AR, DE } from '../poi/_i18n-load.mjs';
const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const V = read('js/util.js').match(/const VERSION = '([^']+)'/)[1];

test('emChip in EN/AR/DE (Notfall)', () => {
  assert.equal(EN.emChip, 'Emergency'); assert.equal(DE.emChip, 'Notfall'); assert.ok(AR.emChip);
});
test('index.html maps i18n.js to ?v=VERSION (import map before any module) + versioned modulepreload', () => {
  const h = read('index.html');
  const m = h.match(/<script type="importmap">([^<]+)<\/script>/); assert.ok(m, 'import map');
  assert.equal(JSON.parse(m[1]).imports['./js/i18n.js'], `./js/i18n.js?v=${V}`);
  assert.ok(h.indexOf('type="importmap"') < h.indexOf('rel="modulepreload"'), 'import map precedes modulepreload/modules');
  assert.ok(h.indexOf('type="importmap"') < h.indexOf('type="module"'));
  assert.match(h, new RegExp(`modulepreload" href="js/i18n\\.js\\?v=${V}"`));
  assert.doesNotMatch(h, /modulepreload" href="js\/i18n\.js"/);
});
test('modules import i18n.js by the mapped specifier (./i18n.js from js/)', () => {
  for (const f of fs.readdirSync(new URL('../../js/', import.meta.url))) if (f.endsWith('.js')) {
    const s = read('js/' + f); for (const m of s.matchAll(/from '([^']*\/i18n\.js[^']*)'/g)) assert.equal(m[1], './i18n.js', f);
  }
});
test('emergency chip label goes through t()', () => assert.match(read('js/search.js'), /esc\(t\('emChip'\)\)/));
test('sw.js VERSION matches; i18n.js in shell; CNAME unchanged', () => {
  assert.equal(read('sw.js').match(/const VERSION = '([^']+)'/)[1], V);
  assert.ok(read('sw.js').includes("'js/i18n.js'"));
  assert.equal(read('CNAME').trim(), 'khareeta.app');
});
