import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HEALTH_I18N } from '../../js/health-core.js';

const rd = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('each HEALTH_I18N key appears once per language after merge path is present', () => {
  const src = rd('js/i18n.js');
  assert.match(src, /from '\.\/health-core\.js'/);
  assert.match(src, /HEALTH_I18N/);
  // Keys live in health-core; i18n merges them – count keys in HEALTH_I18N itself
  for (const k of Object.keys(HEALTH_I18N.en)) {
    assert.equal((rd('js/health-core.js').match(new RegExp('\\b' + k + ':', 'g')) || []).length, 3, k);
  }
});

test('relative paths only in health UI module (no absolute / fetches)', () => {
  const s = rd('js/health.js');
  assert.ok(!/fetch\(['"`]\//.test(s));
  assert.ok(!/https?:\/\//.test(s), 'health.js should not hardcode remote URLs (sources live in core)');
});
