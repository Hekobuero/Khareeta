// Khareeta voice guidance – end-to-end checks (Playwright/Chromium, speechSynthesis mocked). See README.md.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROME || undefined; // default: Playwright's own Chromium
const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out'), SHOTS = path.join(OUT, 'shots') + '/';
// Ports: PORT and PORT+1 if set, otherwise free ephemeral ports; a busy port falls back to an ephemeral one (QA P3)
const PORT = +(process.env.PORT || 0);
let ROOT = '', SUB = '';
// two tiny static servers: the app at "/" and under a subpath (own origin → own service worker)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.pbf': 'application/x-protobuf', '.xml': 'application/xml', '.txt': 'text/plain' };
function serve(port, prefix) {
  return new Promise(res => { const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
    if (!u.startsWith(prefix)) { rs.writeHead(404); return rs.end(); }
    let f = path.join(REPO, u.slice(prefix.length)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); rs.end(b); });
  }); srv.once('error', e => { if (e.code !== 'EADDRINUSE' || !port) throw e; srv.listen(0, '127.0.0.1', () => res(srv)); }); srv.listen(port, '127.0.0.1', () => res(srv)); });
}
const V = (name, lang, local = true) => ({ name, lang, localService: local, voiceURI: name, default: false });
const UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};
const iosVoices = [V('Majed', 'ar-001'), V('Mariam', 'ar-001'), V('Tarik', 'ar-SA'), V('Laila', 'ar-SA'),
  V('Anna', 'de-DE'), V('Markus', 'de-DE'), V('Petra (Premium)', 'de-DE'), V('Eddy (Deutsch (Deutschland))', 'de-DE'), V('Grandpa (Deutsch (Deutschland))', 'de-DE'),
  V('Samantha', 'en-US'), V('Daniel', 'en-GB'), V('Evan (Enhanced)', 'en-US'), V('Fred', 'en-US'), V('Albert', 'en-US'), V('Karen', 'en-AU')];
const P = {
  ios: { ua: UA.ios, delay: 700, event: false, voices: iosVoices, exp: { en: 'Daniel', de: 'Markus', ar: 'Tarik' }, st: { en: 'ok', de: 'ok', ar: 'ok' } },
  win: { ua: UA.win, delay: 300, event: true, voices: [V('Microsoft David - English (United States)', 'en-US'), V('Microsoft Zira - English (United States)', 'en-US'), V('Microsoft George - English (United Kingdom)', 'en-GB'), V('Microsoft Hazel - English (United Kingdom)', 'en-GB'),
    V('Microsoft Hedda - German (Germany)', 'de-DE'), V('Microsoft Stefan - German (Germany)', 'de-DE'), V('Microsoft Naayf - Arabic (Saudi Arabia)', 'ar-SA'), V('Microsoft Hoda - Arabic (Egypt)', 'ar-EG'),
    V('Microsoft Laith Online (Natural) - Arabic (Syria)', 'ar-SY', false), V('Microsoft Conrad Online (Natural) - German (Germany)', 'de-DE', false), V('Microsoft Ryan Online (Natural) - English (United Kingdom)', 'en-GB', false), V('Google Deutsch', 'de-DE', false)],
    exp: { en: 'Microsoft George - English (United Kingdom)', de: 'Microsoft Stefan - German (Germany)', ar: 'Microsoft Naayf - Arabic (Saudi Arabia)' }, st: { en: 'ok', de: 'ok', ar: 'ok' } },
  android: { ua: UA.android, delay: 400, event: true, voices: [V('ar-xa-x-arc-local', 'ar'), V('ar-xa-x-ard-local', 'ar'), V('ar-xa-x-ard-network', 'ar', false), V('de-de-x-nfh-local', 'de-DE'), V('de-de-x-deb-local', 'de-DE'), V('en-us-x-iom-local', 'en-US'), V('en-gb-x-gba-local', 'en-GB'), V('en-gb-x-gbd-local', 'en-GB')],
    exp: { en: 'en-gb-x-gbd-local', de: 'de-de-x-deb-local', ar: 'ar-xa-x-ard-local' }, st: { en: 'ok', de: 'ok', ar: 'ok' } },
  noAr: { ua: UA.ios, delay: 500, event: false, voices: iosVoices.filter(v => !v.lang.startsWith('ar')), exp: { en: 'Daniel', de: 'Markus', ar: null }, st: { en: 'ok', de: 'ok', ar: 'none' } },
  online: { ua: UA.linux, delay: 300, event: true, voices: [V('Google Deutsch', 'de-DE', false), V('Google US English', 'en-US', false), V('Google UK English Male', 'en-GB', false), V('Microsoft Laith Online (Natural) - Arabic (Syria)', 'ar-SY', false)],
    exp: { en: null, de: null, ar: null }, st: { en: 'online', de: 'online', ar: 'online' } },
  // Chrome desktop "Google …" voices claim localService=true on some builds – must still be excluded
  chromeDesk: { ua: UA.linux, delay: 300, event: true, voices: [V('Google Deutsch', 'de-DE'), V('Google US English', 'en-US'), V('Google العربية', 'ar-SA')], exp: { en: null, de: null, ar: null }, st: { en: 'online', de: 'online', ar: 'online' } },
  empty: { ua: UA.linux, delay: 0, event: false, voices: [], exp: { en: null, de: null, ar: null }, st: { en: 'unknown', de: 'unknown', ar: 'unknown' } },
  noTts: { ua: UA.linux, none: true, delay: 0, event: false, voices: [], exp: { en: null, de: null, ar: null }, st: { en: 'unsupported', de: 'unsupported', ar: 'unsupported' } },
};
const mock = p => `(() => { const P = ${JSON.stringify({ delay: p.delay, event: p.event, voices: p.voices, none: !!p.none })};
  window.__spoken = []; window.__cancels = []; window.__overlap = []; window.__ended = [];
  if (P.none) { try { delete window.speechSynthesis; } catch {} try { delete Window.prototype.speechSynthesis; } catch {} try { delete window.SpeechSynthesisUtterance; } catch {} return; }
  const voices = [], ev = []; let on = null;
  class U { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.volume = 1; this.rate = 1; this.pitch = 1; this.onend = null; this.onerror = null; } }
  window.SpeechSynthesisUtterance = U;
  const MS = 70; // ≈ 14 characters per second, like a real voice
  const syn = { speaking: false, paused: false, pending: false, _q: [], _cur: null, getVoices() { return voices.slice(); },
    speak(u) {
      if (window.__throwOn && window.__throwOn.test(u.text)) throw new Error('synthesis-failed'); // simulated engine error
      window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, lang: u.lang, vol: u.volume, t: Date.now(), me: window.__me ? window.__me() : null });
      if (this._cur && u.volume !== 0) window.__overlap.push(u.text);
      if (this._cur) { this._q.push(u); this.pending = true; return; }
      this._play(u);
    },
    _play(u) { this._cur = u; this.speaking = true; const ms = u.volume === 0 ? 20 : Math.max(300, String(u.text).length * MS);
      u._t = setTimeout(() => { this._cur = null; this.speaking = false; if (u.volume !== 0) window.__ended.push(u.text); u.onend && u.onend({}); const n = this._q.shift(); this.pending = this._q.length > 0; if (n) this._play(n); }, ms); },
    cancel() { const c = this._cur; window.__cancels.push({ t: Date.now(), cut: c && c.volume !== 0 ? c.text : null, dropped: this._q.map(q => q.text) });
      if (c) { clearTimeout(c._t); this._cur = null; this.speaking = false; c.onerror && c.onerror({ error: 'interrupted' }); }
      this._q.forEach(q => q.onerror && q.onerror({ error: 'canceled' })); this._q = []; this.pending = false; },
    pause() {}, resume() {}, addEventListener(n, f) { if (n === 'voiceschanged') ev.push(f); }, removeEventListener() {},
    set onvoiceschanged(f) { on = f; }, get onvoiceschanged() { return on; } };
  Object.defineProperty(window, 'speechSynthesis', { value: syn, configurable: true });
  if (P.voices.length) setTimeout(() => { voices.push(...P.voices); if (P.event) { ev.forEach(f => f({})); on && on({}); } }, P.delay);
})();`;
const results = [], errors = [];
const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond, info }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  — ' + info : '')); };

async function ctxFor(browser, prof, { vp = { width: 390, height: 844 }, lang = 'en', dark = false, settings = null, tag = '' } = {}) {
  const ctx = await browser.newContext({ viewport: vp, userAgent: P[prof].ua, colorScheme: dark ? 'dark' : 'light', locale: 'en-US', serviceWorkers: 'allow' });
  await ctx.addInitScript(mock(P[prof]));
  await ctx.addInitScript(`try { if (!sessionStorage.__init) { sessionStorage.__init = 1; localStorage.setItem('kh.lang', ${JSON.stringify(lang)}); localStorage.setItem('kh.onboarded','1'); ${settings ? `localStorage.setItem('kh.settings', ${JSON.stringify(JSON.stringify(settings))});` : ''} } localStorage.setItem('kh.dev','1'); } catch {}`);
  return ctx;
}
function watch(page, tag) {
  page.on('pageerror', e => errors.push(`[${tag}] pageerror ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${tag}] console ${m.text()}`); });
}
async function load(page, base) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#btnMenu svg'), null, { timeout: 20000 });
  await page.evaluate(async () => { const c = await import(new URL('js/core.js', location.href)); window.__me = () => c.App.me; });
  await page.waitForTimeout(1200); // voices arrive (delay ≤ 700 ms, iOS without event → poll)
  // dismiss onboarding / sheets if any
  await page.keyboard.press('Escape').catch(() => {});
}
async function openDrawer(page) {
  await page.click('#btnMenu');
  await page.waitForSelector('#drawer.open', { timeout: 5000 });
  await page.waitForTimeout(400);
}
async function drawerInfo(page) {
  return page.evaluate(async () => {
    const v = await import(new URL('js/voice.js', location.href));
    const sel = document.querySelector('#dVoiceSel');
    return { state: v.voiceState(), chosen: v.chosenVoice()?.name || null, auto: sel ? sel.options[0].textContent : null, opts: sel ? [...sel.options].slice(1).map(o => o.textContent) : [],
      note: document.querySelector('#dVoiceNote')?.innerText || null, test: !!document.querySelector('#dVoiceTest'), testDisabled: !!document.querySelector('#dVoiceTest[disabled]'),
      dial: !!document.querySelector('#dVoiceDial'), dir: document.documentElement.dir };
  });
}
async function scrollToVoice(page) {
  await page.evaluate(() => { const el = document.querySelector('#dVoiceNote') || document.querySelector('#dVoiceTest') || document.querySelector('[data-a="voice"]'); el?.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(250);
}

// ---------- synthetic route (Damascus) ----------
function mkRoute(segs, names = ['Al-Thawra Street', 'شارع بغداد']) {
  const lon0 = 36.2765, lat0 = 33.5138, mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110950;
  let x = 0, y = 0; const coords = [[lon0, lat0]], pts = [[lon0, lat0]];
  for (const [dx, dy] of segs) { const len = Math.hypot(dx, dy), n = Math.ceil(len / 10); for (let i = 1; i <= n; i++) coords.push([lon0 + (x + dx * i / n) / mx, lat0 + (y + dy * i / n) / my]); x += dx; y += dy; pts.push([lon0 + x / mx, lat0 + y / my]); }
  const L = segs.map(([a, b]) => Math.hypot(a, b)), total = L.reduce((a, b) => a + b, 0);
  const steps = [
    { type: 'depart', modifier: 'straight', name: names[0], ref: '', distance: L[0], duration: L[0] / 10, loc: pts[0], bearing_after: 90, leg: 0, last: false },
    { type: 'turn', modifier: 'left', name: names[1], ref: '', distance: L[1], duration: L[1] / 10, loc: pts[1], bearing_after: 0, leg: 0, last: false },
    { type: 'roundabout', modifier: 'right', exit: 2, name: '', ref: '', distance: L[2], duration: L[2] / 10, loc: pts[2], bearing_after: 90, leg: 0, last: false },
    { type: 'arrive', modifier: 'right', name: '', ref: '', distance: 0, duration: 0, loc: pts[3], bearing_after: 0, leg: 0, last: true },
  ];
  const sa = [0]; L.forEach(l => sa.push(sa.at(-1) + l));
  return { coords, steps, distance: total, duration: total / 10, legs: [{}], _sa: sa, _pts: pts };
}
const dist = (a, b) => { const R = 6371000, r = Math.PI / 180, dl = (b[1] - a[1]) * r, dn = (b[0] - a[0]) * r; const h = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

// position → metres along the synthetic route (nearest vertex, 10 m resolution)
function alongOf(route, p) { let best = 1e9, a = 0, cum = 0; for (let i = 0; i < route.coords.length; i++) { if (i) cum += dist(route.coords[i - 1], route.coords[i]); const d = dist(p, route.coords[i]); if (d < best) { best = d; a = cum; } } return a; }
async function navRun(browser, { prof, lang, mode, base = ROOT, settings = null, tag, segs = null, click = false }) {
  const ctx = await ctxFor(browser, prof, { lang, settings });
  const page = await ctx.newPage(); watch(page, tag);
  await load(page, base);
  if (click) { await page.mouse.click(200, 400); await page.waitForTimeout(300); } // a tap (would unlock iOS speech)
  const route = mkRoute(segs || (mode === 'car' ? [[800, 0], [0, 700], [600, 0]] : [[120, 0], [0, 80], [60, 0]]));
  const rt = JSON.parse(JSON.stringify(route)); delete rt._sa; delete rt._pts;
  await page.evaluate(async ({ rt, mode }) => {
    const m = await import(new URL('js/route.js', location.href));
    m.routeState.routes = [rt]; m.routeState.sel = 0; m.routeState.mode = mode; m.startNav(true);
  }, { rt, mode });
  const total = route.distance / (mode === 'car' ? 44 : 4.8);
  await page.waitForFunction(() => document.querySelector('#navHud') && (window.__ended || []).some(s => /destination|Ziel|وجهت|وصل/i.test(s) && !/^In |بعد|Follow|Dem|تابع|كمّل|, then |, dann |، ثم |، وبعدين /.test(s)), null, { timeout: (total * 2 + 30) * 1000 }).catch(() => {}); // generous: CI runners are slower than real time
  await page.waitForFunction(() => !speechSynthesis.speaking && !speechSynthesis.pending, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const log = await page.evaluate(() => ({ spoken: window.__spoken.filter(s => s.vol !== 0 && s.text.trim()), all: window.__spoken.length, cancels: window.__cancels, overlap: window.__overlap, ended: window.__ended }));
  const out = log.spoken.map(s => {
    const a = s.me ? alongOf(route, s.me) : null;
    const ahead = a == null ? null : route._sa.slice(1).map(x => x - a).filter(x => x > -8);
    return { text: s.text, voice: s.voice, lang: s.lang, dToTurn: ahead && ahead.length ? Math.round(Math.min(...ahead)) : null, dEnd: a == null ? null : Math.round(route.distance - a) };
  });
  await page.evaluate(async () => { const m = await import(new URL('js/route.js', location.href)); m.stopNav?.(); }).catch(() => {});
  await ctx.close();
  return { tag, out, cancels: log.cancels, overlap: log.overlap, ended: log.ended, all: log.all, mode };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const servers = [await serve(PORT, '/'), await serve(PORT ? PORT + 1 : 0, '/sub/khareeta/')];
  ROOT = `http://127.0.0.1:${servers[0].address().port}/`; SUB = `http://127.0.0.1:${servers[1].address().port}/sub/khareeta/`;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required'] });
  // 1) voice selection, notes, test announcement: every profile × language
  for (const prof of Object.keys(P)) for (const lang of ['en', 'de', 'ar']) {
    const ctx = await ctxFor(browser, prof, { lang }); const page = await ctx.newPage(); const tag = `${prof}/${lang}`; watch(page, tag);
    await load(page, ROOT); await openDrawer(page);
    const d = await drawerInfo(page);
    const exp = P[prof].exp[lang], st = P[prof].st[lang];
    ok(`select ${tag}: state=${st}`, d.state === st, d.state);
    ok(`select ${tag}: voice=${exp}`, d.chosen === exp, String(d.chosen));
    ok(`select ${tag}: no cloud voices in list`, !d.opts.some(o => /Online|network|^Google (Deutsch|US|UK|العربية)/.test(o)), d.opts.join(' | '));
    if (st === 'ok') {
      ok(`select ${tag}: no note`, !d.note || prof === 'android', d.note || '');
      await page.click('#dVoiceTest');
      const last = await page.evaluate(() => window.__spoken.filter(s => s.vol !== 0).pop());
      ok(`test-btn ${tag}: speaks with chosen voice`, last && last.voice === exp && last.text.length > 5, last ? `${last.voice} · ${last.lang} · "${last.text}"` : 'nothing');
      if (lang === 'ar') ok(`select ${tag}: dialect control`, d.dial);
    } else {
      ok(`note ${tag}: friendly note shown`, !!d.note, (d.note || '').replace(/\n/g, ' ⏎ ').slice(0, 160));
      if (st === 'unsupported') ok(`note ${tag}: own "no voice output in this browser" hint, no test button`, !d.test && ({ en: /doesn’t support voice output/, de: /unterstützt keine Sprachausgabe/, ar: /لا يدعم إخراج الصوت/ })[lang].test(d.note || ''), (d.note || '').slice(0, 80));
      else if (st === 'online') ok(`note ${tag}: test button disabled`, d.testDisabled);
      else ok(`note ${tag}: test button enabled (system-voice fallback by language tag)`, d.test && !d.testDisabled);
      if (st === 'unknown') ok(`note ${tag}: explains the system-voice fallback`, /system|System|النظام/.test(d.note || ''));
    }
    if (prof === 'ios') { await scrollToVoice(page); await page.screenshot({ path: `${SHOTS}settings-${lang}-ios-390x844.png` }); }
    if (prof === 'noAr' && lang === 'ar') { await scrollToVoice(page); await page.screenshot({ path: `${SHOTS}novoice-ar-390x844.png` }); }
    if (prof === 'noAr' && lang === 'en') {
      // EN UI but AR voice missing is not an issue → switch app language to AR via settings and check the speak toast
    }
    if (prof === 'online' && lang === 'de') { await scrollToVoice(page); await page.screenshot({ path: `${SHOTS}novoice-online-de-390x844.png` }); }
    if (prof === 'online' && lang === 'en') { await scrollToVoice(page); await page.screenshot({ path: `${SHOTS}novoice-online-en-390x844.png` }); }
    if (prof === 'empty' && lang === 'en') { await scrollToVoice(page); await page.screenshot({ path: `${SHOTS}novoice-unknown-en-390x844.png` }); }
    if (prof === 'noTts') { await scrollToVoice(page); await page.screenshot({ path: `${SHOTS}no-tts-${lang}-390x844.png` }); }
    if (prof === 'android' && lang === 'de') { await scrollToVoice(page); await page.screenshot({ path: `${SHOTS}settings-de-android-390x844.png` }); }
    await ctx.close();
  }
  // 2) no-voice toast when navigation speaks without an AR voice (once)
  {
    const ctx = await ctxFor(browser, 'noAr', { lang: 'ar' }); const page = await ctx.newPage(); watch(page, 'toast'); await load(page, ROOT);
    const r = await page.evaluate(async () => { const v = await import(new URL('js/voice.js', location.href)); const a = v.speak('اختبار'); const b = v.speak('اختبار ٢'); await new Promise(r => setTimeout(r, 100)); return { a, b, toast: document.querySelector('.toast, #toast')?.textContent || '', spoken: window.__spoken.filter(s => s.vol !== 0).length }; });
    const last = await page.evaluate(() => window.__spoken.filter(s => s.vol !== 0).pop());
    ok('no-AR voice: fallback speaks with lang tag ar-SA (no wrong-language voice object) + toast', r.a === true && r.spoken >= 1 && last && last.lang === 'ar-SA' && !last.voice && /صوت|العربية/.test(r.toast), JSON.stringify({ ...r, last }));
    await ctx.close();
  }
  // 3) viewports / dark / subpath screenshots
  for (const [prof, lang, vp, dark, base, name] of [
    ['ios', 'en', { width: 1440, height: 900 }, false, ROOT, 'settings-en-1440x900.png'],
    ['ios', 'ar', { width: 393, height: 852 }, false, ROOT, 'settings-ar-393x852.png'],
    ['win', 'de', { width: 393, height: 852 }, true, ROOT, 'settings-de-dark-393x852.png'],
    ['noAr', 'ar', { width: 390, height: 844 }, true, ROOT, 'novoice-ar-dark-390x844.png'],
    ['ios', 'de', { width: 390, height: 844 }, false, SUB, 'subpath-settings-de-390x844.png'],
    ['win', 'ar', { width: 1440, height: 900 }, true, SUB, 'subpath-settings-ar-dark-1440x900.png'],
  ]) {
    const ctx = await ctxFor(browser, prof, { lang, vp, dark, settings: dark ? { dark: true } : null }); const page = await ctx.newPage(); const tag = name; watch(page, tag);
    await load(page, base); await openDrawer(page); const d = await drawerInfo(page);
    const overflow = await page.evaluate(() => { const dr = document.querySelector('#drawer'); return [...dr.querySelectorAll('.ditem, .vnote, #dVoiceSel')].filter(e => e.scrollWidth > e.clientWidth + 1 && e.tagName !== 'SELECT').map(e => e.id || e.className); });
    ok(`layout ${name}: voice rows render, chosen=${d.chosen}, no overflow`, (d.chosen || d.note) && overflow.length === 0, overflow.join(','));
    await scrollToVoice(page); await page.screenshot({ path: SHOTS + name }); await ctx.close();
  }
  // 4) persistence: switch, voice pick, dialect
  {
    const ctx = await ctxFor(browser, 'ios', { lang: 'ar' }); const page = await ctx.newPage(); watch(page, 'persist'); await load(page, SUB); await openDrawer(page);
    await page.selectOption('#dVoiceSel', 'Majed'); await page.waitForTimeout(200);
    await page.click('#dVoiceDial [data-v="syr"]'); await page.waitForTimeout(200);
    await page.click('[data-a="voice"]'); await page.waitForTimeout(200);
    const rowsGone = await page.evaluate(() => !document.querySelector('#dVoiceSel'));
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => document.querySelector('#btnMenu svg')); await page.waitForTimeout(1200);
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('kh.settings') || '{}'));
    ok('persist: switch off survives reload, rows hidden', st.voice === false && rowsGone, JSON.stringify({ voice: st.voice, voicePick: st.voicePick, voiceDialect: st.voiceDialect }));
    const silent = await page.evaluate(async () => { const rt = await import(new URL('js/voice.js', location.href)); return rt.speak('x'); });
    ok('persist: switch off → navigation speech silent', silent === false);
    await openDrawer(page); await page.click('[data-a="voice"]'); await page.waitForTimeout(300);
    const d = await page.evaluate(() => ({ sel: document.querySelector('#dVoiceSel')?.value, dial: document.querySelector('#dVoiceDial [aria-checked="true"]')?.dataset.v }));
    ok('persist: voice pick + dialect survive reload', d.sel === 'Majed' && d.dial === 'syr', JSON.stringify(d));
    await page.click('#dVoiceTest'); const last = await page.evaluate(() => window.__spoken.filter(s => s.vol !== 0).pop());
    ok('persist: Syrian variant used when chosen', last && /لفّ|هلّق|بعد/.test(last.text) && last.voice === 'Majed', last && last.text);
    await ctx.close();
  }
  // 5) offline (service worker precache incl. js/voice.js)
  for (const base of [ROOT, SUB]) {
    const ctx = await ctxFor(browser, 'win', { lang: 'de' }); const page = await ctx.newPage(); const tag = 'offline ' + base; watch(page, tag);
    await load(page, base);
    await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(2500);
    const cached = await page.evaluate(async () => { const ks = await caches.keys(); for (const k of ks) { const c = await caches.open(k); if (await c.match(new URL('js/voice.js', location.href).href)) return k; } return null; });
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => document.querySelector('#btnMenu svg'), null, { timeout: 15000 });
    await page.waitForTimeout(1000); await openDrawer(page); const d = await drawerInfo(page);
    await page.click('#dVoiceTest'); const last = await page.evaluate(() => window.__spoken.filter(s => s.vol !== 0).pop());
    ok(`offline ${base}: voice.js precached (${cached}), settings + test announcement work`, cached && d.chosen && last && last.voice === d.chosen, last && last.text);
    if (base === ROOT) await page.screenshot({ path: SHOTS + 'offline-settings-de-390x844.png' });
    await ctx.close();
  }
  // 6) simulated navigation (mock speaks ≈ 70 ms per character; a running prompt must never be cut)
  const NOW = /^(Now|Jetzt|الآن|هلّق)/, PRE = /^(In |بعد)/, START = /^(Follow the road|Dem Straßenverlauf folgen|تابع السير على الطريق|كمّل عالطريق)/;
  const runs = await Promise.all([
    navRun(browser, { prof: 'win', lang: 'en', mode: 'car', tag: 'nav car EN (root)' }),
    navRun(browser, { prof: 'win', lang: 'de', mode: 'car', base: SUB, tag: 'nav car DE (subpath)' }),
    navRun(browser, { prof: 'win', lang: 'ar', mode: 'car', tag: 'nav car AR (Naayf ar-SA → MSA)' }),
    navRun(browser, { prof: 'ios', lang: 'ar', mode: 'car', settings: { voiceDialect: 'syr' }, tag: 'nav car AR (Syrian forced)' }),
    navRun(browser, { prof: 'android', lang: 'en', mode: 'foot', tag: 'nav foot EN (Android)' }),
    navRun(browser, { prof: 'ios', lang: 'de', mode: 'foot', base: SUB, tag: 'nav foot DE (subpath)' }),
  ]);
  const show = r => { console.log('\n## ' + r.tag); r.out.forEach(o => console.log(`  [${o.dToTurn ?? '-'} m · end ${o.dEnd ?? '-'} m] ${o.text}   (${o.voice} / ${o.lang})`)); if (r.cancels.length) console.log('  cancels: ' + JSON.stringify(r.cancels)); };
  const common = r => {
    const texts = r.out.map(o => o.text);
    ok(`${r.tag}: no duplicate prompts`, new Set(texts).size === texts.length);
    ok(`${r.tag}: nothing cut off (0 cancels while speaking, 0 overlapping speak calls)`, !r.cancels.some(c => c.cut || c.dropped.length) && r.overlap.length === 0, JSON.stringify({ cancels: r.cancels, overlap: r.overlap }));
    ok(`${r.tag}: every prompt spoken to the end`, texts.every(x => r.ended.includes(x)), texts.filter(x => !r.ended.includes(x)).join(' | '));
  };
  for (const r of runs) {
    show(r); common(r);
    const car = r.mode === 'car';
    const pre = r.out.filter(o => PRE.test(o.text)), now = r.out.filter(o => NOW.test(o.text));
    ok(`${r.tag}: exactly one start prompt, first, in the spoken variant (no displayed depart text)`, r.out.length > 1 && START.test(r.out[0].text) && r.out.filter(o => START.test(o.text)).length === 1 && !r.out.some(o => /^(Head|Auf|Fahre|Geh|اتجه|توجه|سر|امش)/i.test(o.text)) && (!/Syrian/.test(r.tag) || /^كمّل عالطريق/.test(r.out[0].text)) && (!/MSA/.test(r.tag) || /^تابع السير على الطريق/.test(r.out[0].text)), r.out[0]?.text);
    ok(`${r.tag}: 3 early prompts (turn, roundabout, arrival) + 2 "now"`, pre.length === 3 && now.length === 2, `pre=${pre.length} now=${now.length} total=${r.out.length}`);
    const turnPre = pre.slice(0, 2), arrPre = pre[2];
    ok(`${r.tag}: early prompt distance ${car ? '≈300 m (250–345)' : '≈30 m (18–40)'}`, turnPre.every(o => car ? o.dToTurn >= 250 && o.dToTurn <= 345 : o.dToTurn >= 18 && o.dToTurn <= 40), turnPre.map(o => o.dToTurn).join(','));
    ok(`${r.tag}: arrival early prompt ${car ? '≈300 m' : '≈60 m (40–62)'} before the end`, arrPre && (car ? arrPre.dEnd >= 250 && arrPre.dEnd <= 345 : arrPre.dEnd >= 40 && arrPre.dEnd <= 62), arrPre && String(arrPre.dEnd));
    ok(`${r.tag}: "now" ${car ? '≤ 60 m' : '≤ 13 m'} before the maneuver`, now.every(o => o.dToTurn <= (car ? 60 : 13)), now.map(o => o.dToTurn).join(','));
    ok(`${r.tag}: starts with the start prompt, ends with arrival`, r.out.length >= 6 && START.test(r.out[0].text) && /destination|Ziel|وجهت/.test(r.out.at(-1).text) && !PRE.test(r.out.at(-1).text), `${r.out[0]?.text} … ${r.out.at(-1)?.text}`);
  }
  // 7) short consecutive maneuvers → one combined prompt ("…, then …"), still nothing cut
  const chains = await Promise.all([
    navRun(browser, { prof: 'win', lang: 'en', mode: 'car', segs: [[800, 0], [0, 100], [600, 0]], tag: 'chain car EN (turn → roundabout 100 m)' }),
    navRun(browser, { prof: 'ios', lang: 'ar', mode: 'car', segs: [[800, 0], [0, 100], [600, 0]], settings: { voiceDialect: 'syr' }, tag: 'chain car AR Syrian' }),
    navRun(browser, { prof: 'win', lang: 'ar', mode: 'car', segs: [[800, 0], [0, 100], [600, 0]], tag: 'chain car AR MSA' }),
    navRun(browser, { prof: 'ios', lang: 'de', mode: 'foot', segs: [[120, 0], [0, 25], [80, 0]], tag: 'chain foot DE (turn → roundabout 25 m)' }),
    navRun(browser, { prof: 'android', lang: 'en', mode: 'foot', segs: [[120, 0], [0, 80], [30, 0]], tag: 'chain foot EN (roundabout → arrival 30 m)' }),
    navRun(browser, { prof: 'win', lang: 'en', mode: 'car', segs: [[800, 0], [0, 145], [600, 0]], tag: 'chain car EN wide (turn → roundabout 145 m)' }),
  ]);
  const THEN = { en: /, then /, de: /, dann /, ar: /، (وبعدين|ثم) / };
  for (const r of chains) {
    show(r); common(r);
    const lang = /AR/.test(r.tag) ? 'ar' : /DE/.test(r.tag) ? 'de' : 'en';
    const chained = r.out.filter(o => THEN[lang].test(o.text));
    ok(`${r.tag}: combined "then" prompt`, chained.length >= 1, chained.map(o => o.text).join(' | '));
    if (/arrival/.test(r.tag)) ok(`${r.tag}: no separate early arrival prompt`, !r.out.some(o => PRE.test(o.text) && /destination/.test(o.text) && !THEN.en.test(o.text)));
    else ok(`${r.tag}: second maneuver gets no separate early prompt`, r.out.filter(o => PRE.test(o.text) && /roundabout|Kreisverkehr|الدوّار|الدوار/.test(o.text) && !THEN[lang].test(o.text)).length === 0);
    const sepNow = r.out.filter(o => NOW.test(o.text) && /roundabout|Kreisverkehr|الدوّار|الدوار/.test(o.text) && !THEN[lang].test(o.text));
    if (/wide/.test(r.tag)) ok(`${r.tag}: second maneuver far enough → own "now" after the combined one`, sepNow.length === 1, sepNow.map(o => o.text).join(' | '));
    else if (!/arrival/.test(r.tag)) ok(`${r.tag}: no separate "now" for the close chained maneuver`, sepNow.length === 0, sepNow.map(o => o.text).join(' | '));
    if (/Syrian/.test(r.tag)) ok(`${r.tag}: Syrian forms (هلّق / وبعدين / المفرق)`, r.out.some(o => /^هلّق/.test(o.text)) && r.out.some(o => /وبعدين/.test(o.text)) && r.out.some(o => /المفرق/.test(o.text)), '');
  }
  // 8) empty voice list (iOS PWA): fallback by language tag
  {
    const r = await navRun(browser, { prof: 'empty', lang: 'en', mode: 'foot', click: true, tag: 'empty voice list' });
    // iOS PWAs often list no voices → fall back to the language tag (engine picks its system voice), never silent
    ok('empty voice list: prompts still spoken with lang tag en-GB, no voice object', r.all > 0 && r.out.length > 0 && r.out.every(o => o.lang === 'en-GB' && !o.voice), `speak calls=${r.all} ${JSON.stringify(r.out.slice(0, 2))}`);
    const r2 = await navRun(browser, { prof: 'empty', lang: 'ar', mode: 'car', click: true, segs: [[400, 0], [0, 100], [100, 0]], tag: 'empty voice list AR' });
    ok('empty voice list AR: prompts spoken with lang tag ar-SA', r2.all > 0 && r2.out.length > 0 && r2.out.every(o => o.lang === 'ar-SA' && !o.voice), `speak calls=${r2.all}`);
  }
  // 9) recalculation (real GPS path via geolocation + mocked OSRM): "recalculating" once, next maneuver not announced twice
  for (const lang of ['en', 'ar']) {
    const tag = 'reroute ' + lang;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: P.win.ua, locale: 'en-US', permissions: ['geolocation'], geolocation: { latitude: 33.5138, longitude: 36.2765, accuracy: 5 } });
    await ctx.addInitScript(mock(P.win));
    await ctx.addInitScript(`try { if (!sessionStorage.__init) { sessionStorage.__init = 1; localStorage.setItem('kh.lang', ${JSON.stringify(lang)}); localStorage.setItem('kh.onboarded','1'); } } catch {}`);
    const route = mkRoute([[800, 0], [0, 700], [600, 0]]);
    const lon0 = 36.2765, lat0 = 33.5138, mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110950, P2 = (x, y) => [lon0 + x / mx, lat0 + y / my];
    let osrmCalls = 0;
    await ctx.route('**/routing.openstreetmap.de/**', async rq => {
      osrmCalls++;
      const u = new URL(rq.request().url()); const c = u.pathname.split('/').pop().split(';')[0].split(',').map(Number);
      const pts = [c, P2(560, 0), P2(800, 0), P2(800, 700), P2(1400, 700)];
      const coords = [c]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(dist(a, b) / 10)); for (let k = 1; k <= n; k++) coords.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
      const st = (type, modifier, loc, name, d, extra = {}) => ({ maneuver: { type, modifier, location: loc, bearing_after: 0, ...extra }, name, ref: '', distance: d, duration: d / 14, mode: 'driving', intersections: [{}] });
      const body = { code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: coords }, distance: 2000, duration: 150, legs: [{ steps: [
        st('depart', 'left', c, 'Side Street', 300), st('turn', 'left', route.steps[1].loc, 'شارع بغداد', 700), st('roundabout', 'right', route.steps[2].loc, '', 600, { exit: 2 }), st('arrive', 'right', route.steps[3].loc, '', 0)] }] }] };
      await rq.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await ctx.newPage(); watch(page, tag); await load(page, ROOT);
    await page.evaluate(async ({ rt }) => { const m = await import(new URL('js/route.js', location.href)); m.routeState.routes = [rt]; m.routeState.sel = 0; m.routeState.mode = 'car';
      m.routeState.stops = [{ lon: rt.coords[0][0], lat: rt.coords[0][1], name: 'A' }, { lon: rt.coords.at(-1)[0], lat: rt.coords.at(-1)[1], name: 'B' }]; m.startNav(false); }, { rt: (() => { const x = JSON.parse(JSON.stringify(route)); delete x._sa; delete x._pts; return x; })() });
    const go = async (x, y, ms = 700) => { const [lo, la] = P2(x, y); await ctx.setGeolocation({ latitude: la, longitude: lo, accuracy: 5 }); await page.waitForTimeout(ms); };
    for (let x = 0; x <= 540; x += 60) await go(x, 0);         // drive: early prompt for the left turn at ≈300 m
    for (const y of [-60, -80, -90, -95]) await go(560, y, 900); // off route > 40 m ×3 → recalculation
    await page.waitForTimeout(1500);
    for (let x = 560; x <= 800; x += 20) await go(x, 0, 600);   // back on the (new) route up to the turn
    for (let y = 20; y <= 120; y += 20) await go(800, y, 500);
    await page.waitForTimeout(3000);
    const log = await page.evaluate(() => ({ spoken: window.__spoken.filter(s => s.vol !== 0 && s.text.trim()).map(s => s.text), cancels: window.__cancels }));
    console.log('\n## ' + tag); log.spoken.forEach(x => console.log('  ' + x)); console.log('  cancels: ' + JSON.stringify(log.cancels) + '  osrm calls: ' + osrmCalls);
    const RR = lang === 'en' ? /^Recalculating/ : /إعادة حساب المسار/;
    const turnTexts = log.spoken.filter(x => !START.test(x)).filter(x => lang === 'en' ? /turn left/i.test(x) : /اليسار|يسار/.test(x) && !/^(اتجه|توجه)/.test(x));
    ok(`${tag}: recalculation happened, "recalculating" spoken once`, osrmCalls >= 1 && log.spoken.filter(x => RR.test(x)).length === 1, `osrm=${osrmCalls}`);
    ok(`${tag}: left turn: start prompt aside, once early + once "now" (no repeat after recalculation)`, turnTexts.filter(x => PRE.test(x)).length === 1 && turnTexts.filter(x => NOW.test(x)).length === 1 && turnTexts.length === 2, turnTexts.join(' | '));
    ok(`${tag}: no duplicate prompts at all`, new Set(log.spoken).size === log.spoken.length);
    ok(`${tag}: only the recalculation interrupts`, log.cancels.filter(c => c.cut).length <= 1, JSON.stringify(log.cancels));
    // stopNav → stopSpeaking: queue cleared, running prompt stopped
    const st = await page.evaluate(async () => { const v = await import(new URL('js/voice.js', location.href)); v.speak('Long test prompt number one for the queue.'); v.speak('Second queued prompt.');
      const m = await import(new URL('js/route.js', location.href)); m.stopNav(); await new Promise(r => setTimeout(r, 300)); return { speaking: speechSynthesis.speaking, last: window.__cancels.at(-1), again: v.speak('Long test prompt number one for the queue.') }; });
    ok(`${tag}: stopNav stops the running prompt, drops the queue, resets repeat guard`, !st.speaking && st.last && st.last.cut && st.again === true, JSON.stringify(st));
    await ctx.close();
  }
  // 10) voice switched off (drawer + HUD) → running prompt stops
  {
    const ctx = await ctxFor(browser, 'win', { lang: 'de' }); const page = await ctx.newPage(); watch(page, 'toggle'); await load(page, ROOT);
    await page.evaluate(async () => { const v = await import(new URL('js/voice.js', location.href)); v.speak('Eine ziemlich lange Testansage, die gerade läuft.'); v.speak('Noch eine.'); });
    await openDrawer(page); await page.click('[data-a="voice"]'); await page.waitForTimeout(200);
    const a = await page.evaluate(() => ({ speaking: speechSynthesis.speaking, c: window.__cancels.at(-1), n: window.__spoken.length }));
    await page.waitForTimeout(1500); const n2 = await page.evaluate(() => window.__spoken.length);
    ok('toggle off in settings: running prompt stopped, queued one not spoken', !a.speaking && a.c && a.c.cut && n2 === a.n, JSON.stringify({ ...a, n2 }));
    await page.click('[data-a="voice"]'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const route = mkRoute([[800, 0], [0, 700], [600, 0]]); delete route._sa; delete route._pts;
    await page.evaluate(async ({ route }) => { const m = await import(new URL('js/route.js', location.href)); m.routeState.routes = [route]; m.routeState.sel = 0; m.routeState.mode = 'car'; m.startNav(true); }, { route });
    await page.waitForFunction(() => speechSynthesis.speaking && speechSynthesis._cur && speechSynthesis._cur.volume !== 0, null, { timeout: 5000 }).catch(() => {}); await page.evaluate(() => document.querySelector('#navVoice').click()); await page.waitForTimeout(200);
    const h = await page.evaluate(() => ({ speaking: speechSynthesis.speaking, c: window.__cancels.at(-1), n: window.__spoken.length }));
    await page.waitForTimeout(6000); const h2 = await page.evaluate(() => window.__spoken.length);
    ok('toggle off in nav HUD: start prompt stopped, nothing spoken afterwards', !h.speaking && h.c && h.c.cut && h2 === h.n, JSON.stringify({ ...h, h2 }));
    await ctx.close();
  }
  // 10b) HUD toggle keeps the per-route memory (no repeats after off/on + recalculation); only nav stop resets it
  {
    const ctx = await ctxFor(browser, 'win', { lang: 'en' }); const page = await ctx.newPage(); watch(page, 'said'); await load(page, ROOT);
    const route = mkRoute([[800, 0], [0, 700], [600, 0]]); delete route._sa; delete route._pts;
    const r = await page.evaluate(async ({ route }) => {
      const m = await import(new URL('js/route.js', location.href)), v = await import(new URL('js/voice.js', location.href));
      m.routeState.routes = [route]; m.routeState.sel = 0; m.routeState.mode = 'car'; m.startNav(true);
      const wait = ms => new Promise(r => setTimeout(r, ms));
      await wait(1500);
      const probe = { ...route, steps: route.steps.map(s => ({ ...s })), _stepAlong: [0, 800, 1500, 2100] };
      probe.steps[1] = { ...probe.steps[1], loc: [36.3, 33.6], name: 'Probe Street' }; // a maneuver the sim never reaches
      const n = () => window.__spoken.filter(s => /Probe Street/.test(s.text)).length;
      v.navPrompt(probe, 1, 250, 'car', 14, null, {}); await wait(5000); const a = n();
      document.querySelector('#navVoice').click(); document.querySelector('#navVoice').click(); await wait(200);   // HUD off + on
      v.navPrompt(probe, 1, 250, 'car', 14, null, {}); await wait(5000); const b = n();                           // "recalculated" route
      m.stopNav(); v.navVoiceStart();                                                                             // stop, new navigation
      v.navPrompt({ ...probe, steps: probe.steps }, 1, 250, 'car', 14, null, { }); await wait(6000); const c = n();
      return { a, b, c };
    }, { route });
    ok('HUD voice off/on keeps "already announced" (no repeat); stop + new start resets it', r.a === 1 && r.b === 1 && r.c === 2, JSON.stringify(r));
    await ctx.close();
  }
  // 10c) language change: running/queued AR prompt is stopped, never played with the EN voice
  {
    const ctx = await ctxFor(browser, 'win', { lang: 'ar' }); const page = await ctx.newPage(); watch(page, 'lang'); await load(page, ROOT);
    await page.evaluate(async () => { const v = await import(new URL('js/voice.js', location.href)); v.speak('بعد مئتين وخمسين مترًا، انعطف يسارًا إلى شارع بغداد، ثم عند الدوار، خذ المخرج الثاني.'); v.speak('الآن، انعطف يسارًا إلى شارع بغداد.'); });
    await openDrawer(page); const n0 = await page.evaluate(() => window.__spoken.length);
    await page.click('#dLang [data-l="en"]'); await page.waitForTimeout(3000);
    const r = await page.evaluate(n0 => ({ speaking: speechSynthesis.speaking, after: window.__spoken.slice(n0).map(s => s.text), cut: window.__cancels.at(-1)?.cut || null, lang: document.documentElement.lang }), n0);
    ok('language change AR → EN: running prompt stopped, queued AR prompt dropped', !r.speaking && r.cut && !r.after.some(t => /[\u0600-\u06FF]/.test(t)), JSON.stringify(r));
    await ctx.close();
  }
  // 10d) a prompt that fails to start does not block the rest of the queue
  {
    const ctx = await ctxFor(browser, 'win', { lang: 'en' }); const page = await ctx.newPage(); watch(page, 'qfail'); await load(page, ROOT);
    const r = await page.evaluate(async () => { const v = await import(new URL('js/voice.js', location.href)); window.__throwOn = /BROKEN/;
      v.speak('First prompt is running now.'); v.speak('BROKEN prompt.'); v.speak('Third prompt still plays.');
      await new Promise(r => setTimeout(r, 6000)); return { ended: window.__ended.slice() }; });
    ok('queue: failing prompt skipped, next one still spoken', r.ended.includes('First prompt is running now.') && r.ended.includes('Third prompt still plays.'), JSON.stringify(r));
    await ctx.close();
  }
  // 11) texts: >10 km whole km + MSA agreement, no brackets/refs, Syrian merge/ramp/waypoint, toast wording
  {
    const ctx = await ctxFor(browser, 'ios', { lang: 'ar' }); const page = await ctx.newPage(); watch(page, 'texts'); await load(page, ROOT);
    const r = await page.evaluate(async () => {
      const v = await import(new URL('js/voice.js', location.href)), u = await import(new URL('js/util.js', location.href)), i = await import(new URL('js/i18n.js', location.href)), rt = await import(new URL('js/route.js', location.href));
      const set = d => { u.settings.voiceDialect = d; };
      const out = {};
      set('msa'); out.msa = [12300, 10600, 25000, 100400, 13000, 3000, 9600].map(m => v.spokenDist(m));
      out.msaTurn = v.announce({ type: 'continue', modifier: 'straight', name: '', ref: '' }, 'pre', 300);
      out.msaSlight = v.announce({ type: 'turn', modifier: 'slight right', name: '' }, 'now', 30);
      set('syr'); out.syr = [12300, 25000].map(m => v.spokenDist(m));
      out.syrMerge = v.announce({ type: 'merge', modifier: 'slight left', name: 'أوتوستراد المزة' }, 'pre', 300, rt.instr);
      out.syrRamp = v.announce({ type: 'on ramp', modifier: 'right', name: '' }, 'now', 30, rt.instr);
      out.syrOff = v.announce({ type: 'off ramp', modifier: 'right', name: 'درعا' }, 'pre', 500, rt.instr);
      out.syrWp = v.announce({ type: 'arrive', last: false, leg: 0, modifier: 'right' }, 'now', 5, rt.instr);
      out.syrRbt = v.announce({ type: 'roundabout', exit: 3, name: '' }, 'now', 30, rt.instr);
      out.syrSharp = v.announce({ type: 'turn', modifier: 'sharp left', name: '' }, 'now', 30, rt.instr);
      out.refAr = v.announce({ type: 'turn', modifier: 'right', name: 'طريق دمشق', ref: 'M5' }, 'pre', 300);
      out.brk = v.announce({ type: 'off ramp', modifier: 'right', name: '', destinations: 'Homs (M5)', ref: '' }, 'pre', 300, () => 'Take the exit towards Homs (M5)');
      i.setLang?.('en');
      return out;
    });
    console.log('\n## texts\n' + JSON.stringify(r, null, 1));
    ok('AR MSA: >10 km whole km with agreement (12 كيلومترًا, 11 كيلومترًا, 25 كيلومترًا, 100 كيلومتر, 13 كيلومترًا), ≤10 km words (3 km, 9.5 km)', r.msa[0] === '12 كيلومترًا' && r.msa[1] === '11 كيلومترًا' && r.msa[2] === '25 كيلومترًا' && r.msa[3] === '100 كيلومتر' && r.msa[4] === '13 كيلومترًا' && !/\d/.test(r.msa[5]) && !/\d/.test(r.msa[6]), r.msa.join(' | '));
    ok('AR MSA: new wording (تابع إلى الأمام / انحرف قليلًا إلى اليمين)', /تابع إلى الأمام/.test(r.msaTurn) && /انحرف قليلًا إلى اليمين/.test(r.msaSlight), r.msaTurn + ' | ' + r.msaSlight);
    ok('AR Syrian: whole km', r.syr[0] === '12 كيلو' && r.syr[1] === '25 كيلو', r.syr.join(' | '));
    ok('AR Syrian: merge/ramp/exit/waypoint own texts, roundabout المفرق, لفّة حادّة', /فوت على أوتوستراد المزة/.test(r.syrMerge) && /خود الطلعة/.test(r.syrRamp) && /اطلع عالمفرق باتجاه درعا/.test(r.syrOff) && /وصلت للمحطة 1/.test(r.syrWp) && /المفرق التالت|المفرق/.test(r.syrRbt) && /لفّة حادّة عاليسار/.test(r.syrSharp), [r.syrMerge, r.syrRamp, r.syrOff, r.syrWp, r.syrRbt, r.syrSharp].join(' | '));
    ok('no road number when a name exists, no brackets read aloud', !/M5/.test(r.refAr) && !/[()]/.test(r.brk), r.refAr + ' | ' + r.brk);
    // toast wording with an AR UI and no AR voice
    await ctx.close();
    const c2 = await ctxFor(browser, 'noAr', { lang: 'ar' }); const p2 = await c2.newPage(); watch(p2, 'toast2'); await load(p2, ROOT);
    const tt = await p2.evaluate(async () => { const v = await import(new URL('js/voice.js', location.href)); v.speak('x'); await new Promise(r => setTimeout(r, 100)); return document.querySelector('.toast, #toast')?.textContent || ''; });
    ok('toast: "بالعربية" (not "بـالعربية")', /بالعربية/.test(tt) && !/بـ/.test(tt), tt);
    await c2.close();
  }
  await browser.close(); servers.forEach(s => s.close());
  console.log('\n## console/page errors: ' + errors.length); errors.forEach(e => console.log('  ' + e));
  const f = results.filter(r => !r.pass); console.log(`\nSUMMARY ${results.length - f.length}/${results.length} passed`); f.forEach(x => console.log('  FAIL ' + x.name + ' — ' + x.info));
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors, runs }, null, 1));
  process.exit(f.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
