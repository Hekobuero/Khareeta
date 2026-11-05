// Khareeta – iPhone (WebKit, 390 px): saved places (save button, list, edit, persistence after reload) and offline
// search with typos (context.setOffline) + offline notice, DE + AR × light/dark. All non-local requests are aborted
// (no OSM / Nominatim / Photon / Overpass / Supabase calls).  Run: node saved-offline.test.js  (SHOTS=dir)
const { webkit, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out', 'saved-offline'); fs.mkdirSync(OUT, { recursive: true });
const EXTRA = process.env.SHOTS || ''; if (EXTRA) fs.mkdirSync(EXTRA, { recursive: true });
const PORT = +(process.env.SO_PORT || 8786), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
async function shot(page, name) { const p = path.join(OUT, name); await page.screenshot({ path: p }); if (EXTRA) fs.copyFileSync(p, path.join(EXTRA, name)); }
const imp = (page, mod, fn) => page.evaluate(async ([m, f]) => { const x = await import(new URL('js/' + m, location.href)); return (0, eval)(f)(x); }, [mod, fn]);
const POI = { id: 'n9001', osm_type: 'node', osm_id: 9001, name: 'مقهى الروضة', sub: 'Damascus', lon: 36.2913, lat: 33.5156, tags: { amenity: 'cafe', name: 'مقهى الروضة', 'name:en': 'Al-Rawda Café' }, full: true };

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await webkit.launch();
  const dev = { ...devices['iPhone 13'], viewport: { width: 390, height: 664 } };
  for (const lang of ['de', 'ar']) for (const scheme of ['light', 'dark']) {
    const tag = `${lang}-${scheme}`;
    const ctx = await browser.newContext({ ...dev, colorScheme: scheme, serviceWorkers: 'block' });
    await ctx.addInitScript(`try { if (!localStorage.getItem('kh.onboarded')) { localStorage.setItem('kh.lang', ${JSON.stringify(lang)}); localStorage.setItem('kh.onboarded', '1'); } } catch {}`);
    const ext = []; await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { ext.push(r.request().url()); return r.abort(); });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => { if (!/access control checks|Load failed|cancelled|NetworkError|Failed to fetch/i.test(e.message)) errs.push(e.message); });
    await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#btnMenu svg'), null, { timeout: 30000 }); await page.waitForTimeout(800);
    // 1) save button in the place sheet
    await imp(page, 'place.js', `m => m.openPlace(${JSON.stringify(POI)}, { noFly: true })`);
    await page.waitForSelector('#pSave'); await page.waitForTimeout(400);
    await page.tap('#pSave'); await page.waitForTimeout(400);
    ok(`${tag}: place saved`, await imp(page, 'saved.js', `m => m.isSaved('n9001')`));
    await shot(page, `${tag}-1-save-button.png`);
    // What's here? save (coordinate place)
    await imp(page, 'whats-here.js', `m => m.openWhatsHere([36.2765, 33.5138])`);
    await page.waitForSelector('#whSave'); await page.tap('#whSave'); await page.waitForTimeout(300);
    ok(`${tag}: what's-here point saved`, (await page.getAttribute('#whSave', 'aria-pressed')) === 'true');
    // 2) persistence after reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#btnMenu svg'), null, { timeout: 30000 }); await page.waitForTimeout(800);
    const n = await imp(page, 'saved.js', `m => m.savedList().length`); ok(`${tag}: 2 saved places survive reload`, n === 2, String(n));
    await imp(page, 'saved.js', `m => m.showSaved()`); await page.waitForSelector('#svList .svrow'); await page.waitForTimeout(400);
    await shot(page, `${tag}-2-saved-list.png`);
    // 3) edit: rename + mark as home
    await page.tap('#svList [data-edit="1"]'); await page.waitForSelector('#seName'); await page.waitForTimeout(300);
    await page.fill('#seName', lang === 'ar' ? 'مقهى الصباح' : 'Morgenkaffee');
    await page.tap('#seKind [data-k="home"]'); await page.waitForTimeout(200);
    await shot(page, `${tag}-3-edit.png`);
    await page.tap('#seSave'); await page.waitForTimeout(400);
    const lst = await imp(page, 'saved.js', `m => m.savedList()`);
    const h = lst.find(s => s.kind === 'home'); ok(`${tag}: renamed + home`, h && /Morgenkaffee|الصباح/.test(h.label), JSON.stringify(h && h.label));
    // 4) offline search with a typo
    await imp(page, 'core.js', `m => m.closeSheet()`); await page.waitForTimeout(300);
    ok(`${tag}: OSM attribution visible`, await page.evaluate(() => { const e = document.querySelector('.kattr-osm'); return !!e && e.getBoundingClientRect().width > 0 && /OpenStreetMap/.test(e.textContent); }));
    await imp(page, 'offline-search.js', `m => m.loadGazetteer()`); // precached by the SW in production; SW is blocked here
    await ctx.setOffline(true); await page.evaluate(() => dispatchEvent(new Event('offline')));
    const q = lang === 'ar' ? 'حمصه' : 'Damaskus', want = lang === 'ar' ? 'حمص' : 'Damaskus|Damascus|دمشق';
    await page.tap('#q'); await page.fill('#q', q);
    await page.waitForSelector('#suggest #offNotice', { timeout: 10000 });
    await page.waitForTimeout(300);
    const first = await page.$$eval('#suggest .srow .t1', a => a.slice(0, 3).map(x => x.textContent).join(' | '));
    ok(`${tag}: offline typo "${q}" finds the city`, new RegExp('^(' + want + ')$').test(first.split(' | ')[0]), first);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await shot(page, `${tag}-4-offline-search.png`);
    // full search (Enter) → result list with offline notice and stars
    await page.tap('#q'); await page.press('#q', 'Enter'); await page.waitForTimeout(800);
    const notice = await page.$eval('#offNotice', e => e.textContent).catch(() => '');
    ok(`${tag}: offline notice shown`, lang === 'ar' ? /غير متصل/.test(notice) : /Offline/.test(notice), notice);
    await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.waitForTimeout(300);
    await shot(page, `${tag}-5-offline-notice.png`);
    const star = await page.$('.sheet [data-star], [data-star]');
    if (star) { await star.tap(); await page.waitForTimeout(200); ok(`${tag}: star in result list saves`, (await imp(page, 'saved.js', `m => m.savedList().length`)) === 3); }
    else ok(`${tag}: star in result list present`, false);
    ok(`${tag}: no page errors`, !errs.length, errs.join(' / '));
    console.log(`  (${ext.length} external requests aborted)`);
    await ctx.close();
  }
  await browser.close(); srv.close();
  const f = results.filter(x => !x).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
