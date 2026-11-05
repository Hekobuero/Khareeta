// Khareeta – iPhone (WebKit, 390 px) PR #36 QA: "Report…" menu fully visible after the tap in the half-open
// "What's here?" and place sheets (DE + AR); OSM note form 429 message + count line; Khareeta form. All non-local
// requests are mocked/aborted (no OSM / Nominatim / Supabase calls).  Run: node report-menu.test.js  (SHOTS=dir)
const { webkit, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out', 'report-menu'); fs.mkdirSync(OUT, { recursive: true });
const EXTRA = process.env.SHOTS || ''; if (EXTRA) fs.mkdirSync(EXTRA, { recursive: true });
const PORT = +(process.env.RM_PORT || 8784), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
async function shot(page, name) { const p = path.join(OUT, name); await page.screenshot({ path: p }); if (EXTRA) fs.copyFileSync(p, path.join(EXTRA, name)); }
const visible = page => page.evaluate(() => {
  const m = [...document.querySelectorAll('.rm-menu')].find(x => !x.hidden); if (!m) return { open: false };
  const r = m.getBoundingClientRect(), vh = window.visualViewport ? visualViewport.height : innerHeight;
  return { open: true, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: Math.round(vh), ok: r.top >= 0 && r.bottom <= vh + 1 };
});

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await webkit.launch();
  const dev = { ...devices['iPhone 13'], viewport: { width: 390, height: 664 } };
  for (const lang of ['de', 'ar']) {
    const ctx = await browser.newContext({ ...dev, serviceWorkers: 'block' });
    await ctx.addInitScript(`try { if (!sessionStorage.__i) { sessionStorage.__i = 1; localStorage.setItem('kh.lang', ${JSON.stringify(lang)}); localStorage.setItem('kh.onboarded', '1'); } } catch {}`);
    let noteCalls = 0, other = [];
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => {
      const u = r.request().url();
      if (u.includes('/api/0.6/notes')) { noteCalls++; return r.fulfill({ status: 429, contentType: 'text/plain', body: 'rate limited' }); }
      other.push(u); return r.abort();
    });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => { if (!/access control checks|Load failed|cancelled/i.test(e.message)) errs.push(e.message); });
    await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#btnMenu svg'), null, { timeout: 30000 });
    await page.waitForTimeout(800);
    // Wait for map.load → showHome(), otherwise late startup can replace the sheet under test.
    await page.waitForFunction(() => window.KH?.App?.sheetKind === 'home', null, { timeout: 30000 });
    // 1) What's here? (half sheet)
    // Same WebKit pattern as wh-menu.test.js (#40): re-query locator, catch the first scrollIntoViewIfNeeded
    // (button often sits below the half-sheet fold / overflow:hidden → Playwright times out before the
    // expand-to-full guard), then pull the sheet up like a user and wait until visible.
    await page.evaluate(async () => { const m = await import(new URL('js/whats-here.js', location.href)); m.openWhatsHere([36.2765, 33.5138]); });
    const whBtn = page.locator('#whRmBtn');
    await whBtn.waitFor({ state: 'attached', timeout: 15000 }); await page.waitForTimeout(500);
    await whBtn.scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(200);
    // Share-as-image adds a 5th action-row button → wrap at 390 px, report entry can sit below the half-sheet fold
    if (await whBtn.evaluate(b => { const r = b.getBoundingClientRect(); return r.bottom > innerHeight || r.top < 0; })) {
      await page.evaluate(async () => { (await import(new URL('js/core.js', location.href))).setSheet('full'); }); await page.waitForTimeout(500);
      await whBtn.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    }
    await whBtn.waitFor({ state: 'visible', timeout: 10000 });
    await shot(page, `${lang}-wh-1-before.png`);
    await whBtn.tap(); await page.waitForTimeout(900);
    let v = await visible(page); ok(`${lang}: What's here – menu fully visible after tap`, v.open && v.ok, JSON.stringify(v));
    await shot(page, `${lang}-wh-2-menu.png`);
    const icon = await page.$eval('#whRmBtn svg path', p => p.getAttribute('d')); ok(`${lang}: report icon = solid flag`, icon.startsWith('M5,2H7V3.5'), icon);
    // 2) OSM note form → mocked 429
    await page.tap('#whRmMenu [data-rm="osm"]'); await page.waitForSelector('#ntText');
    await page.tap('.nt-chips .chip'); await page.fill('#ntText', lang === 'ar' ? 'الطريق مغلق هنا منذ أسبوع' : 'Straße hier seit einer Woche gesperrt');
    const count = await page.$eval('#ntCount', e => e.textContent); ok(`${lang}: count line`, /^\d+\/\d+$/.test(count) || /[٠-٩]/.test(count), count);
    await shot(page, `${lang}-note-form.png`);
    await page.tap('#ntSend'); await page.waitForSelector('#ntErr:not([hidden])', { timeout: 10000 });
    const err = await page.$eval('#ntErr', e => e.textContent);
    ok(`${lang}: 429 → rate-limit message`, lang === 'ar' ? /دقيقة/.test(err) : /Minute/.test(err), err);
    await page.$eval('#ntErr', e => e.scrollIntoView({ block: 'center' })); await shot(page, `${lang}-note-429.png`);
    // 3) Place sheet (POI) – half sheet, menu reveal, one edit link, POI subline
    await page.evaluate(async () => { (await import(new URL('js/core.js', location.href))).closeSheet(); });
    await page.waitForTimeout(400);
    await page.evaluate(async () => { const m = await import(new URL('js/place.js', location.href)); m.openPlace({ id: 'n1', osm_type: 'node', osm_id: 1, name: 'Café Test', lat: 33.5138, lon: 36.2765, cat: 'cafe', tags: { amenity: 'cafe', name: 'Café Test' } }); });
    const pBtn = page.locator('#pRmBtn');
    await pBtn.waitFor({ state: 'attached', timeout: 15000 }); await page.waitForTimeout(700);
    await page.evaluate(async () => { (await import(new URL('js/core.js', location.href))).setSheet('half'); }); await page.waitForTimeout(500);
    await pBtn.scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(200);
    // since P2 (#37) the closed menu no longer pads the half sheet, so "Report…" can sit below the fold → pull the sheet up like a user
    if (await pBtn.evaluate(b => b.getBoundingClientRect().bottom > innerHeight)) {
      await page.evaluate(async () => { (await import(new URL('js/core.js', location.href))).setSheet('full'); }); await page.waitForTimeout(500);
      await pBtn.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    }
    await pBtn.waitFor({ state: 'visible', timeout: 10000 });
    ok(`${lang}: POI – choice closed before tap`, await page.$eval('#pRmMenu', m => m.hidden && getComputedStyle(m).display === 'none'));
    await shot(page, `${lang}-poi-1-before.png`);
    const edits = await page.$$eval('.sheet a[href*="openstreetmap.org/edit"], #sheet a[href*="openstreetmap.org/edit"]', a => a.length);
    ok(`${lang}: POI – exactly one edit link`, edits <= 1 && (await page.$$('#pRm .rm-edit')).length === 0, String(edits));
    await page.tap('#pRmBtn'); await page.waitForTimeout(900);
    v = await visible(page); ok(`${lang}: POI – menu fully visible after tap`, v.open && v.ok, JSON.stringify(v));
    const sub = await page.$eval('#pRmMenu [data-rm="kh"] small', e => e.textContent);
    ok(`${lang}: POI subline`, lang === 'ar' ? /معلومات خاطئة/.test(sub) : /Falsche Angaben/.test(sub), sub);
    await shot(page, `${lang}-poi-2-menu.png`);
    // 4) Khareeta form (no send)
    await page.tap('#pRmMenu [data-rm="kh"]'); await page.waitForTimeout(800);
    await shot(page, `${lang}-kh-form.png`);
    ok(`${lang}: no page errors`, errs.length === 0, errs.join(' | '));
    ok(`${lang}: only the mocked notes call left the page`, noteCalls === 1, `notes=${noteCalls} aborted=${other.length}`);
    await ctx.close();
  }
  await browser.close(); srv.close();
  const fail = results.filter(x => !x).length; console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
