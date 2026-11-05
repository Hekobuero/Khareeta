// Health/emergency actions must be reachable on open, without manually expanding the sheet.
// 390×844 + shorter iPhone viewport, WebKit/Chromium, EN/AR/DE. All external traffic blocked/mocked.
// Run: node health-sheet.test.js
const pw = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(process.env.KH_REPO || path.join(__dirname, '..', '..'));
const OUT = path.join(__dirname, 'out', 'health-sheet'); fs.mkdirSync(OUT, { recursive: true });
const PORT = +(process.env.HS_PORT || 8799), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});

const assert = require('node:assert/strict');
(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  for (const engine of (process.env.ENGINES || 'webkit,chromium').split(',')) {
    const browser = await pw[engine].launch();
    try {
      for (const lang of ['de', 'ar', 'en']) for (const height of [844, 664]) {
        const ctx = await browser.newContext({ ...pw.devices['iPhone 13'], viewport: { width: 390, height }, serviceWorkers: 'block' });
        try {
          await ctx.addInitScript(({ lang }) => {
            localStorage.setItem('kh.lang', lang); localStorage.setItem('kh.onboarded', '1');
            localStorage.setItem('kh.view', JSON.stringify({ c: [13.405, 52.52], z: 11 }));
            navigator.geolocation.watchPosition = (s, e) => { setTimeout(() => e?.({ code: 1 }), 10); return 1; };
            navigator.geolocation.getCurrentPosition = (s, e) => setTimeout(() => e?.({ code: 1 }), 10);
          }, { lang });
          let requests = 0;
          await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => {
            if (/overpass/i.test(r.request().url())) {
              requests++;
              return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [
                { type: 'node', id: 101, lat: 52.5212, lon: 13.4098, tags: { amenity: 'hospital', name: 'Mock health result' } }
              ] }) });
            }
            return r.abort();
          });
          const page = await ctx.newPage();
          await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('.chip[data-health]');
          // Wait for map.load → showHome(), otherwise late startup can replace the sheet under test.
          await page.waitForFunction(() => window.KH?.App?.sheetKind === 'home', null, { timeout: 30000 });
          // Begin in the half detent, then use the health entry point for EACH action.
          // No test-side setSheet('full') guard: that would hide the original regression.
          for (const action of ['hospital', 'clinic', 'pharmacy']) {
            await page.evaluate(async () => {
              const { openSheet } = await import(new URL('js/core.js', location.href));
              openSheet('<p>Previous half sheet</p>', 'half');
            });
            await page.waitForTimeout(500);
            await page.evaluate(async () => { (await import(new URL('js/health.js', location.href))).openHealthSheet(); });
            await page.waitForSelector('#sheet[data-state="full"] .em-near', { timeout: 5000 });
            assert.ok(!/\bem[A-Z]\w*\b/.test(await page.locator('#sheet').innerText()), 'no raw emergency keys');
            await page.waitForTimeout(600);
            assert.equal(await page.$eval('#sheetBody', b => getComputedStyle(b).overflowY), 'auto');
            // Every control must be visible OR reachable by scrolling the full sheet body.
            for (const id of ['hospital', 'clinic', 'pharmacy']) {
              const button = page.locator(`.em-near[data-near="${id}"]`);
              await button.scrollIntoViewIfNeeded({ timeout: 3000 });
              const reachable = await button.evaluate(b => {
                const r = b.getBoundingClientRect(), s = document.querySelector('#sheetBody').getBoundingClientRect();
                const vh = window.visualViewport?.height || innerHeight;
                const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                return r.top >= Math.max(0, s.top) && r.bottom <= Math.min(vh, s.bottom) + 1 && b.contains(hit);
              });
              assert.ok(reachable, `${engine}/${lang}/${height}: ${id} reachable`);
            }
            const button = page.locator(`.em-near[data-near="${action}"]`);
            await button.scrollIntoViewIfNeeded({ timeout: 3000 });
            await page.screenshot({ path: path.join(OUT, `${engine}-${lang}-${height}-${action}.png`) });
            await button.tap({ timeout: 3000 });
            await page.waitForSelector('#sheet .srow', { timeout: 15000 });
            assert.equal(await page.$eval('#sheet .srow .t1', e => e.textContent), 'Mock health result');
          }
          assert.equal(requests, 3, 'all three actions use the mocked category path');
          console.log(`PASS ${engine}/${lang}/390×${height}: full on every open, all Nearby controls scrollable and tappable`);
        } finally { await ctx.close(); }
      }
    } finally { await browser.close(); }
  }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => srv.close());
