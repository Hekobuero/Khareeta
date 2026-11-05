import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t, setLang, getLang } from '../../js/i18n.js';

const rd = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('every emergency UI key is inline once per language and resolves through real t()', () => {
  const src = rd('js/i18n.js');
  const ui = ['js/health.js', 'js/health-core.js', 'js/search.js', 'js/ui.js', 'index.html'].map(rd).join('\n');
  // Include direct t('em…'), data-i18n keys, and dynamic labelKey values.
  const keys = [...new Set([...ui.matchAll(/(?:\bt\(['"]|labelKey:\s*['"]|data-i18n=['"])(em[A-Z]\w*)/g)].map(m => m[1]))];
  assert.equal(keys.length, 15, 'all current health UI keys discovered');
  const originalDoc = globalThis.document, originalLang = getLang();
  globalThis.document = { documentElement: {} };
  try {
    for (const lang of ['de', 'en', 'ar']) {
      const table = src.split('\n' + lang + ': {\n')[1].split(/\n(?:en|ar|de): \{/)[0];
      setLang(lang);
      for (const key of keys) {
        assert.equal([...table.matchAll(new RegExp('\\b' + key + ':', 'g'))].length, 1, `${lang}.${key} inline (not English fallback)`);
        const value = t(key, { n: '110' });
        assert.equal(typeof value, 'string', `${lang}.${key}`);
        assert.ok(value.trim() && value !== key, `${lang}.${key} must not render a raw key`);
        assert.ok(!value.includes('{n}'), `${lang}.${key} interpolation`);
      }
      assert.ok(!/\bem[A-Z]\w*\b/.test(t('emTitle')));
    }
    setLang('de'); assert.match(t('emSyriaLabel'), /Syr/);
    setLang('en'); assert.match(t('emSyriaLabel'), /Syria/);
    setLang('ar'); assert.match(t('emSyriaLabel'), /سوريا/);
  } finally {
    setLang(originalLang); globalThis.document = originalDoc;
  }
});

test('relative paths only in health UI module (no absolute / fetches)', () => {
  const s = rd('js/health.js');
  assert.ok(!/fetch\(['"`]\//.test(s));
  assert.ok(!/https?:\/\//.test(s), 'health.js should not hardcode remote URLs (sources live in core)');
});
