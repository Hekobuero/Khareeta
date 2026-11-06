// Khareeta – route sheet action chips must all fit on iPhone 390×844.
// After #50 AR «الخطوات» wraps to a second row; default peek must clear that row (Nour P3).
// Opens a route sheet with the same ochips markup + peek sizing as showRouteSheet (DE/EN/AR).
// Asserts every #rShare/#rShareImg/#rPrint/#rSteps chip is visible, enabled, ≥44 px, and fully
// inside the viewport at the DEFAULT peek (not pre-forced to full). DE/EN stay one row.
// All non-local requests aborted (no OSM/Nominatim/Overpass/Photon/Supabase/Open-Meteo).
// Run: node route-chips.test.js
const { webkit, chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = process.env.KH_REPO || path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out', 'route-chips'); fs.mkdirSync(OUT, { recursive: true });
const EXTRA = process.env.SHOTS || ''; if (EXTRA) fs.mkdirSync(EXTRA, { recursive: true });
const PORT = +(process.env.RC_PORT || 8796), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
const CHIP_IDS = ['rShare', 'rShareImg', 'rPrint', 'rSteps'];

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browsers = (process.env.BROWSERS || 'chromium,webkit').split(',').map(s => s.trim()).filter(Boolean);
  for (const bn of browsers) {
    const launcher = { webkit, chromium }[bn];
    if (!launcher) continue;
    let browser;
    try { browser = await launcher.launch(); }
    catch (e) { console.log(`SKIP ${bn}: ${e.message}`); continue; }
    for (const lang of ['de', 'en', 'ar']) {
      const pre = `${bn} ${lang}`;
      const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: lang === 'ar' ? 'ar-SY' : lang === 'de' ? 'de-DE' : 'en-US' });
      await ctx.addInitScript(`try { localStorage.setItem('kh.lang', ${JSON.stringify(lang)}); localStorage.setItem('kh.onboarded', '1'); } catch {}`);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
      const page = await ctx.newPage();
      await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#btnMenu svg'), null, { timeout: 30000 });
      await page.waitForTimeout(500);
      await page.waitForFunction(() => window.KH?.App?.sheetKind === 'home', null, { timeout: 30000 });
      const dir = await page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction);
      ok(`${pre}: direction ${dir}`, lang === 'ar' ? dir === 'rtl' : dir !== 'rtl');

      // Mirror showRouteSheet: open at peek, then size peek to chips bottom (production path).
      const sheetMeta = await page.evaluate(async (lang) => {
        const { t, setLang } = await import(new URL('js/i18n.js', location.href));
        const { ic } = await import(new URL('js/icons.js', location.href));
        const { openSheet, setSheet, App } = await import(new URL('js/core.js', location.href));
        setLang(lang);
        const html = `<div class="cl-warn" role="status"><span>2 closures nearby</span></div>
          <div class="rcard on" role="button"><div style="flex:1;min-width:0"><div class="rt">12 min</div><div class="rd">4.2 km · via <bdi>Example St</bdi> · ETA 12:00</div><div class="fast">Fastest</div></div><button class="gobtn">${t('go')}</button></div>
          <div class="rcard" role="button"><div style="flex:1;min-width:0"><div class="rt">14 min</div><div class="rd">3.8 km · via <bdi>Other Rd</bdi> · ETA 12:02</div></div><button class="gobtn">${t('go')}</button></div>
          <div class="ochips rchips">
            <button class="ochip" id="rShare">${ic('share', 'xs')}${t('share_route')}</button>
            <button class="ochip" id="rShareImg">${ic('image', 'xs')}${t('shareImageShort')}</button>
            <button class="ochip" id="rPrint">${ic('download', 'xs')}${t('mapExportPrintShort')}</button>
            <button class="ochip" id="rSteps">${ic('directions', 'xs')}${t('steps')}</button>
          </div>
          <h3 class="sect-title" id="stepsTitle">${t('steps')}</h3>
          <div class="steps list"><div class="srow"><div class="st"><div class="t1" dir="auto">→</div></div></div></div>`;
        openSheet(html, 'peek');
        const sh = document.getElementById('sheet');
        const chips = sh.querySelector('.ochips.rchips');
        const end = chips || document.getElementById('stepsTitle');
        const h = Math.round(end.getBoundingClientRect().bottom - sh.getBoundingClientRect().top + 8);
        App.routePeek = Math.min(h, Math.max(360, Math.min(Math.round(innerHeight * 0.58), innerHeight - 160)));
        App.peekH = App.routePeek;
        setSheet('peek');
        // Let spring settle for geometry asserts
        return { peekH: App.peekH, state: sh.dataset.state, need: h, cap: Math.max(360, Math.min(Math.round(innerHeight * 0.58), innerHeight - 160)) };
      }, lang);

      await page.waitForTimeout(450); // spring settle

      for (const id of CHIP_IDS) {
        await page.locator('#' + id).waitFor({ state: 'attached', timeout: 15000 });
      }
      // Do NOT force full — the bug under test is peek clearance.
      for (const id of CHIP_IDS) await page.locator('#' + id).waitFor({ state: 'visible', timeout: 10000 });

      const m = await page.evaluate((ids) => {
        const row = document.querySelector('.ochips.rchips');
        const sheet = document.getElementById('sheet');
        const vw = window.innerWidth, vh = window.innerHeight;
        const chips = ids.map(id => {
          const b = document.getElementById(id); if (!b) return { id, missing: true };
          const r = b.getBoundingClientRect();
          const cs = getComputedStyle(b);
          return {
            id, text: b.textContent.trim(),
            w: Math.round(r.width), h: Math.round(r.height),
            left: r.left, right: r.right, top: r.top, bottom: r.bottom,
            inViewport: r.left >= -0.5 && r.right <= vw + 0.5 && r.top >= -0.5 && r.bottom <= vh + 0.5,
            visible: cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0,
            enabled: !b.disabled,
            clippedByRow: row ? (r.left < row.getBoundingClientRect().left - 1 || r.right > row.getBoundingClientRect().right + 1) : false,
          };
        });
        const tops = chips.filter(c => !c.missing).map(c => c.top);
        const sameRow = tops.length >= 2 && (Math.max(...tops) - Math.min(...tops) < 12);
        const rr = row ? row.getBoundingClientRect() : null;
        return {
          wrap: row ? getComputedStyle(row).flexWrap : null,
          overflowX: row ? getComputedStyle(row).overflowX : null,
          rowW: rr ? Math.round(rr.width) : 0,
          scrolled: row ? row.scrollWidth > row.clientWidth + 1 : false,
          sheetState: sheet ? sheet.dataset.state : null,
          sameRow,
          chips,
        };
      }, CHIP_IDS);

      ok(`${pre}: rchips row found (wrap)`, m.wrap === 'wrap', JSON.stringify({ wrap: m.wrap, overflowX: m.overflowX }));
      ok(`${pre}: row not horizontally scrolled`, !m.scrolled);
      ok(`${pre}: sheet stays at peek (not forced full)`, m.sheetState === 'peek', JSON.stringify({ state: m.sheetState, meta: sheetMeta }));
      if (lang === 'ar') ok(`${pre}: AR chips wrap to >1 row`, !m.sameRow, JSON.stringify(m.chips.map(c => ({ id: c.id, top: c.top }))));
      else ok(`${pre}: DE/EN chips stay one row`, m.sameRow, JSON.stringify(m.chips.map(c => ({ id: c.id, top: c.top }))));

      for (const c of m.chips) {
        ok(`${pre}: #${c.id} «${c.text}» present+visible+enabled`, !c.missing && c.visible && c.enabled, JSON.stringify(c));
        ok(`${pre}: #${c.id} fully in viewport at peek`, !c.missing && c.inViewport, JSON.stringify(c));
        ok(`${pre}: #${c.id} ≥44×44`, !c.missing && c.w >= 44 && c.h >= 44, `${c.w}x${c.h}`);
        ok(`${pre}: #${c.id} not clipped by row`, !c.missing && !c.clippedByRow, JSON.stringify(c));
      }

      // Tap steps chip to prove it's hittable at peek (then leave sheet alone)
      const stepsBox = m.chips.find(c => c.id === 'rSteps');
      if (stepsBox && stepsBox.inViewport) {
        await page.locator('#rSteps').tap({ timeout: 5000 }).catch(() => page.locator('#rSteps').click({ timeout: 5000 }));
        ok(`${pre}: #rSteps tappable at peek`, true);
      } else {
        ok(`${pre}: #rSteps tappable at peek`, false, JSON.stringify(stepsBox));
      }

      if (bn === browsers[0]) {
        // Re-open peek for clean screenshot (tap may have expanded sheet)
        await page.evaluate(async (lang) => {
          const { t, setLang } = await import(new URL('js/i18n.js', location.href));
          const { ic } = await import(new URL('js/icons.js', location.href));
          const { openSheet, setSheet, App } = await import(new URL('js/core.js', location.href));
          setLang(lang);
          const html = `<div class="cl-warn" role="status"><span>2 closures nearby</span></div>
            <div class="rcard on" role="button"><div style="flex:1;min-width:0"><div class="rt">12 min</div><div class="rd">4.2 km · via <bdi>Example St</bdi> · ETA 12:00</div><div class="fast">Fastest</div></div><button class="gobtn">${t('go')}</button></div>
            <div class="rcard" role="button"><div style="flex:1;min-width:0"><div class="rt">14 min</div><div class="rd">3.8 km · via <bdi>Other Rd</bdi> · ETA 12:02</div></div><button class="gobtn">${t('go')}</button></div>
            <div class="ochips rchips">
              <button class="ochip" id="rShare">${ic('share', 'xs')}${t('share_route')}</button>
              <button class="ochip" id="rShareImg">${ic('image', 'xs')}${t('shareImageShort')}</button>
              <button class="ochip" id="rPrint">${ic('download', 'xs')}${t('mapExportPrintShort')}</button>
              <button class="ochip" id="rSteps">${ic('directions', 'xs')}${t('steps')}</button>
            </div>
            <h3 class="sect-title" id="stepsTitle">${t('steps')}</h3>
            <div class="steps list"><div class="srow"><div class="st"><div class="t1" dir="auto">→</div></div></div></div>`;
          openSheet(html, 'peek');
          const sh = document.getElementById('sheet');
          const chips = sh.querySelector('.ochips.rchips');
          const end = chips || document.getElementById('stepsTitle');
          const h = Math.round(end.getBoundingClientRect().bottom - sh.getBoundingClientRect().top + 8);
          App.routePeek = Math.min(h, Math.max(360, Math.min(Math.round(innerHeight * 0.58), innerHeight - 160)));
          App.peekH = App.routePeek;
          setSheet('peek');
        }, lang);
        await page.waitForTimeout(450);
        const shotName = `route-chips-${lang}-390.png`;
        const p = path.join(OUT, shotName);
        await page.screenshot({ path: p });
        if (EXTRA) fs.copyFileSync(p, path.join(EXTRA, shotName));
        if (EXTRA && (lang === 'ar' || lang === 'de')) {
          fs.copyFileSync(p, path.join(EXTRA, lang === 'ar' ? 'ar-peek-chips.png' : 'de-peek-chips.png'));
        }
      }
      await ctx.close();
    }
    await browser.close();
  }
  srv.close();
  const fail = results.filter(x => !x).length;
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
