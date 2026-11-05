// Khareeta – action-row labels must not be clipped at iPhone 390 px (Layla: AR «المسار إل…» in "What's here?").
// Checks the "What's here?" sheet and the place sheet (POI + dropped pin), DE/EN/AR (LTR+RTL), light+dark, WebKit + Chromium:
// every action-button label (route/directions first) is fully visible (no ellipsis, scrollWidth <= clientWidth, inside the button,
// row not scrolled horizontally) and every button is ≥ 44 px tappable. All non-local requests are aborted (no OSM/Nominatim/
// Overpass/Photon/Supabase calls).  Run: node action-row.test.js  (SHOTS=dir TAG=prefix for screenshots)
const { webkit, chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = process.env.KH_REPO || path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out', 'action-row'); fs.mkdirSync(OUT, { recursive: true });
const EXTRA = process.env.SHOTS || ''; if (EXTRA) fs.mkdirSync(EXTRA, { recursive: true });
const TAG = process.env.TAG || '';
const PORT = +(process.env.AR_PORT || 8787), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
const POI = { id: 'n1', osm_type: 'node', osm_id: 1, name: 'Café Test', lat: 33.5138, lon: 36.2765, cat: 'cafe', tags: { amenity: 'cafe', name: 'Café Test' } };
const measure = (page, sel) => page.evaluate(sel => {
  const row = document.querySelector(sel); if (!row) return null;
  const rr = row.getBoundingClientRect();
  return { scrolled: row.scrollWidth > row.clientWidth + 1, btns: [...row.querySelectorAll('.abtn')].map(b => {
    const s = b.querySelector('span'), br = b.getBoundingClientRect(), sr = s ? s.getBoundingClientRect() : br;
    const cs = s ? getComputedStyle(s) : null;
    const ellipsis = !!cs && cs.textOverflow === 'ellipsis' && s.scrollWidth > s.clientWidth + 1;
    return { id: b.id, text: s ? s.textContent : '', w: Math.round(br.width), h: Math.round(br.height),
      clipped: !!s && (s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1), ellipsis,
      inside: sr.left >= br.left - 1 && sr.right <= br.right + 1 && br.left >= rr.left - 1 && br.right <= rr.right + 1 };
  }) };
}, sel);
function check(name, m, routeId) {
  ok(`${name}: action row found`, !!m); if (!m) return;
  ok(`${name}: row not horizontally scrolled`, !m.scrolled);
  const r = m.btns.find(b => b.id === routeId);
  ok(`${name}: route button «${r?.text}» fully visible`, r && !r.clipped && !r.ellipsis && r.inside, JSON.stringify(r));
  for (const b of m.btns) if (b.id !== routeId) ok(`${name}: #${b.id} «${b.text}» fully visible`, !b.clipped && !b.ellipsis && b.inside, JSON.stringify(b));
  const hs = m.btns.map(b => b.h);
  ok(`${name}: uniform button height ≥68 px`, hs.length && Math.min(...hs) >= 68 && Math.max(...hs) - Math.min(...hs) <= 1, hs.join(' '));
  ok(`${name}: all buttons ≥44 px`, m.btns.every(b => b.w >= 44 && b.h >= 44), m.btns.map(b => b.w + 'x' + b.h).join(' '));
}
(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browsers = (process.env.BROWSERS || 'webkit,chromium').split(',');
  for (const bn of browsers) {
    const browser = await { webkit, chromium }[bn].launch();
    for (const scheme of ['light', 'dark']) for (const lang of ['de', 'en', 'ar']) {
      const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, serviceWorkers: 'block', colorScheme: scheme });
      await ctx.addInitScript(`try { if (!sessionStorage.__i) { sessionStorage.__i = 1; localStorage.setItem('kh.lang', ${JSON.stringify(lang)}); localStorage.setItem('kh.onboarded', '1'); } } catch {}`);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
      const page = await ctx.newPage();
      await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#btnMenu svg'), null, { timeout: 30000 }); await page.waitForTimeout(800);
      const dir = await page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction);
      ok(`${bn} ${scheme} ${lang}: direction ${dir}`, lang === 'ar' ? dir === 'rtl' : dir !== 'rtl');
      const pre = `${bn} ${scheme} ${lang}`;
      await page.evaluate(async () => { const m = await import(new URL('js/whats-here.js', location.href)); m.openWhatsHere([36.2765, 33.5138]); });
      await page.waitForSelector('#whRoute'); await page.waitForTimeout(600);
      check(`${pre} what's-here`, await measure(page, '.sheet .arow.actions'), 'whRoute');
      if (bn === browsers[0] && scheme === 'light') { const p = path.join(OUT, `${TAG}wh-${lang}-light-390.png`); await page.screenshot({ path: p }); if (EXTRA) fs.copyFileSync(p, path.join(EXTRA, path.basename(p))); }
      await page.evaluate(async () => (await import(new URL('js/core.js', location.href))).closeSheet()); await page.waitForTimeout(400);
      for (const [kind, item] of [['place', POI], ['pin', { id: 'pt1', coord: true, name: 'Pin', lon: 36.2765, lat: 33.5138, tags: {} }]]) {
        await page.evaluate(async it => { const m = await import(new URL('js/place.js', location.href)); m.openPlace(it, { noFly: true }); }, item);
        await page.waitForSelector('#pDir'); await page.waitForTimeout(600);
        check(`${pre} ${kind}-sheet`, await measure(page, '.sheet .arow.actions'), 'pDir');
        if (bn === browsers[0] && scheme === 'light') { const p = path.join(OUT, `${TAG}${kind}-${lang}-light-390.png`); await page.screenshot({ path: p }); if (EXTRA) fs.copyFileSync(p, path.join(EXTRA, path.basename(p))); }
        await page.evaluate(async () => (await import(new URL('js/core.js', location.href))).closeSheet()); await page.waitForTimeout(400);
      }
      await ctx.close();
    }
    await browser.close();
  }
  srv.close();
  const fail = results.filter(x => !x).length; console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
