// Khareeta P0 (Hidro, Bad Godesberg, live 20261106-1756): category chip with every Overpass mirror down must not stay
// on skeleton bars. Bonn view, 390 px, DE/EN/AR. Overpass hangs (never answers) → mocked Nominatim list; Overpass +
// Nominatim down → honesty copy + "Try again"; camera stays in Bonn (fit=false, ≥ z12). Nothing real is called:
// every request outside 127.0.0.1 is mocked or aborted.
// Run: node live-fallback.test.js  (SHOTS=dir copies screenshots, ENGINES=webkit,chromium)
const pw = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(process.env.KH_REPO || path.join(__dirname, '..', '..'));
const OUT = path.join(__dirname, 'out', 'live-fallback'); fs.mkdirSync(OUT, { recursive: true });
const EXTRA = process.env.SHOTS || ''; if (EXTRA) fs.mkdirSync(EXTRA, { recursive: true });
const PORT = +(process.env.LF_PORT || 8798), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
async function shot(page, name) { const p = path.join(OUT, name); await page.screenshot({ path: p }); if (EXTRA) fs.copyFileSync(p, path.join(EXTRA, name)); }
const BONN = [7.155, 50.687]; // Schweinheim / Bad Godesberg
const NOM = [ // Nominatim jsonv2 shape (fixture, not real data from a call)
  { osm_type: 'node', osm_id: 201, lat: '50.6862', lon: '7.1531', category: 'amenity', type: 'restaurant', namedetails: { name: 'Palmyra' }, extratags: {} },
  { osm_type: 'node', osm_id: 202, lat: '50.6801', lon: '7.1602', category: 'amenity', type: 'restaurant', namedetails: { name: 'Steinerberghaus' }, extratags: { opening_hours: 'Mo-Su 11:00-22:00' } },
  { osm_type: 'way', osm_id: 203, lat: '50.6895', lon: '7.1488', category: 'amenity', type: 'restaurant', namedetails: { name: 'Sebastianushof' }, extratags: {} }];
const km = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b[1] - a[1]) * r, dn = (b[0] - a[0]) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

async function open(browser, dev, { lang, nominatim }) {
  const ctx = await browser.newContext({ ...dev, serviceWorkers: 'block' });
  await ctx.addInitScript(`try { localStorage.setItem('kh.lang', ${JSON.stringify(lang)}); localStorage.setItem('kh.onboarded', '1'); localStorage.setItem('kh.view', ${JSON.stringify(JSON.stringify({ c: BONN, z: 14 }))}); } catch {}
    try { const q = navigator.permissions.query.bind(navigator.permissions); navigator.permissions.query = d => d && d.name === 'geolocation' ? Promise.resolve({ state: 'denied', onchange: null }) : q(d); } catch {}
    navigator.geolocation.watchPosition = (s, e) => { setTimeout(() => e && e({ code: 1, message: 'denied' }), 10); return 1; }; navigator.geolocation.getCurrentPosition = (s, e) => setTimeout(() => e && e({ code: 1, message: 'denied' }), 10);`);
  const calls = { overpass: 0, nominatim: 0, other: [] };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => {
    const u = r.request().url();
    if (/overpass|interpreter/i.test(u)) { calls.overpass++; return; } // hangs: never fulfilled (mirror timeout)
    if (/nominatim/i.test(u)) { calls.nominatim++; return nominatim ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(nominatim) }) : r.fulfill({ status: 504, body: '' }); }
    if (/photon|supabase/i.test(u)) calls.other.push(u);
    return r.abort();
  });
  const page = await ctx.newPage();
  await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.chip[data-cat="restaurants"]') && document.querySelector('#btnMenu svg'), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return { ctx, page, calls };
}
const cam = page => page.evaluate(async () => { const m = await import(new URL('js/core.js', location.href)); const c = m.App.map.getCenter(); return { c: [c.lng, c.lat], z: m.App.map.getZoom() }; });

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  for (const eng of (process.env.ENGINES || 'webkit,chromium').split(',')) {
    const browser = await pw[eng].launch();
    const dev = { ...pw.devices['iPhone 13'], viewport: { width: 390, height: 844 } }; if (eng !== 'webkit') delete dev.defaultBrowserType;
    for (const lang of ['de', 'en', 'ar']) {
      const tag = `${eng}-${lang}`;
      { // Overpass hangs, Nominatim answers → list well before the Overpass timeout
        const { ctx, page, calls } = await open(browser, dev, { lang, nominatim: NOM });
        const t0 = Date.now(); await page.tap('.chip[data-cat="restaurants"]');
        await page.waitForSelector("#sheet .srow", { timeout: 10000 }).catch(() => {});
        const dt = Date.now() - t0, names = await page.$$eval('#sheet .srow', a => a.map(x => x.textContent));
        ok(`${tag}: Overpass hangs → Nominatim restaurants listed in < 8 s (old path: ≥ 11.5 s Overpass timeouts first)`, names.some(n => /Palmyra/.test(n)) && dt < 8000, `${dt} ms, ${names.length}`);
        ok(`${tag}: no skeleton left`, !(await page.$('#sheet .skel')));
        const c = await cam(page); ok(`${tag}: camera stays in Bonn, ≥ z12`, km(c.c, BONN) < 5 && c.z >= 12 - 1e-6, JSON.stringify(c));
        ok(`${tag}: no Photon/Supabase calls`, !calls.other.length, calls.other.join(' '));
        await shot(page, `${tag}-overpass-down-nominatim.png`); await ctx.close();
      }
      { // Overpass hangs + Nominatim 504 → honesty + Try again before the deadline passes by much
        const { ctx, page } = await open(browser, dev, { lang, nominatim: null });
        await page.tap('.chip[data-cat="restaurants"]');
        const got = await page.waitForSelector('#retryCat', { timeout: 16000 }).then(() => true, () => false);
        ok(`${tag}: all live down → honesty copy + retry button`, got && !(await page.$('#sheet .skel')), await page.evaluate(() => document.querySelector('#sheet')?.innerText.slice(0, 120)));
        const c = await cam(page); ok(`${tag}: (down) camera stays in Bonn`, km(c.c, BONN) < 5 && c.z >= 12 - 1e-6, JSON.stringify(c));
        await shot(page, `${tag}-all-down-retry.png`); await ctx.close();
      }
    }
    await browser.close();
  }
  srv.close();
  const f = results.filter(x => !x).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
