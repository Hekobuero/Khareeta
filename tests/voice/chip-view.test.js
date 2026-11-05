// Khareeta P0 – a category chip never jumps to the Syria / Middle East default view, and the app starts on the real
// GPS position when location is permitted (Syria fallback only when denied). iPhone 390 px, WebKit + Chromium, DE + AR.
// Everything outside 127.0.0.1 is mocked or aborted (Overpass answers from fixtures; no OSM / Nominatim / Photon / Supabase).
// Run: node chip-view.test.js  (SHOTS=dir copies the screenshots, ENGINES=webkit,chromium, SHOT_PREFIX=after)
const pw = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(process.env.KH_REPO || path.join(__dirname, '..', '..'));
const OUT = path.join(__dirname, 'out', 'chip-view'); fs.mkdirSync(OUT, { recursive: true });
const EXTRA = process.env.SHOTS || ''; if (EXTRA) fs.mkdirSync(EXTRA, { recursive: true });
const PFX = process.env.SHOT_PREFIX ? process.env.SHOT_PREFIX + '-' : '';
const PORT = +(process.env.CV_PORT || 8797), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
async function shot(page, name) { const p = path.join(OUT, PFX + name); await page.screenshot({ path: p }); if (EXTRA) fs.copyFileSync(p, path.join(EXTRA, PFX + name)); }
const BERLIN = { latitude: 52.52, longitude: 13.405 };
const DAMASCUS = [36.2919, 33.5132];
const CAFES = { elements: [
  { type: 'node', id: 101, lat: 52.5212, lon: 13.4098, tags: { amenity: 'cafe', name: 'Café Mitte', opening_hours: '08:00-20:00' } },
  { type: 'node', id: 102, lat: 52.5181, lon: 13.4003, tags: { amenity: 'cafe', name: 'Kaffeehaus Spree' } },
  { type: 'node', id: 103, lat: 52.5235, lon: 13.3990, tags: { amenity: 'cafe', name: 'Röstbar' } }] };
// Germany / Berlin area; anything east of 25° E or south of 40° N would be the Middle East / Syria default
const inGermany = c => c[0] > 5.5 && c[0] < 15.5 && c[1] > 47 && c[1] < 55.5;
const km = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b[1] - a[1]) * r, dn = (b[0] - a[0]) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

async function open(browser, dev, { lang, geo, view, overpass, perm }) {
  const ctx = await browser.newContext({ ...dev, serviceWorkers: 'block', ...(geo ? { geolocation: geo, permissions: ['geolocation'] } : {}) });
  await ctx.addInitScript(`try { localStorage.setItem('kh.lang', ${JSON.stringify(lang)}); localStorage.setItem('kh.onboarded', '1');
    ${view ? `localStorage.setItem('kh.view', ${JSON.stringify(JSON.stringify(view))});` : ''} } catch {}
    ${perm ? `try { const q = navigator.permissions.query.bind(navigator.permissions); navigator.permissions.query = d => d && d.name === 'geolocation' ? Promise.resolve({ state: ${JSON.stringify(perm)}, onchange: null }) : q(d); } catch {}
      ${perm === 'denied' ? `navigator.geolocation.watchPosition = (s, e) => { setTimeout(() => e && e({ code: 1, message: 'denied' }), 10); return 1; }; navigator.geolocation.getCurrentPosition = (s, e) => setTimeout(() => e && e({ code: 1, message: 'denied' }), 10);` : ''}` : ''}`);
  const calls = { overpass: 0, other: [] };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => {
    const u = r.request().url();
    if (/overpass/i.test(u)) { calls.overpass++; return r.fulfill({ contentType: 'application/json', body: JSON.stringify(overpass || { elements: [] }) }); }
    if (/nominatim|photon|supabase|openstreetmap\.org\/api/i.test(u)) calls.other.push(u);
    return r.abort();
  });
  const page = await ctx.newPage();
  await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.chip[data-cat="cafes"]') && document.querySelector('#btnMenu svg'), null, { timeout: 30000 });
  return { ctx, page, calls };
}
const cam = page => page.evaluate(async () => { const m = await import(new URL('js/core.js', location.href)); const c = m.App.map.getCenter(); return { c: [c.lng, c.lat], z: m.App.map.getZoom() }; });
const settle = page => page.waitForFunction(async () => { const m = await import(new URL('js/core.js', location.href)); return !m.App.map.isMoving(); }, null, { timeout: 10000 }).then(() => page.waitForTimeout(400));

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const engines = (process.env.ENGINES || 'webkit,chromium').split(',');
  for (const eng of engines) {
    const browser = await pw[eng].launch();
    const dev = { ...pw.devices['iPhone 13'], viewport: { width: 390, height: 664 } }; if (eng !== 'webkit') { delete dev.defaultBrowserType; }
    for (const lang of ['de', 'ar']) {
      const tag = `${eng}-${lang}`;
      // 1) map looking at Berlin (saved view, no GPS), tap Cafés → results near the view, camera stays in Germany
      for (const kind of ['results', 'empty']) {
        const { ctx, page, calls } = await open(browser, dev, { lang, view: { c: [13.405, 52.52], z: 14 }, overpass: kind === 'results' ? CAFES : { elements: [] }, perm: 'denied' });
        await settle(page);
        const before = await cam(page);
        ok(`${tag}: start on saved Berlin view (${kind})`, inGermany(before.c), JSON.stringify(before));
        if (kind === 'results' && lang === 'de') await shot(page, `${eng}-de-germany-view.png`);
        await page.tap('.chip[data-cat="cafes"]');
        if (kind === 'results') await page.waitForSelector('#sheet .srow', { timeout: 15000 });
        else await page.waitForFunction(() => /\S/.test(document.querySelector('#sheet')?.textContent || '') && !document.querySelector('#sheet .skel'), null, { timeout: 15000 });
        await page.waitForTimeout(800); await settle(page);
        const after = await cam(page);
        ok(`${tag}: Cafés (${kind}) keeps the camera in Germany`, inGermany(after.c) && km(after.c, before.c) < 20, JSON.stringify(after));
        ok(`${tag}: Cafés (${kind}) not at the Damascus/Syria default`, km(after.c, DAMASCUS) > 1000 && after.c[0] < 25);
        ok(`${tag}: Cafés (${kind}) never below z12`, after.z >= 12 - 1e-6, after.z.toFixed(2));
        if (kind === 'results') ok(`${tag}: mocked Berlin cafés listed`, (await page.$$eval('#sheet .srow', a => a.length)) >= 3);
        else {
          ok(`${tag}: empty → radii 2.5/5/10 km tried (3 Overpass calls)`, calls.overpass === 3, String(calls.overpass));
          ok(`${tag}: empty-state message shown`, await page.evaluate(() => !document.querySelector('#sheet .srow') && /\S/.test(document.querySelector('#sheet .psub')?.textContent || '')));
        }
        ok(`${tag}: no real Nominatim/Photon/Supabase calls (${kind})`, !calls.other.length, calls.other.join(' '));
        await shot(page, `${tag}-germany-cafes-${kind}.png`);
        await ctx.close();
      }
      // 2) start with GPS granted (Berlin), saved view in Syria → start centres on the GPS position, chip stays there
      {
        const { ctx, page } = await open(browser, dev, { lang, geo: BERLIN, perm: 'granted', view: { c: DAMASCUS, z: 12.5 }, overpass: CAFES });
        await page.waitForTimeout(1500); await settle(page);
        const s = await cam(page);
        ok(`${tag}: GPS granted → start centred on the position (Berlin)`, km(s.c, [BERLIN.longitude, BERLIN.latitude]) < 2, JSON.stringify(s));
        await shot(page, `${tag}-start-gps.png`);
        await page.tap('.chip[data-cat="cafes"]'); await page.waitForSelector('#sheet .srow', { timeout: 15000 }); await page.waitForTimeout(800); await settle(page);
        const a = await cam(page);
        ok(`${tag}: GPS start + Cafés stays in Germany`, inGermany(a.c), JSON.stringify(a));
        await ctx.close();
      }
      // 3) no saved view, location denied → the Syria fallback is allowed
      {
        const { ctx, page } = await open(browser, dev, { lang, perm: 'denied' });
        await page.waitForTimeout(1500); await settle(page);
        const s = await cam(page);
        ok(`${tag}: location denied → Syria/Damascus fallback`, km(s.c, DAMASCUS) < 30, JSON.stringify(s));
        await shot(page, `${tag}-start-denied.png`);
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
