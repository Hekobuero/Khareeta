// Gesundheit/Notfall – pure unit tests (no network). Run: node --test 'tests/health/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EMERGENCY_NUMBERS, NEARBY_ACTIONS, telHref, findNumber, HEALTH_I18N,
} from '../../js/health-core.js';

const rd = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('confirmed Syrian short codes only (110 / 112 / 113)', () => {
  assert.deepEqual(EMERGENCY_NUMBERS.map(n => n.dial).sort(), ['110', '112', '113']);
  assert.equal(findNumber('ambulance').dial, '110');
  assert.equal(findNumber('police').dial, '112');
  assert.equal(findNumber('fire').dial, '113');
  assert.equal(findNumber('poison'), null);
});

test('every number has institutional sources with URL + statement', () => {
  for (const n of EMERGENCY_NUMBERS) {
    assert.ok(n.sources.length >= 1, n.id);
    for (const s of n.sources) {
      assert.match(s.url, /^https:\/\//);
      assert.ok(s.name.length > 5);
      assert.ok(s.states.includes(n.dial), `${n.id} source must state the dial code`);
      assert.ok(!/wikipedia\.org/i.test(s.url), 'Wikipedia must not be the cited source');
    }
  }
});

test('tel: hrefs are digits-only short codes', () => {
  assert.equal(telHref('110'), 'tel:110');
  assert.equal(telHref('112'), 'tel:112');
  assert.equal(telHref('113'), 'tel:113');
  assert.equal(telHref('+963 110'), 'tel:963110');
  assert.equal(telHref(''), null);
  assert.equal(telHref(null), null);
});

test('nearby actions reuse existing chip categories (no second Overpass client)', () => {
  assert.deepEqual(NEARBY_ACTIONS.map(a => a.cat).sort(), ['hospital', 'hospital', 'pharmacy'].sort());
  const search = rd('js/search.js');
  assert.match(search, /\['hospital'/);
  assert.match(search, /\['pharmacy'/);
  const health = rd('js/health.js');
  assert.match(health, /applyChips/);
  assert.ok(!/overpass\s*\(/.test(health), 'health.js must not call Overpass directly');
  assert.ok(!/nominatim|photon|supabase|mapbox|google|here\.com|bing/i.test(health));
});

test('HEALTH_I18N keys match across en/ar/de', () => {
  const keys = Object.keys(HEALTH_I18N.en).sort();
  for (const l of ['ar', 'de']) assert.deepEqual(Object.keys(HEALTH_I18N[l]).sort(), keys, l);
  assert.ok(HEALTH_I18N.en.emSyriaLabel.toLowerCase().includes('syria'));
  assert.ok(HEALTH_I18N.de.emSyriaLabel.toLowerCase().includes('syr'));
  assert.ok(/سوريا/.test(HEALTH_I18N.ar.emSyriaLabel));
});

test('wiring: precache, i18n merge, chip + drawer entry, CNAME untouched', () => {
  const sw = rd('sw.js');
  assert.ok(sw.includes("'js/health-core.js'"));
  assert.ok(sw.includes("'js/health.js'"));
  assert.match(rd('js/i18n.js'), /HEALTH_I18N/);
  assert.match(rd('js/search.js'), /data-health/);
  assert.match(rd('js/app.js'), /openHealthSheet/);
  assert.match(rd('js/ui.js'), /data-a="health"/);
  assert.equal(rd('CNAME').trim(), 'khareeta.app');
});

test('opening the sheet must not force a Syria/Damascus jump (code contract)', () => {
  const health = rd('js/health.js');
  assert.ok(!/SY_BBOX|Damascus|36\.29|33\.51|flyTo|jumpTo|setCenter|easeTo/.test(health));
  assert.match(health, /applyChips/);
  assert.match(rd('js/health.js'), /healthSheetMovesMap[\s\S]*return false/);
});

test('no API keys / third-party health APIs in new modules', () => {
  for (const f of ['js/health-core.js', 'js/health.js']) {
    const s = rd(f);
    assert.ok(!/api[_-]?key|AIza|pk\.|sk\.|mapbox|googleapis|hereapi|bing|apple\.com\/maps/i.test(s), f);
    assert.ok(!/open-meteo|weatherapi|healthapi/i.test(s), f);
  }
});
