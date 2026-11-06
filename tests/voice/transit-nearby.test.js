// Existing transit layer: nearest stops from GPS/place, OSM memberships and line drawing.
// All non-local requests are blocked. Transit files are deterministic fixtures, not live OSM.
const { chromium, webkit, devices } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '../..'), OUT = process.env.SHOTS || path.join(__dirname, 'out/transit-nearby');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, new URL(req.url, 'http://x').pathname);
  if (!f.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { res.writeHead(e ? 404 : 200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(e ? '' : b); });
});
function data(city) {
  const c = city === 'aleppo' ? [37.15, 36.2] : [36.3, 33.5];
  return { stops: [{ id: 1, c, name_ar: 'موقف الاختبار', name_en: 'Test stop' }, { id: 2, c: [c[0] + .005, c[1]] }],
    lines: [{ id: 10, name_ar: 'خط الجامعة', name_en: 'University line', mode: 'bus', ref: '12', stops: [0, 1], geom: [[c, [c[0] + .01, c[1]]]] },
      { id: 11, mode: 'share_taxi', stops: [0], geom: [[c, [c[0], c[1] + .01]]] }] };
}
let checks = 0;
async function tap(page, selector) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'attached' });
  await page.waitForTimeout(450); // wait for the sheet's spring before measuring its final position
  const r = await el.boundingBox();
  if (!r || r.y + r.height > await page.evaluate(() => innerHeight - 16)) await page.evaluate(async () => (await import('./js/core.js')).setSheet('full'));
  await el.waitFor({ state: 'visible' });
  await el.tap();
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  for (const type of (process.env.BROWSER === 'chromium' ? [chromium] : [chromium, webkit])) {
    const browser = await type.launch({ headless: true });
    try {
      for (const lang of ['ar', 'de', 'en']) {
        const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, serviceWorkers: 'block', geolocation: { longitude: 36.3, latitude: 33.5 }, permissions: ['geolocation'] });
        await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
        await ctx.route('**/data/transit/damascus.json*', r => r.fulfill({ json: data('damascus') }));
        await ctx.route('**/data/transit/aleppo.json*', r => r.fulfill({ json: data('aleppo') }));
        await ctx.addInitScript(l => {
          localStorage.setItem('kh.onboarded', '1'); localStorage.setItem('kh.lang', l);
          localStorage.setItem('kh.settings', JSON.stringify({ lowData: true }));
        }, lang);
        const page = await ctx.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.setDefaultTimeout(15000);
        await page.goto(url);
        await page.waitForFunction(() => window.KH?.App?.sheetKind === 'home');
        await page.evaluate(async () => {
          const { App } = await import('./js/core.js');
          await (await import('./js/place.js')).openPlace({ lon: 36.3, lat: 33.5, name: 'مكان الاختبار', coord: true, full: true }, { noFly: true });
        });
        await tap(page, '#pTransit');
        await page.locator('[data-s="0"]').waitFor();
        assert.equal(await page.locator('[data-s]').count(), 2); checks++;
        assert.match(await page.locator('[data-s="0"]').textContent(), lang === 'ar' ? /خط الجامعة/ : /University line/); checks++;
        const labels = await page.evaluate(async () => { const { t } = await import('./js/i18n.js'); return { unnamed: t('trUnnamed'), empty: t('trNearbyEmpty'), coverage: t('trNearbyCoverage'), locErr: t('locErr') }; });
        assert.match(await page.locator('[data-s="1"]').textContent(), new RegExp(labels.unnamed)); checks++;
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); checks++;
        await page.screenshot({ path: path.join(OUT, `${type.name()}-${lang}-nearest.png`) });
        await tap(page, '[data-s="0"]');
        const selected = await page.evaluate(async () => { const d = await (await import('./js/core.js')).App.map.getSource('kh-tr-sel').getData(); return d.features.map(f => f.id); });
        assert.deepEqual(selected.sort(), [10, 11]); checks++;
        await tap(page, '[data-l="10"]');
        assert.deepEqual(await page.evaluate(async () => { const d = await (await import('./js/core.js')).App.map.getSource('kh-tr-sel').getData(); return d.features.map(f => f.id); }), [10]); checks++;
        await page.screenshot({ path: path.join(OUT, `${type.name()}-${lang}-line.png`) });
        await tap(page, '#trNearBack');
        await tap(page, '#trAll');
        await page.evaluate(async () => { (await import('./js/core.js')).App.me = null; });
        await tap(page, '#trNearMe'); // actual geolocation API, mocked by browser context
        await page.locator('[data-s="0"]').waitFor();
        assert.equal(await page.locator('[data-s]').count(), 2); checks++;
        await page.evaluate(async () => { const { App } = await import('./js/core.js'); await (await import('./js/transit.js')).openNearbyStops(App.map, { lon: 37.15, lat: 36.2, name: 'حلب' }); });
        assert.equal(await page.evaluate(async () => (await import('./js/transit.js'))._state.city), 'aleppo'); checks++;
        await page.evaluate(async () => { const { App } = await import('./js/core.js'); await (await import('./js/transit.js')).openNearbyStops(App.map, { lon: 37.29, lat: 36.29, name: 'بعيد' }); });
        assert.equal(await page.locator('.tr-empty').textContent(), labels.empty); checks++;
        await page.evaluate(async () => { const { App } = await import('./js/core.js'); await (await import('./js/transit.js')).openNearbyStops(App.map, { lon: 13.4, lat: 52.5, name: 'Berlin' }); });
        assert.equal(await page.locator('#toast').textContent(), labels.coverage); checks++;
        assert.equal(await page.evaluate(async () => (await import('./js/transit.js'))._state.city), 'aleppo'); checks++;
        // Permission failure leaves the list usable and never guesses the map centre as GPS.
        await tap(page, '#trAll');
        await page.evaluate(() => { Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(ok, fail) { fail({ code: 1 }); } } }); });
        await tap(page, '#trNearMe');
        assert.equal(await page.locator('#toast').textContent(), labels.locErr); checks++;
        assert.equal(await page.locator('#trNearMe').isEnabled(), true); checks++;
        assert.equal(await page.locator('.kattr-osm').count() > 0, true); checks++;
        assert.deepEqual(errors, []); checks++;
        await ctx.close();
        console.log(`PASS ${type.name()} ${lang}: place/GPS, named/unnamed, stop+line drawing, Aleppo, empty/outside, denied GPS, attribution`);
      }
    } finally { await browser.close(); }
  }
  console.log(`${checks}/${checks} assertions passed`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.close());
