// Khareeta – P2: the "Report…" choice in the "What's here?" sheet must stay closed until "Report…" is tapped, and must be
// closed again every time the sheet opens. WebKit (iPhone) + Chromium, DE + AR, light mode, sheet opened 3× in a row.
// All non-local requests are aborted (no OSM / Nominatim / Overpass / Supabase calls).  Run: node wh-menu.test.js  (SHOTS=dir)
const { webkit, chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = process.env.KH_REPO || path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out', 'wh-menu'); fs.mkdirSync(OUT, { recursive: true });
const EXTRA = process.env.SHOTS || ''; if (EXTRA) fs.mkdirSync(EXTRA, { recursive: true });
const TAG = process.env.TAG || '';
const PORT = +(process.env.WH_PORT || 8786), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
async function shot(page, name) { const p = path.join(OUT, name); await page.screenshot({ path: p }); if (EXTRA) fs.copyFileSync(p, path.join(EXTRA, name)); }
const state = page => page.evaluate(() => {
  const m = document.querySelector('#whRmMenu'), b = document.querySelector('#whRmBtn'); if (!m) return { found: false };
  const r = m.getBoundingClientRect();
  return { found: true, hidden: m.hidden, display: getComputedStyle(m).display, h: Math.round(r.height), exp: b?.getAttribute('aria-expanded') };
});
const closed = s => s.found && s.hidden && s.display === 'none' && s.h === 0 && s.exp === 'false';
(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  for (const [bn, bt] of [['webkit', webkit], ['chromium', chromium]]) {
    const browser = await bt.launch();
    for (const lang of ['de', 'ar']) {
      const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, serviceWorkers: 'block', colorScheme: 'light' });
      await ctx.addInitScript(`try { if (!sessionStorage.__i) { sessionStorage.__i = 1; localStorage.setItem('kh.lang', ${JSON.stringify(lang)}); localStorage.setItem('kh.onboarded', '1'); } } catch {}`);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
      const page = await ctx.newPage();
      await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#btnMenu svg'), null, { timeout: 30000 }); await page.waitForTimeout(800);
      const pts = [[36.2765, 33.5138], [36.2921, 33.5102], [36.3001, 33.5201]];
      for (let i = 0; i < pts.length; i++) {
        await page.evaluate(async p => { const m = await import(new URL('js/whats-here.js', location.href)); m.openWhatsHere(p); }, pts[i]);
        await page.waitForSelector('#whRmBtn'); await page.waitForTimeout(500);
        console.log('DBG', JSON.stringify(await page.evaluate(async () => ({ kind: (await import(new URL('js/core.js', location.href))).App?.sheetKind, st: document.querySelector('#sheet')?.dataset.state, has: !!document.querySelector('#whRmBtn'), body: (document.querySelector('#sheetBody')?.innerText || '').slice(0, 300) }))));
        await page.evaluate(() => document.querySelector('#whRmBtn').scrollIntoView({ block: 'nearest' })); await page.waitForTimeout(200);
        // "Report…" below the fold of the half sheet (it is no longer padded by the menu) → pull the sheet up like a user
        if (await page.evaluate(() => document.querySelector('#whRmBtn').getBoundingClientRect().bottom > innerHeight)) {
          await page.evaluate(async () => (await import(new URL('js/core.js', location.href))).setSheet('full')); await page.waitForTimeout(500);
          await page.evaluate(() => document.querySelector('#whRmBtn').scrollIntoView({ block: 'nearest' })); await page.waitForTimeout(200);
        }
        const s0 = await state(page); ok(`${bn} ${lang} open #${i + 1}: choice closed before tap`, closed(s0), JSON.stringify(s0));
        if (i === 0 && bn === 'webkit') await shot(page, `${TAG}${lang}-wh-menu-before-tap.png`);
        if (process.env.ONLY_SHOT) continue;
        await page.tap('#whRmBtn'); await page.waitForTimeout(700);
        const s1 = await state(page); ok(`${bn} ${lang} open #${i + 1}: choice shown after tap`, s1.found && !s1.hidden && s1.display !== 'none' && s1.h > 40 && s1.exp === 'true', JSON.stringify(s1));
        if (i === 0 && bn === 'webkit') await shot(page, `${TAG}${lang}-wh-menu-after-tap.png`);
        await page.evaluate(async () => { (await import(new URL('js/core.js', location.href))).closeSheet(); }); await page.waitForTimeout(400);
      }
      await ctx.close();
    }
    await browser.close();
  }
  srv.close();
  const fail = results.filter(x => !x).length; console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
