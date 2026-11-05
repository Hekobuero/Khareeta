// Khareeta P1 – text search "Café" + Enter in Berlin / Paris stays in the current view (z>=12) and lists local cafés;
// far fuzzy gazetteer hits (Café≈Kafr…, Syria) never drive the camera. A Syrian city name from a Syria view still works.
// Everything outside 127.0.0.1 is mocked or aborted (Overpass answers from fixtures; no OSM / Nominatim / Photon / Supabase).
// Run: node text-search-view.test.js  (SHOTS=dir copies the screenshots, ENGINES=webkit,chromium, SHOT_PREFIX=after)
const pw = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(process.env.KH_REPO || path.join(__dirname, '..', '..'));
const OUT = path.join(__dirname, 'out', 'text-search-view'); fs.mkdirSync(OUT, { recursive: true });
const EXTRA = process.env.SHOTS || ''; if (EXTRA) fs.mkdirSync(EXTRA, { recursive: true });
const PFX = process.env.SHOT_PREFIX ? process.env.SHOT_PREFIX + '-' : '';
const PORT = +(process.env.TS_PORT || 8798), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
async function shot(page, name) { const p = path.join(OUT, PFX + name); await page.screenshot({ path: p }); if (EXTRA) fs.copyFileSync(p, path.join(EXTRA, PFX + name)); }
const km = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b[1] - a[1]) * r, dn = (b[0] - a[0]) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

const CITIES = {
  berlin: { c: [13.405, 52.52], inCountry: c => c[0] > 5.5 && c[0] < 15.5 && c[1] > 47 && c[1] < 55.5,
    cafes: [[52.5212, 13.4098, 'Café Mitte'], [52.5181, 13.4003, 'Kaffeehaus Spree'], [52.5235, 13.3990, 'Röstbar']] },
  paris: { c: [2.3522, 48.8566], inCountry: c => c[0] > -5 && c[0] < 8.5 && c[1] > 42 && c[1] < 51.5,
    cafes: [[48.8572, 2.3530, 'Café de la Ville'], [48.8551, 2.3498, 'Le Petit Café'], [48.8590, 2.3555, 'Café Rivoli']] },
};
const overpassFor = city => ({ elements: city.cafes.map(([lat, lon, name], i) => ({ type: 'node', id: 500 + i, lat, lon, tags: { amenity: 'cafe', name } })) });
const photonFor = city => ({ type: 'FeatureCollection', features: city.cafes.map(([lat, lon, name], i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { osm_id: 900 + i, osm_type: 'N', osm_key: 'amenity', osm_value: 'cafe', name, city: 'X' } })) });
const DAMASCUS = [36.2919, 33.5132], HOMS = [36.72, 34.73];
const FUZZY = /Kafat|Qefeilun|Kafaldin|Kefair|Kafr|الكفات|كفر/;

async function open(browser, dev, { lang, view, city }) {
  const ctx = await browser.newContext({ ...dev, serviceWorkers: 'block' });
  await ctx.addInitScript(`try { localStorage.setItem('kh.lang', ${JSON.stringify(lang)}); localStorage.setItem('kh.onboarded', '1');
    localStorage.setItem('kh.view', ${JSON.stringify(JSON.stringify(view))}); } catch {}
    try { const q = navigator.permissions.query.bind(navigator.permissions); navigator.permissions.query = d => d && d.name === 'geolocation' ? Promise.resolve({ state: 'denied', onchange: null }) : q(d); } catch {}
    navigator.geolocation.watchPosition = (s, e) => { setTimeout(() => e && e({ code: 1, message: 'denied' }), 10); return 1; }; navigator.geolocation.getCurrentPosition = (s, e) => setTimeout(() => e && e({ code: 1, message: 'denied' }), 10);`);
  const calls = { other: [] };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => {
    const u = r.request().url();
    if (city && /overpass/i.test(u)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(overpassFor(city)) });
    if (city && /photon/i.test(u)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(photonFor(city)) });
    if (/nominatim/i.test(u)) return r.fulfill({ contentType: 'application/json', body: '[]' });
    if (/supabase|openstreetmap\.org\/api/i.test(u)) calls.other.push(u);
    return r.abort();
  });
  const page = await ctx.newPage();
  await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#q') && document.querySelector('#btnMenu svg'), null, { timeout: 30000 });
  // the gazetteer must be loaded (that is what produced the Café≈Kafr villages)
  await page.evaluate(async () => { const m = await import(new URL('js/offline-search.js', location.href)); await m.loadGazetteer?.(); });
  return { ctx, page, calls };
}
const cam = page => page.evaluate(async () => { const m = await import(new URL('js/core.js', location.href)); const c = m.App.map.getCenter(); return { c: [c.lng, c.lat], z: m.App.map.getZoom() }; });
const settle = page => page.waitForFunction(async () => { const m = await import(new URL('js/core.js', location.href)); return !m.App.map.isMoving(); }, null, { timeout: 10000 }).then(() => page.waitForTimeout(400));
const zeroRe = /\b0\s+(within|im Umkreis)|٠\s+ضمن|0\s+ضمن/;

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  for (const eng of (process.env.ENGINES || 'webkit,chromium').split(',')) {
    const browser = await pw[eng].launch();
    const dev = { ...pw.devices['iPhone 13'], viewport: { width: 390, height: 664 } }; if (eng !== 'webkit') delete dev.defaultBrowserType;
    for (const lang of ['de', 'ar']) {
      for (const [name, city] of Object.entries(CITIES)) {
        const tag = `${eng}-${lang}-${name}`;
        const { ctx, page, calls } = await open(browser, dev, { lang, view: { c: city.c, z: 14 }, city });
        await settle(page);
        await page.tap('#q'); await page.fill('#q', 'Café');
        await page.waitForSelector('#sugg .srow, .sugg .srow, [role="listbox"] .srow', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(700);
        const sugg = await page.evaluate(() => [...document.querySelectorAll('.srow')].map(e => e.textContent).join(' | '));
        ok(`${tag}: suggestions have no "0 within 10 km" line`, !zeroRe.test(sugg), sugg.slice(0, 200));
        ok(`${tag}: suggestions have no far Café≈Kafr villages`, !FUZZY.test(sugg), sugg.slice(0, 200));
        await page.press('#q', 'Enter');
        await page.waitForSelector('#sheet .srow', { timeout: 15000 }); await page.waitForTimeout(900); await settle(page);
        const a = await cam(page);
        ok(`${tag}: camera stays in the country`, city.inCountry(a.c) && km(a.c, city.c) < 20, JSON.stringify(a));
        ok(`${tag}: camera z>=12 (no continent zoom)`, a.z >= 12 - 1e-6, a.z.toFixed(2));
        const sheet = await page.$eval('#sheet', e => e.textContent);
        ok(`${tag}: local cafés listed`, city.cafes.some(([, , n]) => sheet.includes(n)), sheet.slice(0, 200));
        ok(`${tag}: no Syrian fuzzy villages in the results`, !FUZZY.test(sheet));
        ok(`${tag}: no "0 within 10 km" line`, !zeroRe.test(sheet));
        ok(`${tag}: no real Supabase/OSM API calls`, !calls.other.length, calls.other.join(' '));
        await shot(page, `${tag}-cafe-after-enter.png`);
        await ctx.close();
      }
      // Syrian city name from a Syria view: gazetteer still answers (offline: Photon/Nominatim empty)
      {
        const tag = `${eng}-${lang}-syria`;
        const { ctx, page } = await open(browser, dev, { lang, view: { c: DAMASCUS, z: 12 }, city: null });
        await settle(page);
        await page.tap('#q'); await page.fill('#q', lang === 'ar' ? 'حمص' : 'Homs'); await page.waitForTimeout(700);
        await page.press('#q', 'Enter');
        await page.waitForFunction(() => /\S/.test(document.querySelector('#sheet')?.textContent || ''), null, { timeout: 15000 });
        await page.waitForTimeout(1200); await settle(page);
        const a = await cam(page), sheet = await page.$eval('#sheet', e => e.textContent);
        ok(`${tag}: Homs found from a Syria view`, /Homs|حمص/.test(sheet));
        ok(`${tag}: camera goes to Homs`, km(a.c, HOMS) < 25, JSON.stringify(a));
        await shot(page, `${tag}-homs.png`);
        await ctx.close();
      }
    }
    await browser.close();
  }
  srv.close();
  const fail = results.filter(x => !x).length;
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
