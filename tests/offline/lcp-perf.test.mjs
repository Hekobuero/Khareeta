// Locks in cold-start performance guards: deferred heavy modules, weather-core,
// no planet TileJSON preload, VERSION sync, CNAME. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const rd = f => readFileSync(join(root, f), 'utf8');

test('CNAME is khareeta.app', () => {
  assert.equal(rd('CNAME').trim(), 'khareeta.app');
});

test('VERSION matches in util.js and sw.js', () => {
  const vu = rd('js/util.js').match(/const VERSION = '([0-9-]+)'/)[1];
  const vs = rd('sw.js').match(/const VERSION = '([0-9-]+)'/)[1];
  assert.equal(vu, vs);
  assert.match(vu, /^\d{8}-\d{4}$/);
});

test('weather-core exists and is precached; place re-exports it', () => {
  assert.ok(existsSync(join(root, 'js/weather-core.js')));
  const wx = rd('js/weather-core.js');
  assert.match(wx, /export async function weatherRaw/);
  assert.match(wx, /export function wmo/);
  assert.match(wx, /open-meteo\.com/);
  assert.match(rd('js/place.js'), /weather-core/);
  assert.match(rd('sw.js'), /js\/weather-core\.js/);
  assert.match(rd('js/app.js'), /from '\.\/weather-core\.js'/);
});

test('app.js does not statically import heavy feature modules', () => {
  const app = rd('js/app.js');
  // Booted via dynamic import() so MapLibre wins the Slow-4G pipe.
  // voice.js is pulled later by ui.js (drawer) / route.js (nav).
  for (const mod of ['place.js', 'route.js', 'analytics.js', 'closures.js', 'transit.js', 'overture.js', 'health.js']) {
    const fromRe = new RegExp(`from\\s+'\\./${mod.replace('.', '\\.')}'`);
    const dynRe = new RegExp(`import\\('\\./${mod.replace('.', '\\.')}'\\)`);
    assert.doesNotMatch(app, fromRe, `static import of ${mod}`);
    assert.match(app, dynRe, `dynamic import of ${mod}`);
  }
  assert.doesNotMatch(app, /from\s+'\.\/voice\.js'/);
  assert.match(rd('js/ui.js'), /import\('\.\/voice\.js'\)/);
});

test('search.js and ui.js do not statically import place.js', () => {
  assert.doesNotMatch(rd('js/search.js'), /from\s+'\.\/place\.js'/);
  assert.doesNotMatch(rd('js/ui.js'), /from\s+'\.\/place\.js'/);
  assert.match(rd('js/search.js'), /import\('\.\/place\.js'\)/);
});

test('index.html: maplibre deferred, no planet preload, modulepreload critical path', () => {
  const html = rd('index.html');
  assert.match(html, /<script defer src="vendor\/maplibre-gl\/maplibre-gl\.js">/);
  assert.match(html, /<script type="module" src="js\/app\.js">/);
  assert.doesNotMatch(html, /rel="preload"[^>]*tiles\.openfreemap\.org\/planet/);
  assert.match(html, /rel="preconnect"[^>]*tiles\.openfreemap\.org/);
  assert.match(html, /rel="modulepreload"[^>]*js\/app\.js/);
  assert.match(html, /rel="modulepreload"[^>]*js\/util\.js/);
  assert.match(html, /rel="modulepreload"[^>]*js\/i18n\.js/);
  const classic = [...html.matchAll(/<script(?![^>]*type=)[^>]*>/g)].map(m => m[0]);
  for (const tag of classic) {
    if (tag.includes('src=')) assert.match(tag, /\bdefer\b|\basync\b/);
  }
});

test('data-saver gates still wired (lowdata-core)', () => {
  assert.match(rd('js/lowdata-core.js'), /allowPlaceExtras/);
  assert.match(rd('js/app.js'), /settings\.lowData/);
  assert.match(rd('index.html'), /id="lowDataState"/);
});

test('relative paths only in new weather-core (no absolute app URLs)', () => {
  const s = rd('js/weather-core.js');
  assert.doesNotMatch(s, /https:\/\/khareeta\.app/);
  assert.doesNotMatch(s, /from '\//);
});
