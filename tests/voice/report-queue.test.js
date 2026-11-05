// Khareeta – P3: the Khareeta report form says "will be sent shortly". Verify that the delayed Supabase POST really fires
// (mocked route – nothing reaches Supabase), that it survives closing the sheet and reloading the page (localStorage
// queue + flush on start), and that two tabs WITHOUT Web Locks send a due report only once (localStorage lock +
// BroadcastChannel dedupe). Chromium, all non-local requests mocked/aborted.  Run: node report-queue.test.js
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const PORT = +(process.env.RQ_PORT || 8787), ROOT = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((rq, rs) => {
  let f = path.join(REPO, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(REPO)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? '  — ' + i : '')); };
async function ctxWith(browser, { noLocks = false } = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript(`try { localStorage.setItem('kh.lang', 'de'); localStorage.setItem('kh.onboarded', '1'); localStorage.setItem('kh.trackDev', '1'); localStorage.setItem('kh.noTrack', '1'); } catch {}
    ${noLocks ? "try { Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true }); } catch {}" : ''}`);
  const posts = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => {
    const q = r.request(), u = q.url();
    if (/supabase\.co\/rest\/v1\/(rpc\/kh_report_insert|kh_events)/.test(u) && q.method() === 'POST') {
      let b = {}; try { b = JSON.parse(q.postData() || '{}'); } catch {}
      const ev = Array.isArray(b) ? b[0] : b.ev; if (ev && ev.install_id === 'anon') posts.push({ u, type: ev.type, rid: ev.props?.rid });
      return r.fulfill({ status: 204, body: '' });
    }
    return r.abort();
  });
  return { ctx, posts };
}
const ready = page => page.waitForFunction(() => document.querySelector('#btnMenu svg'), null, { timeout: 30000 });
// a report due in `ms` (REPORT_DELAY_MS lower bound shifted back, rand = 0)
const submit = (page, ms) => page.evaluate(async ms => {
  const a = await import(new URL('js/analytics.js', location.href));
  return a.submitReport('layer', { kind: 'wrong_place', text: 'QA test (mocked)' }, { now: Date.now() - a.REPORT_DELAY_MS[0] + ms, rand: () => 0 });
}, ms);
const queue = page => page.evaluate(() => JSON.parse(localStorage.getItem('kh.rq') || localStorage.getItem('kh.reports') || '[]').length);
(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  // 1) delayed POST fires (no reload), after the sheet was closed
  {
    const { ctx, posts } = await ctxWith(browser); const page = await ctx.newPage();
    await page.goto(ROOT); await ready(page);
    const r = await submit(page, 3000); ok('submit → queued', r.ok && r.queued, JSON.stringify(r));
    await page.evaluate(async () => (await import(new URL('js/core.js', location.href))).closeSheet());
    ok('no POST before the delay', posts.length === 0, String(posts.length));
    await page.waitForTimeout(6000);
    ok('delayed POST fired once', posts.length === 1 && posts[0].type === 'layer' && !!posts[0].rid, JSON.stringify(posts));
    const pend = await page.evaluate(async () => (await import(new URL('js/analytics.js', location.href)))._pendingReports().length);
    ok('queue empty after success', pend === 0, String(pend));
    await ctx.close();
  }
  // 2) survives a reload before the delay elapsed
  {
    const { ctx, posts } = await ctxWith(browser); const page = await ctx.newPage();
    await page.goto(ROOT); await ready(page);
    await submit(page, 4000);
    await page.reload(); await ready(page);
    ok('no POST right after reload (not yet due)', posts.length === 0, String(posts.length));
    await page.waitForTimeout(7000);
    ok('POST fired after reload', posts.length === 1, JSON.stringify(posts));
    await page.reload(); await ready(page); await page.waitForTimeout(3000);
    ok('not sent again after a second reload', posts.length === 1, String(posts.length));
    await ctx.close();
  }
  // 3) overdue report while the page was closed → sent on the next start
  {
    const { ctx, posts } = await ctxWith(browser); const page = await ctx.newPage();
    await page.goto(ROOT); await ready(page);
    await submit(page, 60e3); await page.goto('about:blank');
    // simulate the delay having elapsed while closed
    const p2 = await ctx.newPage(); await p2.goto(ROOT + 'css/app.css');
    await p2.evaluate(() => { const k = 'kh.rq'; const raw = localStorage.getItem(k); if (raw) localStorage.setItem(k, JSON.stringify(JSON.parse(raw).map(x => ({ ...x, due: Date.now() - 1000 })))); });
    await p2.goto(ROOT); await ready(p2); await p2.waitForTimeout(5000);
    ok('overdue report sent on next start', posts.length === 1, JSON.stringify(posts));
    await ctx.close();
  }
  // 4) two tabs, no Web Locks: one due report → exactly one POST
  for (let run = 0; run < 3; run++) {
    const { ctx, posts } = await ctxWith(browser, { noLocks: true });
    const a = await ctx.newPage(), b = await ctx.newPage();
    await a.goto(ROOT); await b.goto(ROOT); await ready(a); await ready(b);
    ok(`run ${run + 1}: Web Locks disabled`, await a.evaluate(() => !navigator.locks));
    await submit(a, 60e3);
    await a.evaluate(() => { const k = 'kh.rq'; localStorage.setItem(k, JSON.stringify(JSON.parse(localStorage.getItem(k)).map(x => ({ ...x, due: Date.now() - 1000 })))); });
    await Promise.all([a, b].map(p => p.evaluate(async () => (await import(new URL('js/analytics.js', location.href))).sendDueReports())));
    await a.waitForTimeout(1500);
    ok(`run ${run + 1}: two tabs without Web Locks → one POST`, posts.length === 1, JSON.stringify(posts.map(p => p.rid)));
    await ctx.close();
  }
  await browser.close(); srv.close();
  const fail = results.filter(x => !x).length; console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
