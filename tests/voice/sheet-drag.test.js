// Khareeta – bottom-sheet drag on phones (QA #19): a 375 px upward drag on the sheet handle must move the sheet like
// on main (top ≈591 → ≈200), not get a pointercancel from touch-action and snap back.
// Chromium: real touch input via CDP (touch-action is honoured → catches pointercancel regressions).
// WebKit (iPhone 13 profile, hasTouch): pointer drag (touch pointerType) + mouse drag.
// Also asserts the computed touch-action of the sheet / handle / chips / search field.
const { webkit, chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const PORT = +(process.env.SHEET_PORT || 8783), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
const top = p => p.evaluate(() => Math.round(document.querySelector('#sheet').getBoundingClientRect().top));
const grabXY = p => p.evaluate(() => { const r = document.querySelector('#sheet .grab').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
const DY = 375, STEPS = 25;

async function open(browser, name, opts) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: name !== 'webkit-mouse' || true, serviceWorkers: 'block', ...opts });
  await ctx.addInitScript(`try { if (!sessionStorage.__i) { sessionStorage.__i = 1; localStorage.setItem('kh.lang', 'en'); localStorage.setItem('kh.onboarded', '1'); } } catch {}`);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const page = await ctx.newPage();
  await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.KH?.App?.map && document.querySelector('#sheet')?.dataset.state === 'peek', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return { ctx, page };
}
async function check(page, tag, t0) {
  await page.waitForTimeout(900); const t1 = await top(page);
  // main reaches 'full' (Chromium) / 'half'≈304 (WebKit, slower synthetic event timing); a pointercancel leaves it at peek/stuck
  const full = tag.startsWith('chromium');
  ok(`${tag}: ${DY}px drag moves the sheet up to ${full ? 'full' : 'half/full'} like main, not stuck/snapped`, full ? t1 < 120 : t1 <= t0 - 150, `${t0} → ${t1}`);
}
(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  // ---- Chromium, real touch (CDP) ----
  {
    const b = await chromium.launch(); const { ctx, page } = await open(b, 'chromium');
    const ta = await page.evaluate(() => { const g = s => getComputedStyle(document.querySelector(s)).touchAction; return { sheet: g('#sheet'), grab: g('#sheet .grab'), chips: g('#chips'), q: g('#q') }; });
    ok('chromium: touch-action sheet none, chips/q pan-x pan-y', ta.sheet === 'none' && /pan-x pan-y/.test(ta.chips) && /pan-x pan-y/.test(ta.q), JSON.stringify(ta));
    const cdp = await ctx.newCDPSession(page); const { x, y } = await grabXY(page); const t0 = await top(page);
    let cancels = 0; await page.exposeFunction('__pc', () => cancels++); await page.evaluate(() => addEventListener('pointercancel', () => window.__pc(), true));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= STEPS; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (DY * i) / STEPS }] }); await page.waitForTimeout(16); }
    await page.waitForTimeout(150); // stop before lifting → no fling, the position decides the detent
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await check(page, 'chromium touch', t0);
    ok('chromium touch: no pointercancel during the drag', cancels === 0, 'pointercancel ×' + cancels);
    await ctx.close(); await b.close();
  }
  // ---- WebKit, touch pointer + mouse ----
  {
    const b = await webkit.launch();
    for (const kind of ['touch', 'mouse']) {
      const { ctx, page } = await open(b, 'webkit');
      const ta = await page.evaluate(() => getComputedStyle(document.querySelector('#sheet')).touchAction);
      if (kind === 'touch') ok('webkit: sheet touch-action none', ta === 'none', ta);
      const { x, y } = await grabXY(page); const t0 = await top(page);
      if (kind === 'mouse') {
        await page.mouse.move(x, y); await page.mouse.down();
        for (let i = 1; i <= STEPS; i++) { await page.mouse.move(x, y - (DY * i) / STEPS); await page.waitForTimeout(16); }
        await page.waitForTimeout(150); await page.mouse.up();
      } else {
        await page.evaluate(async ({ x, y, DY, STEPS }) => {
          const el = document.elementFromPoint(x, y), o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x };
          el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientY: y }));
          for (let i = 1; i <= STEPS; i++) { el.dispatchEvent(new PointerEvent('pointermove', { ...o, clientY: y - (DY * i) / STEPS })); await new Promise(r => setTimeout(r, 16)); }
          await new Promise(r => setTimeout(r, 150)); el.dispatchEvent(new PointerEvent('pointerup', { ...o, clientY: y - DY }));
        }, { x, y, DY, STEPS });
      }
      await check(page, `webkit ${kind}`, t0);
      await ctx.close();
    }
    await b.close();
  }
  srv.close();
  const fail = results.filter(x => !x).length;
  console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
