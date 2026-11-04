import { webkit, devices } from 'playwright';
const out = process.env.OUT || './', URL0 = process.env.URL || 'http://127.0.0.1:8792/';
const CITIES = { berlin: { gps: [13.4050, 52.5200], from: [13.4072, 52.5208], to: [13.4135, 52.5188], view: [13.40, 52.52] }, damascus: { gps: [36.3065, 33.5115], from: [36.3080, 33.5122], to: [36.3125, 33.5105], view: [36.30, 33.51] } };
const langs = (process.env.LANGS || 'en,ar,de').split(','), b = await webkit.launch(), res = [];
const geoInit = ([gps, deny, lang, view]) => {
  localStorage.setItem('kh.lang', lang); localStorage.setItem('kh.view', JSON.stringify({ c: view, z: 15 }));
  const W = { cbs: [], pos: gps, deny };
  const mk = (p, h = null, s = 0) => ({ coords: { longitude: p[0], latitude: p[1], accuracy: 5, heading: h, speed: s }, timestamp: Date.now() });
  window.__geo = W; window.__push = (p, h, s) => { W.pos = p; W.cbs.forEach(c => c(mk(p, h, s))); };
  const g = { getCurrentPosition: (ok, err) => setTimeout(() => W.deny ? err({ code: 1, message: 'denied' }) : ok(mk(W.pos)), 50),
    watchPosition: (ok, err) => { if (W.deny) { setTimeout(() => err({ code: 1 }), 50); return 1; } W.cbs.push(ok); return W.cbs.length; }, clearWatch: () => { W.cbs = []; } };
  Object.defineProperty(navigator, 'geolocation', { value: g, configurable: true });
};
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(b[1] * Math.PI / 180), (a[1] - b[1]) * 110540);
async function page(lang, city, deny = false) {
  const ctx = await b.newContext(devices['iPhone 13']); const p = await ctx.newPage();
  await p.route(/supabase\.co/, r => r.abort());
  const C = CITIES[city]; await p.addInitScript(geoInit, [C.gps, deny, lang, C.view]);
  await p.goto(URL0); await p.waitForTimeout(3500); return { ctx, p, C };
}
const center = p => p.evaluate(async () => { const { App } = await import('/js/core.js'); const c = App.map.getCenter(); return [c.lng, c.lat, App.map.getZoom()]; });
for (const city of ['berlin', 'damascus']) for (const lang of langs) for (const mode of (lang === 'en' ? ['foot', 'car'] : ['foot'])) {
  const { ctx, p, C } = await page(lang, city);
  await p.evaluate(async ([C, mode]) => { const R = await import('/js/route.js'); R.routeFromUrl([{ lon: C.from[0], lat: C.from[1], name: 'A' }, { lon: C.to[0], lat: C.to[1], name: 'B' }], mode); }, [C, mode]);
  await p.waitForSelector('[data-go]', { timeout: 30000 }); await p.waitForTimeout(800);
  await p.click('[data-go]'); await p.waitForTimeout(2600);
  const c0 = await center(p); const st0 = await p.evaluate(async () => (await import('/js/route.js')).navState());
  await p.screenshot({ path: `${out}${city}-${lang}-${mode}-1-navstart.png` });
  // walk / drive a track without GPS heading (slow) → heading from the positions
  let pos = C.gps; const step = mode === 'car' ? 0.00025 : 0.00006;
  for (let i = 0; i < 4; i++) { pos = [pos[0] + step, pos[1] + step * 0.3]; await p.evaluate(([q, s]) => window.__push(q, null, s), [pos, mode === 'car' ? 0.5 : 0.8]); await p.waitForTimeout(1100); }
  const c1 = await center(p), st1 = await p.evaluate(async () => (await import('/js/route.js')).navState());
  // manual pan
  await p.mouse.move(195, 420); await p.mouse.down(); await p.mouse.move(120, 300, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(800);
  const st2 = await p.evaluate(async () => (await import('/js/route.js')).navState()), rcVis = await p.isVisible('#navRecenter');
  const rcBox = rcVis ? await p.locator('#navRecenter').boundingBox() : null;
  await p.screenshot({ path: `${out}${city}-${lang}-${mode}-2-recenter-button.png` });
  if (rcVis) await p.click('#navRecenter'); await p.waitForTimeout(1500);
  const c3 = await center(p), st3 = await p.evaluate(async () => (await import('/js/route.js')).navState());
  res.push({ city, lang, mode, startOff_m: Math.round(dist(c0, C.gps)), z0: +c0[2].toFixed(1), sim: st0.isSim, follow0: st0.follow, hdg1: Math.round(st1.hdg), followOff_m: Math.round(dist(c1, pos)), follow2: st2.follow, rcVis, rcH: rcBox && Math.round(rcBox.height), follow3: st3.follow, refollow_m: Math.round(dist(c3, pos)) });
  await ctx.close();
}
for (const city of ['berlin', 'damascus']) for (const lang of langs) {
  const { ctx, p, C } = await page(lang, city);
  const before = await center(p);
  await p.click('.chip[data-cat="restaurants"]'); await p.waitForTimeout(9000);
  const after = await center(p), n = await p.locator('#sheet .srow').count();
  res.push({ city, lang, mode: 'chip:restaurants', moved_m: Math.round(dist(after, before)), z: +after[2].toFixed(1), rows: n });
  await p.screenshot({ path: `${out}${city}-${lang}-category-restaurants.png` }); await ctx.close();
}
for (const lang of langs) {
  const { ctx, p, C } = await page(lang, 'berlin', true);
  await p.evaluate(async C => { const R = await import('/js/route.js'); R.routeFromUrl([{ lon: C.from[0], lat: C.from[1], name: 'A' }, { lon: C.to[0], lat: C.to[1], name: 'B' }], 'foot'); }, C);
  await p.waitForSelector('[data-go]', { timeout: 30000 }); await p.waitForTimeout(800); await p.click('[data-go]'); await p.waitForTimeout(900);
  const st = await p.evaluate(async () => (await import('/js/route.js')).navState()), toast = await p.evaluate(() => document.querySelector('#toast,.toast')?.textContent || '');
  res.push({ city: 'berlin', lang, mode: 'denied', active: st.active, toast: toast.slice(0, 60) });
  await p.screenshot({ path: `${out}berlin-${lang}-denied.png` }); await ctx.close();
}
console.log(JSON.stringify(res, null, 0).replace(/\},\{/g, '}\n{')); await b.close();
