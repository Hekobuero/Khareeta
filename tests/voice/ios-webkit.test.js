// Khareeta – iPhone (WebKit) checks for voice guidance + the speaker button in navigation.
// Playwright WebKit with the "iPhone 13" device profile; speechSynthesis is replaced by an iOS-like mock
// (empty voice list until first speech, speech before a user gesture is dropped, speak() right after cancel() is dropped).
// Run: node ios-webkit.test.js   (SHOTS=/path to also write screenshots elsewhere)
const { webkit, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out', 'ios'); fs.mkdirSync(OUT, { recursive: true });
const EXTRA = process.env.SHOTS || ''; if (EXTRA) fs.mkdirSync(EXTRA, { recursive: true });
const PORT = +(process.env.IOS_PORT || 8781), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const MOCK = `(() => {
  const voices = [{ name: 'Daniel', lang: 'en-GB', localService: true, voiceURI: 'Daniel' }, { name: 'Markus', lang: 'de-DE', localService: true, voiceURI: 'Markus' }, { name: 'Majed', lang: 'ar-001', localService: true, voiceURI: 'Majed' }];
  let list = [], unlocked = false, lastCancel = -1e9;
  window.__spoken = []; window.__dropped = [];
  const inGesture = () => !!(navigator.userActivation && navigator.userActivation.isActive) || window.__gesture;
  class U { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.volume = 1; this.rate = 1; this.pitch = 1; } addEventListener() {} }
  window.SpeechSynthesisUtterance = U;
  const syn = { speaking: false, pending: false, paused: false, _c: null, getVoices: () => list.slice(),
    speak(u) {
      if (!unlocked && !inGesture()) { window.__dropped.push({ text: u.text, why: 'no-gesture' }); return; }
      if (Date.now() - lastCancel < 60) { window.__dropped.push({ text: u.text, why: 'after-cancel' }); return; }
      if (!unlocked) { unlocked = true; setTimeout(() => { list = voices.slice(); }, 50); }
      window.__spoken.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name, vol: u.volume });
      this._c = u; this.speaking = true; setTimeout(() => { if (this._c === u) { this._c = null; this.speaking = false; u.onend && u.onend({}); } }, u.volume === 0 ? 10 : 600);
    },
    cancel() { lastCancel = Date.now(); const c = this._c; this._c = null; this.speaking = false; c && c.onerror && c.onerror({}); },
    pause() { this.paused = true; }, resume() { this.paused = false; }, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, 'speechSynthesis', { value: syn, configurable: true });
})();`;
function mkRoute() {
  const lon0 = 36.2765, lat0 = 33.5138, mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110950, coords = [];
  for (let i = 0; i <= 80; i++) coords.push([lon0 + (i * 10) / mx, lat0]);
  for (let i = 1; i <= 70; i++) coords.push([lon0 + 800 / mx, lat0 + (i * 10) / my]);
  const end = coords.at(-1);
  return { coords, distance: 1500, duration: 150, legs: [{}], steps: [
    { type: 'depart', modifier: 'straight', name: 'Al-Thawra Street', ref: '', distance: 800, duration: 80, loc: coords[0], bearing_after: 90, leg: 0, last: false },
    { type: 'turn', modifier: 'left', name: 'Baghdad Street', ref: '', distance: 700, duration: 70, loc: coords[80], bearing_after: 0, leg: 0, last: false },
    { type: 'arrive', modifier: 'right', name: '', ref: '', distance: 0, duration: 0, loc: end, bearing_after: 0, leg: 0, last: true }] };
}
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
async function shot(page, name) { const p = path.join(OUT, name); await page.screenshot({ path: p }); if (EXTRA) fs.copyFileSync(p, path.join(EXTRA, name)); }

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await webkit.launch();
  const dev = devices['iPhone 13'];
  for (const [lang, dark] of [['en', false], ['en', true], ['ar', false], ['ar', true], ['de', false]]) {
    const tag = `${lang}-${dark ? 'dark' : 'light'}`;
    const ctx = await browser.newContext({ ...dev, colorScheme: dark ? 'dark' : 'light', serviceWorkers: 'block' });
    await ctx.addInitScript(MOCK);
    await ctx.addInitScript(`try { if (!sessionStorage.__i) { sessionStorage.__i = 1; localStorage.setItem('kh.lang', ${JSON.stringify(lang)}); localStorage.setItem('kh.onboarded', '1'); } } catch {}`);
    // keep the map offline: no tile/route requests to OSM servers from CI
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => { if (!/access control checks|Load failed|cancelled/i.test(e.message)) errs.push(e.message); }); // fetches aborted by reload are not app errors
    await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#btnMenu svg'), null, { timeout: 30000 });
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => ({ list: speechSynthesis.getVoices().length, hidden: getComputedStyle(document.querySelector('#navVoice')).display }));
    ok(`${tag}: iOS-like start: empty voice list, speaker button hidden outside navigation`, before.list === 0 && before.hidden === 'none', JSON.stringify(before));
    // start navigation from a real tap (button injected for the test → startNav runs inside the gesture, like "Go")
    await page.evaluate(async rt => {
      const m = await import(new URL('js/route.js', location.href));
      m.routeState.routes = [rt]; m.routeState.sel = 0; m.routeState.mode = 'car';
      const b = document.createElement('button'); b.id = '__go'; b.textContent = 'Go'; b.style.cssText = 'position:fixed;top:0;left:0;width:60px;height:60px;z-index:99999';
      b.onclick = () => m.startNav(true); document.body.appendChild(b);
    }, mkRoute());
    await page.tap('#__go'); await page.evaluate(() => document.querySelector('#__go').remove());
    await page.waitForTimeout(2500);
    const s = await page.evaluate(() => ({ spoken: window.__spoken.filter(x => x.vol !== 0).map(x => x.text + '|' + x.lang + '|' + x.voice), unlock: window.__spoken.filter(x => x.vol === 0).length, dropped: window.__dropped }));
    ok(`${tag}: unlock utterance inside the "Go" tap`, s.unlock >= 1, JSON.stringify(s));
    ok(`${tag}: start prompt spoken later from the GPS/sim timer (not dropped by iOS)`, s.spoken.length >= 1 && !s.dropped.some(d => d.why === 'no-gesture' && d.text.trim()), JSON.stringify(s));
    const b = await page.evaluate(() => { const e = document.querySelector('#navVoice'), r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return { w: r.width, h: r.height, x: r.x, vis: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0, label: e.getAttribute('aria-label'), pressed: e.getAttribute('aria-pressed'), dir: document.documentElement.dir, vw: innerWidth }; });
    ok(`${tag}: speaker button visible during navigation, ≥44×44, aria-label`, b.vis && b.w >= 44 && b.h >= 44 && b.label && b.label !== 'Voice guidance', JSON.stringify(b));
    if (lang === 'ar') ok(`${tag}: RTL – button on the left edge`, b.dir === 'rtl' && b.x < b.vw / 2, JSON.stringify(b));
    await shot(page, `nav-${tag}-iphone13.png`);
    // mute
    await page.tap('#navVoice'); await page.waitForTimeout(300);
    const m1 = await page.evaluate(() => ({ s: JSON.parse(localStorage.getItem('kh.settings') || '{}').voice, p: document.querySelector('#navVoice').getAttribute('aria-pressed'), n: window.__spoken.length, speaking: speechSynthesis.speaking }));
    ok(`${tag}: tap mutes, persisted in localStorage, speech stopped`, m1.s === false && m1.p === 'true' && !m1.speaking, JSON.stringify(m1));
    await page.waitForTimeout(400); await shot(page, `nav-${tag}-muted-iphone13.png`);
    // reload keeps the choice
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => document.querySelector('#btnMenu svg'));
    ok(`${tag}: mute survives reload`, await page.evaluate(() => JSON.parse(localStorage.getItem('kh.settings') || '{}').voice === false));
    // unmute again → test announcement
    await page.evaluate(async rt => { const m = await import(new URL('js/route.js', location.href)); m.routeState.routes = [rt]; m.routeState.sel = 0; m.routeState.mode = 'car'; m.startNav(true); }, mkRoute());
    await page.waitForTimeout(800);
    const n0 = await page.evaluate(() => window.__spoken.filter(x => x.vol !== 0).length);
    await page.tap('#navVoice'); await page.waitForTimeout(900);
    const u = await page.evaluate(() => ({ s: JSON.parse(localStorage.getItem('kh.settings') || '{}').voice, spoken: window.__spoken.filter(x => x.vol !== 0).map(x => x.text), dropped: window.__dropped, toast: document.querySelector('#toast')?.textContent }));
    ok(`${tag}: tap unmutes + speaks a test announcement`, u.s === true && u.spoken.length > n0, JSON.stringify(u));
    ok(`${tag}: iPhone hint about the silent switch shown`, /silent|Stumm|الصامت/.test(u.toast || ''), u.toast);
    await shot(page, `nav-${tag}-unmuted-toast-iphone13.png`);
    ok(`${tag}: no page errors`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  await browser.close(); srv.close();
  const fail = results.filter(x => !x).length;
  console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
