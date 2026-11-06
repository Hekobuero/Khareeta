// Khareeta – Datensparmodus / data-saver (WebKit iPhone 390×844, DE + AR). Toggle in settings, indicator pill,
// no Open-Meteo / photo / Panoramax fetches while on; Save-Data default when lowData unset. All non-local
// requests aborted (no OSM / Nominatim / Overpass / Photon / Supabase / Open-Meteo). Run: node data-saver.test.js
const { webkit, chromium, devices } = require('playwright');
const BROWSER = (process.env.KH_BROWSER || 'webkit').toLowerCase() === 'chromium' ? chromium : webkit;
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out', 'data-saver'); fs.mkdirSync(OUT, { recursive: true });
const EXTRA = process.env.SHOTS || ''; if (EXTRA) fs.mkdirSync(EXTRA, { recursive: true });
const PORT = +(process.env.DS_PORT || 8791), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.pbf': 'application/x-protobuf', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
async function shot(page, name) { const p = path.join(OUT, name); await page.screenshot({ path: p, fullPage: false }); if (EXTRA) fs.copyFileSync(p, path.join(EXTRA, name)); }
const imp = (page, mod, fn) => page.evaluate(async ([m, f]) => { const x = await import(new URL('js/' + m, location.href)); return (0, eval)(f)(x); }, [mod, fn]);
const POI = { id: 'n9002', osm_type: 'node', osm_id: 9002, name: 'Café Umayyad', sub: 'Damascus', lon: 36.3067, lat: 33.5126, tags: { amenity: 'cafe', name: 'Café Umayyad', image: 'https://commons.wikimedia.org/wiki/File:Test.jpg' }, full: true };

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await BROWSER.launch();
  const dev = { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } };

  // --- A) Save-Data default when lowData was never set ---
  {
    const ctx = await browser.newContext({ ...dev, serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: true, addEventListener() {}, removeEventListener() {} }) });
        localStorage.setItem('kh.lang', 'de');
        localStorage.setItem('kh.onboarded', '1');
        localStorage.removeItem('kh.settings'); // no explicit lowData → honour saveData
      } catch {}
    });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
    const page = await ctx.newPage();
    await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#btnMenu svg'), null, { timeout: 30000 });
    await page.waitForFunction(() => window.KH?.App?.sheetKind === 'home', null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(600);
    const on = await page.evaluate(async () => {
      const u = await import(new URL('js/util.js', location.href));
      return !!u.settings.lowData;
    });
    ok('saveData default: settings.lowData true', on);
    await page.waitForSelector('#lowDataState:not(.hidden)', { timeout: 10000 });
    ok('saveData default: indicator visible', await page.isVisible('#lowDataState'));
    await ctx.close();
  }

  for (const lang of ['de', 'ar']) {
    const tag = lang;
    const ctx = await browser.newContext({ ...dev, locale: lang === 'ar' ? 'ar-SY' : 'de-DE', serviceWorkers: 'block' });
    await ctx.addInitScript(`try {
      localStorage.setItem('kh.lang', ${JSON.stringify(lang)});
      localStorage.setItem('kh.onboarded', '1');
      localStorage.setItem('kh.settings', JSON.stringify({ lowData: false }));
    } catch {}`);
    const blocked = [];
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => {
      const u = r.request().url();
      blocked.push(u);
      return r.abort();
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => { if (!/access control checks|Load failed|cancelled|NetworkError|Failed to fetch/i.test(e.message)) errs.push(e.message); });
    await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#btnMenu svg'), null, { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.waitForFunction(() => window.KH?.App?.sheetKind === 'home', null, { timeout: 30000 }).catch(() => {});

    // Open settings drawer and enable Datensparmodus (harden: wait attached → full if needed → visible → tap)
    await page.tap('#btnMenu'); await page.waitForTimeout(400);
    const lowBtn = page.locator('#drawer [data-a="lowData"]');
    await lowBtn.waitFor({ state: 'attached', timeout: 15000 });
    await lowBtn.scrollIntoViewIfNeeded().catch(() => {});
    if (await lowBtn.evaluate(b => { const r = b.getBoundingClientRect(); return r.bottom > innerHeight || r.top < 0; }).catch(() => true)) {
      // drawer is a side panel – scroll the drawer itself
      await page.evaluate(() => { const d = document.querySelector('#drawer'); if (d) d.scrollTop = d.scrollHeight; });
      await page.waitForTimeout(200);
      await lowBtn.scrollIntoViewIfNeeded().catch(() => {});
    }
    await lowBtn.waitFor({ state: 'visible', timeout: 10000 });
    await shot(page, `${tag}-1-settings-before.png`);
    await lowBtn.tap(); await page.waitForTimeout(700);
    const lowOn = await page.evaluate(async () => (await import(new URL('js/util.js', location.href))).settings.lowData);
    ok(`${tag}: toggle sets lowData`, lowOn);
    await page.waitForSelector('#lowDataState:not(.hidden)', { timeout: 10000 });
    const pill = await page.$eval('#lowDataState', e => e.textContent.trim());
    ok(`${tag}: indicator label`, lang === 'ar' ? /توفير/.test(pill) : /Datensparen|Data saver/i.test(pill), pill);
    // Close drawer so the map indicator + place sheet are visible for screenshots
    await page.evaluate(async () => { (await import(new URL('js/ui.js', location.href))).closeDrawer(); });
    await page.waitForTimeout(400);
    await page.waitForFunction(() => window.KH?.App?.sheetKind === 'home', null, { timeout: 10000 }).catch(() => {});
    await shot(page, `${tag}-2-indicator.png`);

    // Place sheet: weather group absent, no open-meteo in blocked list after open
    const before = blocked.length;
    await imp(page, 'place.js', `m => m.openPlace(${JSON.stringify(POI)}, { noFly: true })`);
    await page.waitForTimeout(900);
    const pTitle = page.locator('.sheet .ptitle, #sheet .ptitle, .sheet h1, #sheet h1').first();
    await pTitle.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    if (await page.locator('#pSave').evaluate(b => { const r = b.getBoundingClientRect(); return r.bottom > innerHeight || r.top < 0; }).catch(() => true)) {
      await page.evaluate(async () => { (await import(new URL('js/core.js', location.href))).setSheet('full'); });
      await page.waitForTimeout(500);
    }
    // Harden half-sheet: ensure sheet is home-adjacent content; pull full if needed to inspect body
    const wx = await page.$('#pWxG');
    ok(`${tag}: no weather block in place sheet`, !wx);
    const meteo = blocked.slice(before).filter(u => /open-meteo|panoramax|wikimedia|wikipedia|wikidata/i.test(u));
    ok(`${tag}: no weather/photo network while lowData`, meteo.length === 0, meteo.slice(0, 3).join(' | '));
    await shot(page, `${tag}-3-place-no-weather.png`);

    // Attribution still visible
    ok(`${tag}: OSM attribution visible`, await page.evaluate(() => {
      const e = document.querySelector('.kattr-osm');
      return !!e && e.getBoundingClientRect().width > 0 && /OpenStreetMap/.test(e.textContent);
    }));

    ok(`${tag}: no page errors`, !errs.length, errs.join(' / '));
    await ctx.close();
  }

  await browser.close(); srv.close();
  const f = results.filter(x => !x).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
