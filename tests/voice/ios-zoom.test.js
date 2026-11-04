// Khareeta – iPhone (WebKit, touch) zoom checks: pinch + double-tap zoom the MapLibre map, the page itself never
// zooms/shifts (no horizontal overflow), Apple-Maps style +/- buttons (44 px, right column under layers/3D, RTL,
// aria-label EN/AR/DE), with the world-names and Overture layers/attribution active.
// Run: node ios-zoom.test.js   (SHOTS=/path to also write screenshots elsewhere)
const { webkit, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out', 'ios'); fs.mkdirSync(OUT, { recursive: true });
const EXTRA = process.env.SHOTS || ''; if (EXTRA) fs.mkdirSync(EXTRA, { recursive: true });
const PORT = +(process.env.IOS_ZOOM_PORT || 8782), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
async function shot(page, name) { const p = path.join(OUT, name); await page.screenshot({ path: p }); if (EXTRA) fs.copyFileSync(p, path.join(EXTRA, name)); }
const LABELS = { en: ['Zoom in', 'Zoom out'], ar: ['تكبير', 'تصغير'], de: ['Vergrößern', 'Verkleinern'] };
const zoom = p => p.evaluate(() => window.KH?.App?.map?.getZoom?.() ?? (window.__map && window.__map.getZoom()));
const settle = p => p.evaluate(() => new Promise(r => { const m = KH.App.map; m.isMoving() ? m.once('moveend', () => r()) : r(); setTimeout(r, 1500); }));
// synthetic touch sequence on the map canvas (what iOS delivers to MapLibre for a pinch / a double tap)
async function touchSeq(page, frames, gap = 16) {
  await page.evaluate(async ({ frames, gap }) => {
    const c = KH.App.map.getCanvas(), r = c.getBoundingClientRect();
    const mk = (pts) => pts.map(([x, y], i) => ({ identifier: i + 1, target: c, clientX: r.left + x, clientY: r.top + y, pageX: r.left + x, pageY: r.top + y, screenX: r.left + x, screenY: r.top + y, force: 1 }));
    let prev = [];
    for (const f of frames) {
      const t = mk(f.pts), type = f.type;
      const ch = type === 'touchend' ? mk(prev) : t;
      // WebKit has no Touch constructor outside iOS → a plain event carrying TouchList-like arrays (what MapLibre reads)
      const ev = new Event(type, { bubbles: true, cancelable: true }), L = a => Object.assign(a.slice(), { item: i => a[i] });
      Object.defineProperties(ev, { touches: { value: L(type === 'touchend' ? [] : t) }, targetTouches: { value: L(type === 'touchend' ? [] : t) }, changedTouches: { value: L(ch) } });
      c.dispatchEvent(ev);
      prev = f.pts.length ? f.pts : prev; await new Promise(r => setTimeout(r, f.wait ?? gap));
    }
  }, { frames, gap });
}
const noOverflow = p => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: innerWidth, sx: scrollX, vvs: visualViewport ? visualViewport.scale : 1, vvx: visualViewport ? visualViewport.offsetLeft : 0 }));

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await webkit.launch();
  const dev = devices['iPhone 13'];
  for (const [lang, dark] of [['en', false], ['en', true], ['ar', false], ['ar', true], ['de', false], ['de', true]]) {
    const tag = `${lang}-${dark ? 'dark' : 'light'}`;
    const ctx = await browser.newContext({ ...dev, hasTouch: true, isMobile: true, colorScheme: dark ? 'dark' : 'light', serviceWorkers: 'block' });
    await ctx.addInitScript(`try { if (!sessionStorage.__i) { sessionStorage.__i = 1; localStorage.setItem('kh.lang', ${JSON.stringify(lang)}); localStorage.setItem('kh.onboarded', '1'); } } catch {}`);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort()); // offline CI: no OSM/OpenFreeMap requests
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => { if (!/access control checks|Load failed|cancelled/i.test(e.message)) errs.push(e.message); });
    await page.goto(ROOT + '#map=14/33.5138/36.2765', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.KH?.App?.map && document.querySelector('#btnZin svg'), null, { timeout: 30000 });
    await page.waitForFunction(() => KH.App.map.isStyleLoaded() || KH.App.map.loaded(), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // viewport meta: no zoom lock (a11y), inputs ≥16px so iOS does not auto-zoom on focus
    const meta = await page.evaluate(() => document.querySelector('meta[name=viewport]').content);
    ok(`${tag}: viewport meta without maximum-scale/user-scalable`, !/maximum-scale|user-scalable/.test(meta), meta);
    ok(`${tag}: search input font-size ≥16px`, await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#q')).fontSize) >= 16));
    // world + Overture: layers/attribution state when present (offline CI may not have tiles, layers are still registered)
    const lay = await page.evaluate(() => { const st = KH.App.map.getStyle?.() || { layers: [] }; const ids = st.layers.map(l => l.id);
      const a = document.querySelector('.kattr-osm'), r = a?.getBoundingClientRect();
      return { n: ids.length, ov: ids.filter(i => /^ov|overture/i.test(i)).length, attrVis: !!r && r.width > 0 && r.right <= innerWidth + 1 && r.left >= -1, attr: a?.textContent }; });
    ok(`${tag}: OSM attribution visible inside the viewport`, lay.attrVis && /OpenStreetMap|OpenStreetMap|أوبن ستريت ماب/.test(lay.attr || '') , JSON.stringify(lay));
    // try to switch the Overture attribution on (world/overture state) and re-check overflow
    await page.evaluate(() => { try { document.querySelector('.kattr')?.classList.add('ov'); const s = document.querySelector('.kattr-ovn'); const o = document.querySelector('.kattr-ov'); if (s) s.hidden = false; if (o) o.hidden = false; } catch {} });
    let o = await noOverflow(page);
    ok(`${tag}: no horizontal overflow (scrollWidth ≤ innerWidth) incl. Overture attribution`, o.sw <= o.iw && o.bw <= o.iw && o.sx === 0, JSON.stringify(o));
    // buttons
    const b = await page.evaluate(() => { const zi = document.querySelector('#btnZin'), zo = document.querySelector('#btnZout'), l = document.querySelector('#btnLayers'), d = document.querySelector('#btn3d');
      const R = e => e.getBoundingClientRect(); const ri = R(zi), ro = R(zo), rl = R(l), rd = R(d);
      return { wi: ri.width, hi: ri.height, ho: ro.height, vis: getComputedStyle(document.querySelector('#zoomGrp')).display !== 'none' && ri.width > 0,
        under3d: ri.top >= rd.bottom - 1 && Math.abs(ri.left - rl.left) < 2 && ro.top >= ri.bottom - 1, x: ri.left, vw: innerWidth, dir: document.documentElement.dir,
        li: zi.getAttribute('aria-label'), lo: zo.getAttribute('aria-label'), inView: ri.right <= innerWidth && ri.left >= 0 }; });
    ok(`${tag}: +/- visible, 44×44, in the right column under layers/3D`, b.vis && b.wi >= 44 && b.hi >= 44 && b.ho >= 44 && b.under3d && b.inView, JSON.stringify(b));
    ok(`${tag}: aria-labels ${lang.toUpperCase()}`, b.li === LABELS[lang][0] && b.lo === LABELS[lang][1], b.li + ' / ' + b.lo);
    if (lang === 'ar') ok(`${tag}: RTL – zoom column on the left (inline-end)`, b.dir === 'rtl' && b.x < b.vw / 2, JSON.stringify(b));
    else ok(`${tag}: LTR – zoom column on the right`, b.x > b.vw / 2, JSON.stringify(b));
    let z0 = await zoom(page); await page.tap('#btnZin'); await settle(page); let z1 = await zoom(page);
    ok(`${tag}: + button zooms in`, z1 > z0 + 0.5, `${z0} → ${z1}`);
    await page.tap('#btnZout'); await settle(page); let z2 = await zoom(page);
    ok(`${tag}: − button zooms out`, z2 < z1 - 0.5, `${z1} → ${z2}`);
    // pinch out on the map
    z0 = await zoom(page);
    const cx = 195, cy = 380, frames = [{ type: 'touchstart', pts: [[cx - 30, cy], [cx + 30, cy]] }];
    for (let i = 1; i <= 12; i++) frames.push({ type: 'touchmove', pts: [[cx - 30 - i * 10, cy], [cx + 30 + i * 10, cy]] });
    frames.push({ type: 'touchend', pts: [], wait: 400 });
    await touchSeq(page, frames); await settle(page); z1 = await zoom(page);
    ok(`${tag}: pinch zooms the map`, z1 > z0 + 0.3, `${z0} → ${z1}`);
    // double tap on the map
    z0 = await zoom(page);
    await touchSeq(page, [{ type: 'touchstart', pts: [[200, 400]], wait: 40 }, { type: 'touchend', pts: [], wait: 80 }, { type: 'touchstart', pts: [[200, 400]], wait: 40 }, { type: 'touchend', pts: [], wait: 600 }]);
    await settle(page); z1 = await zoom(page);
    ok(`${tag}: double-tap zooms the map`, z1 > z0 + 0.5, `${z0} → ${z1}`);
    // dblclick (pointer) still zooms
    z0 = await zoom(page); await page.locator('#map canvas.maplibregl-canvas').dblclick({ position: { x: 200, y: 300 }, force: true }); await settle(page); z1 = await zoom(page);
    ok(`${tag}: dblclick zooms the map`, z1 > z0 + 0.5, `${z0} → ${z1}`);
    // gesture events: cancelled on UI overlays, untouched on the map (map pinch keeps working)
    const g = await page.evaluate(() => { const fire = el => { const e = new Event('gesturestart', { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; };
      return { ui: fire(document.querySelector('#searchbar')), chips: fire(document.querySelector('#chips') || document.body), map: fire(KH.App.map.getCanvas()),
        ta: getComputedStyle(document.querySelector('#searchbar')).touchAction, mapTa: getComputedStyle(KH.App.map.getCanvasContainer()).touchAction, bodyTa: getComputedStyle(document.body).touchAction }; });
    ok(`${tag}: page gestures cancelled on UI only, map canvas container touch-action:none, body not locked`, g.ui && g.chips && !g.map && g.mapTa === 'none' && g.bodyTa !== 'none' && !/pinch-zoom|manipulation/.test(g.ta), JSON.stringify(g));
    o = await noOverflow(page);
    ok(`${tag}: page not zoomed or shifted after gestures`, o.sw <= o.iw && o.sx === 0 && o.vvs === 1 && o.vvx === 0, JSON.stringify(o));
    await shot(page, `zoom-${tag}-iphone13.png`);
    ok(`${tag}: no page errors`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  await browser.close(); srv.close();
  const fail = results.filter(x => !x).length;
  console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
