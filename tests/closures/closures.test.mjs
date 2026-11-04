// Road reports: payload privacy/shape, static file validation + expiry, route proximity, moderator export, i18n, SW.
// fetch is ALWAYS mocked – nothing reaches the production Supabase project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; };
globalThis.fetch = () => { throw new Error('network access in tests is forbidden'); };
Object.assign(globalThis, {
  localStorage: mem(), sessionStorage: mem(), location: { protocol: 'https:', hostname: 'khareeta.app', search: '', href: 'https://khareeta.app/' },
  screen: { width: 390, height: 844 }, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {},
  document: { referrer: '', visibilityState: 'visible', addEventListener() {}, documentElement: {} },
});
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'iPhone', language: 'en', languages: ['en'], maxTouchPoints: 5, onLine: true }, configurable: true });

const C = await import('../../js/closures-core.js');
const A = await import('../../js/analytics.js');
const RC = await import('../../js/report-core.js');
const root = new URL('../../', import.meta.url).pathname;
const NOW = Date.parse('2026-11-04T12:00:00Z');

test('payload: kinds, 4-decimal rounding, no identity, note clipped', () => {
  const r = C.buildClosureReport('closed', '  bridge\nblocked  ', 33.513456789, 36.276543210, 'Baghdad St');
  assert.equal(r.ok, true);
  assert.deepEqual(r.props, { k: 'closure', t: 'closed', la: 33.5135, lo: 36.2765, rd: 'Baghdad St', v: 'bridge blocked' });
  for (const k of C.CLOSURE_KINDS) assert.equal(C.buildClosureReport(k, '', 33.5, 36.3).ok, true);
  assert.equal(C.buildClosureReport('army', '', 33.5, 36.3).err, 'kind');
  assert.equal(C.buildClosureReport('', '', 33.5, 36.3).err, 'kind');
  assert.equal(C.buildClosureReport('delay', '', NaN, 36.3).err, 'pos');
  assert.equal(C.buildClosureReport('delay', '', 95, 36.3).err, 'pos');
  assert.equal(C.buildClosureReport('delay', 'x'.repeat(500), 33.5, 36.3).props.v.length, C.NOTE_MAX);
  assert.deepEqual(C.CLOSURE_KINDS, ['closed', 'delay', 'construction', 'flooding']);
});

test('send path: anonymous kh_events row, type layer, mocked fetch only', async () => {
  let sent = null;
  const fake = async (url, init) => { sent = { url, init }; return { ok: true, text: async () => '' }; };
  const p = C.buildClosureReport('flooding', 'water on road', 33.51, 36.29).props;
  const r = await A.sendNow('layer', p, { fetchImpl: fake });
  if (r.why === 'dev') return; // dev-host guard – still nothing sent
  assert.equal(r.ok, true);
  const [ev] = JSON.parse(sent.init.body);
  assert.match(sent.url, /\/rest\/v1\/kh_events$/);
  assert.equal(ev.install_id, 'anon'); assert.equal(ev.session_id, null); assert.equal(ev.country, null); assert.equal(ev.city, null);
  assert.equal(ev.lat_r, null); assert.equal(ev.type, 'layer'); assert.equal(ev.props.k, 'closure');
  assert.doesNotMatch(sent.init.headers.apikey, /service_role/);
  const failing = async () => ({ ok: false, status: 500, text: async () => '' });
  assert.equal((await A.sendNow('layer', p, { fetchImpl: failing })).ok, false); // no success toast on failure
});

test('client rate limit is shared with reports', () => {
  const st = mem();
  assert.equal(RC.rateCheck(NOW, st).ok, true); RC.rateNote(NOW, st);
  assert.equal(RC.rateCheck(NOW + 1000, st).why, 'gap');
});

test('static file: shipped file is valid and empty; expiry + validation', () => {
  const doc = JSON.parse(readFileSync(root + 'data/closures.json', 'utf8'));
  assert.equal(doc.schema, 1); assert.deepEqual(doc.closures, []);
  const e = (o) => ({ id: 'a', kind: 'closed', lat: 33.51234, lon: 36.29876, since: '2026-11-04T10:00:00Z', expires: '2026-11-05T10:00:00Z', ...o });
  const list = C.activeClosures({ closures: [e(), e({ id: 'old', expires: '2026-11-04T11:00:00Z' }), e({ id: 'bad', kind: 'army' }),
    e({ id: 'long', expires: '2026-12-30T00:00:00Z' }), e({ id: 'future', since: '2026-11-06T00:00:00Z', expires: '2026-11-07T00:00:00Z' }), e({ id: 'nolat', lat: 'x' })] }, NOW);
  assert.deepEqual(list.map(x => x.id), ['a']);
  assert.equal(list[0].lat, 33.5123); assert.equal(list[0].lon, 36.2988);
  assert.equal(C.activeClosures(null, NOW).length, 0);
  const g = C.toGeoJSON(list); assert.equal(g.features[0].geometry.coordinates[0], 36.2988);
});

test('route proximity: within ~50 m warns, farther does not', () => {
  const route = [[36.2900, 33.5100], [36.3000, 33.5100]];
  const mk = (lat, lon) => C.normEntry({ id: 'x' + lat, kind: 'delay', lat, lon, since: '2026-11-04T00:00:00Z', expires: '2026-11-05T00:00:00Z' });
  const near = mk(33.5103, 36.2950); // ~33 m north
  const far = mk(33.5110, 36.2950);  // ~111 m
  const off = mk(33.5100, 36.3100);  // beyond the end
  assert.ok(C.distToLine([near.lon, near.lat], route) < 50);
  assert.deepEqual(C.closuresNearRoute(route, [near, far, off]).map(x => x.id), [near.id]);
  assert.deepEqual(C.closuresNearRoute([], [near]), []);
  const n = C.nearestOnPolyline([36.295, 33.5103], route); assert.ok(Math.abs(n.pt[1] - 33.51) < 1e-9 && n.d < 40);
});

test('moderator export: only approved closure rows, neutral notes, merge + prune', () => {
  const rows = [{ id: 11, props: { k: 'closure', t: 'closed', la: 33.5, lo: 36.3, rd: 'Main' } }, { id: 12, props: { k: 'report', t: 'missing' } }, { id: 13, props: { k: 'closure', t: 'delay', la: 33.6, lo: 36.4, v: 'user text' } }];
  const add = C.rowsToEntries(rows, { 11: { hours: 24, note: 'Bridge repairs' }, 12: {} }, NOW);
  assert.equal(add.length, 1); assert.equal(add[0].id, 'r11'); assert.equal(add[0].note, 'Bridge repairs');
  assert.equal(Date.parse(add[0].expires) - NOW, 24 * 36e5);
  assert.equal(C.rowsToEntries(rows, { 13: { hours: 6 } }, NOW)[0].note, ''); // user notes never published
  assert.equal(Date.parse(C.rowsToEntries(rows, { 13: { hours: 336 } }, NOW)[0].expires) - NOW, C.MAX_DAYS * 864e5);
  assert.throws(() => C.rowsToEntries(rows, { 13: { hours: 9999 } }, NOW), C.ExportError);
  for (const h of [0, -3, 'x']) assert.throws(() => C.rowsToEntries(rows, { 11: { hours: h } }, NOW), /positive number/); // never silently 48 h
  assert.throws(() => C.rowsToEntries(rows, { 11: { note: 'army checkpoint' } }, NOW), C.ExportError);
  assert.throws(() => C.rowsToEntries(rows, { 11: { note: 'call 0933 123 456' } }, NOW), /personal data/);
  const old = { closures: [{ id: 'gone', kind: 'closed', lat: 1, lon: 1, since: '2026-11-01T00:00:00Z', expires: '2026-11-02T00:00:00Z' }] };
  const res = C.mergeFile(old, add, NOW);
  assert.deepEqual(res.closures.map(x => x.id), ['r11']); assert.equal(res.schema, 1);
});

test('moderator CLI writes a valid file (temp dir, no network)', () => {
  const d = mkdtempSync(join(tmpdir(), 'cl-'));
  writeFileSync(join(d, 'r.json'), JSON.stringify([{ id: 5, props: { k: 'closure', t: 'construction', la: 33.51, lo: 36.28 } }]));
  writeFileSync(join(d, 'a.json'), JSON.stringify({ 5: { hours: 12 } }));
  const out = join(d, 'closures.json');
  execFileSync('node', [root + 'scripts/closures/export-approved.mjs', '--reports', join(d, 'r.json'), '--approve', join(d, 'a.json'), '--out', out, '--now', '2026-11-04T12:00:00Z']);
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(doc.closures.length, 1); assert.equal(doc.closures[0].kind, 'construction');
  assert.equal(C.activeClosures(doc, NOW + 11 * 36e5).length, 1); assert.equal(C.activeClosures(doc, NOW + 13 * 36e5).length, 0);
});

test('i18n: EN/AR/DE strings exist and use neutral wording', async () => {
  const I = await import('../../js/i18n.js');
  const keys = ['clOpen', 'clTitle', 'clKind', 'clNote', 'clPosHint', 'clModerated', 'clE_kind', 'clSince', 'clUntil', 'clDisclaimer', 'clReportHere', 'clRW_one', 'clRW_other', 'clE_noroad', 'clE_pii', ...C.CLOSURE_KINDS.map(k => 'clK_' + k)];
  for (const l of ['en', 'ar', 'de']) {
    I.setLang(l);
    for (const k of keys) { const v = I.t(k, { n: 2 }); assert.ok(v && v !== k, `${l}.${k}`); assert.ok(C.neutralText(v), `${l}.${k} not neutral: ${v}`); }
  }
  I.setLang('ar'); assert.match(I.t('clK_delay'), /[\u0600-\u06ff]/);
  I.setLang('en');
});

test('service worker + no third-party map providers', () => {
  const sw = readFileSync(root + 'sw.js', 'utf8');
  assert.match(sw, /'js\/closures\.js'/); assert.match(sw, /'js\/closures-core\.js'/);
  const util = readFileSync(root + 'js/util.js', 'utf8');
  assert.equal(sw.match(/const VERSION = '([0-9-]+)'/)[1], util.match(/const VERSION = '([0-9-]+)'/)[1]);
  for (const f of ['js/closures.js', 'js/closures-core.js']) {
    const s = readFileSync(root + f, 'utf8');
    assert.doesNotMatch(s, /google|mapbox\.com|api\.mapbox|here\.com|bing\.com|apple\.com|service_role|https?:\/\//i, f);
    assert.doesNotMatch(s, /fetch\(['"]\//, `${f}: relative paths only`);
  }
});

// ----- QA round 2 -----
test('P1: every anonymous report (road + #20 reports) has no client time, language or device fingerprint', async () => {
  for (const props of [C.buildClosureReport('delay', '', 33.51, 36.29).props, RC.buildReport ? { k: 'report', t: 'missing', la: 33.5, lo: 36.3, n: 'X', c: 'cafe' } : null].filter(Boolean)) {
    let body = null;
    const r = await A.sendNow('layer', props, { fetchImpl: async (u, o) => { body = o.body; return { ok: true, status: 201, text: async () => '' }; } });
    if (r.why === 'dev') continue;
    const [ev] = JSON.parse(body);
    for (const k of ['client_ts', 'lang', 'device', 'os', 'standalone', 'app_version', 'session_id', 'country', 'city', 'referrer', 'utm_source']) assert.equal(ev[k], null, k);
    assert.equal(ev.install_id, 'anon'); assert.equal(ev.props.ch, undefined);
  }
});

// ---- P1 timeline simulation: real usage events vs. anonymous reports, client time AND server insert time ----
function mkLocks() { const held = new Set(); return { request: async (name, o, cb) => { if (held.has(name)) return cb(null); held.add(name); try { return await cb({ name }); } finally { held.delete(name); } } }; }
function sim(t, start) {
  t.mock.timers.reset(); t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: start });
  A._resetPrivacy(); localStorage.removeItem('kh.aq'); sessionStorage.clear();
  Object.defineProperty(navigator, 'locks', { value: mkLocks(), configurable: true }); // Web Locks mock (single-process)
  const reqs = []; // { at (server time), evs }
  globalThis.fetch = async (u, o) => { const b = JSON.parse(o.body); reqs.push({ at: Date.now(), url: u, evs: Array.isArray(b) ? b : [b.ev] }); return { ok: true, status: 201, text: async () => '' }; };
  const at = s => start + s * 1000;
  const go = s => { const d = at(s) - Date.now(); if (d > 0) t.mock.timers.tick(d); };
  const check = (extraMarks = []) => {
    const real = reqs.flatMap(r => r.evs.filter(e => e.install_id !== 'anon').map(e => ({ ...e, at: r.at })));
    const reps = reqs.flatMap(r => r.evs.filter(e => e.install_id === 'anon').map(e => ({ ...e, at: r.at })));
    for (const rp of reps) { assert.equal(rp.client_ts, null); for (const e of real) {
      assert.ok(Math.abs(Date.parse(e.client_ts) - rp.at) > 60e3, `${e.type} client_ts within 60 s of the report insert`);
      assert.ok(Math.abs(e.at - rp.at) > 60e3, `${e.type} batch inserted within 60 s of the report insert`); } }
    for (const m of extraMarks) for (const e of real) assert.ok(Math.abs(Date.parse(e.client_ts) - m) > 60e3, `${e.type} @${(Date.parse(e.client_ts) - start) / 1000}s within 60 s of the report form (${(m - start) / 1000}s)`);
    return { real, reps };
  };
  return { at, go, check, reqs, done: () => { globalThis.fetch = () => { throw new Error('network access in tests is forbidden'); }; A._resetPrivacy(); localStorage.removeItem('kh.aq'); } };
}
const flushAll = async t => { for (let i = 0; i < 5; i++) { await A.flush(); await new Promise(r => setImmediate(r)); } };
const FIVE = () => { A.track('search', { n: 1 }); A.track('layer', { l: 'sat' }); A.track('place_view', { cat: 'pin' }); A.track('whats_here', {}); A.track('locate', {}); };

test('P1a: hide/pagehide releases only events older than 60 s; younger ones persist and are dropped on next load if a report is near (Nour rt2-A)', async (t) => {
  const S = sim(t, NOW + 20e6);
  A.track('visit'); S.go(5); FIVE();
  S.go(100); FIVE();                       // trackB
  S.go(110); A._onHide(); await flushAll(); // app switch: t=5 events may go (older than 60 s), t=100 must not
  assert.ok(A._heldCount() >= 5); assert.ok(JSON.parse(localStorage.getItem('kh.held')).length >= 5, 'young events persisted');
  S.go(112); A._adoptHeld();               // back in the app
  S.go(125); A.reportQuiet(Infinity);      // form opens → t=100 events dropped
  S.go(132); A._onHide(); await flushAll(); S.go(133); A._adoptHeld();
  S.go(147); assert.equal(A.submitReport('layer', C.buildClosureReport('closed', '', 33.51, 36.29).props).ok, true);
  S.go(150); A.reportQuietOff(); S.go(152); A._onHide(); await flushAll();
  S.go(215); FIVE(); S.go(227); A._onHide(); await flushAll();
  // page closed for good at t=227 (persisted events + the pending report stay in localStorage) → next load at t=2000
  t.mock.timers.reset(); t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: S.at(2000) });
  A._adoptHeld(); await A.sendDueReports(); await flushAll();
  t.mock.timers.tick(30 * 60e3); await flushAll(); await A.sendDueReports(); await flushAll();
  const { real, reps } = S.check([S.at(125), S.at(147), S.at(150)]);
  assert.equal(reps.length, 1, 'the report was delivered on the next load');
  const ts = new Set(real.map(e => Math.round((Date.parse(e.client_ts) - S.at(0)) / 1000)));
  assert.ok(ts.has(5) && ts.has(0), 'old events (visit, t=5) still count: ' + [...ts]);
  assert.ok(!ts.has(100), 't=100 events (25 s before the form) never sent');
  S.done();
});

test('P1b: visit is held 60 s and dropped when a report form opens right after app start (rt2-B)', async (t) => {
  const S = sim(t, NOW + 30e6);
  A.track('visit'); S.go(8); await flushAll(); assert.equal(S.reqs.length, 0, 'visit not sent at t=8');
  S.go(20); A.reportQuiet(Infinity); S.go(32); A.submitReport('layer', C.buildClosureReport('delay', '', 33.51, 36.29).props); A.reportQuietOff();
  for (let i = 0; i < 30; i++) { t.mock.timers.tick(60e3); await flushAll(); }
  const { real, reps } = S.check([S.at(20), S.at(32)]);
  assert.equal(reps.length, 1); assert.equal(real.filter(e => e.type === 'visit').length, 0, 'visit dropped');
  S.done();
});

test('P1: report is sent after a random 2–10 min delay, kept across reloads, deleted after success', async (t) => {
  const S = sim(t, NOW + 40e6);
  const r = A.submitReport('layer', { k: 'closure', t: 'closed', la: 33.5, lo: 36.3 }, { rand: () => 0.5 });
  assert.equal(r.ok, true); assert.equal(r.due, S.at(360)); assert.equal(A._pendingReports().length, 1);
  assert.equal(A.submitReport('report', {}).ok, false); // type check stays
  A.reportQuietOff(); S.go(119); await flushAll(); assert.equal(S.reqs.length, 0, 'nothing before 2 min');
  S.go(360); await A.sendDueReports(); await flushAll();
  const { reps } = S.check([]); assert.equal(reps.length, 1); assert.ok(reps[0].at - S.at(360) < 1000);
  assert.equal(A._pendingReports().length, 0); assert.equal(localStorage.getItem('kh.rq'), '[]', 'nothing of the report left in localStorage');
  S.done();
});

test('P1 starvation: usage every minute + continuous navigation → report still sent within due+90 s, no real event ±60 s', async (t) => {
  for (const [lbl, every] of [['1×/min', 60e3], ['continuous', 7e3]]) {
    const S = sim(t, NOW + (lbl === 'continuous' ? 61e6 : 60e6));
    A.track('visit');
    let due = 0, k = 0;
    for (let s = 0; s <= 1200; s += 1) {
      S.go(s);
      if ((s * 1000) % every === 0) A.track(k++ % 2 ? 'search' : 'reroute', { n: s });
      if (s === 30) { A.reportQuiet(Infinity); A.submitReport('layer', { k: 'closure', t: 'delay', la: 33.5, lo: 36.3 }, { rand: () => 0.75 }); due = A._pendingReports()[0].due; A.reportQuietOff(); }
      await new Promise(r => setImmediate(r));
    }
    const { real, reps } = S.check([S.at(30)]);
    assert.equal(reps.length, 1, lbl + ': report sent'); assert.ok(reps[0].at <= due + 90e3, `${lbl}: sent ${(reps[0].at - due) / 1000}s after due`);
    assert.ok(real.length > 5, lbl + ': usage still delivered (held, not dropped) ' + real.length + ' reqs ' + S.reqs.map(r => (r.at - S.at(0)) / 1000 + ':' + r.evs.length).join(','));
    assert.ok(real.some(e => Date.parse(e.client_ts) > reps[0].at + 60e3), lbl + ': usage after the report is sent later');
    S.done();
  }
});

test('P2b: idempotent report via RPC kh_report_insert: random rid, retry after timeout inserts once; plain-insert fallback only on "function missing"', async (t) => {
  const S = sim(t, NOW + 70e6);
  const rows = new Map(); let calls = 0, migrated = true, rpcErr = null;
  globalThis.fetch = async (u, o) => {
    calls++; const url = new URL(u), body = JSON.parse(o.body);
    if (url.pathname.endsWith('/rpc/kh_report_insert')) {
      if (rpcErr) return { ok: false, status: rpcErr[0], text: async () => rpcErr[1] };
      if (!migrated) return { ok: false, status: 404, text: async () => '{"code":"PGRST202","message":"Could not find the function public.kh_report_insert(ev)"}' };
      if (!rows.has(body.ev.props.rid)) rows.set(body.ev.props.rid, body.ev); // on conflict do nothing
    } else rows.set('plain' + calls, body[0]);
    if (calls === 1) throw new TypeError('timeout'); // inserted, but the answer is lost
    return { ok: true, status: 204, text: async () => '' };
  };
  const r = A.submitReport('layer', { k: 'closure', t: 'closed', la: 33.5, lo: 36.3 });
  const rid = A._pendingReports()[0].props.rid;
  assert.match(rid, /^[0-9a-f-]{36}$/); assert.ok(!rid.includes(localStorage.getItem('kh.iid')));
  t.mock.timers.tick(r.due - Date.now()); await A.sendDueReports(); await flushAll();
  assert.equal(A._pendingReports().length, 1, 'kept for retry');
  t.mock.timers.tick(A._pendingReports()[0].due - Date.now() + 61e3); await A.sendDueReports(); await flushAll();
  assert.equal(rows.size, 1, 'one row despite retry'); assert.equal(A._pendingReports().length, 0);
  // any other 400 (e.g. a bad body) must NOT fall back to the non-idempotent insert
  rows.clear(); calls = 1; rpcErr = [400, '{"code":"PGRST102","message":"Empty or invalid json"}']; localStorage.removeItem('kh.noRid');
  const r3 = A.submitReport('layer', { k: 'closure', t: 'delay', la: 33.5, lo: 36.3 });
  t.mock.timers.tick(r3.due - Date.now() + 61e3); await A.sendDueReports(); await flushAll();
  assert.equal(rows.size, 0, 'no plain insert for an unrelated PGRST error'); assert.equal(localStorage.getItem('kh.noRid'), null); assert.equal(A._pendingReports().length, 0, 'permanent 400: dropped, not retried');
  localStorage.setItem('kh.rq', '[]'); rpcErr = null;
  // without the migration: 404 PGRST202 → repeated once as plain insert (best effort), remembered
  rows.clear(); calls = 1; migrated = false;
  const r2 = A.submitReport('layer', { k: 'closure', t: 'delay', la: 33.5, lo: 36.3 });
  t.mock.timers.tick(r2.due - Date.now() + 61e3); await A.sendDueReports(); await flushAll();
  assert.equal(rows.size, 1); assert.equal(A._pendingReports().length, 0); assert.ok(+localStorage.getItem('kh.noRid') > 0);
  const sql = readFileSync(root + 'supabase/migrations/20261106_kh_events_rid.sql', 'utf8');
  assert.match(sql, /DO NOT run/); assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /generated always|add column/i, 'no table rewrite');
  assert.match(sql, /create unique index concurrently if not exists kh_events_rid_uq\s+on public\.kh_events \(\(props->>'rid'\)\)\s+where props->>'rid' is not null;/);
  assert.match(sql, /security invoker/); assert.match(sql, /on conflict \(\(props->>'rid'\)\) where props->>'rid' is not null do nothing/);
  assert.ok(sql.indexOf('delete from public.kh_events') < sql.indexOf('create unique index'), 'dedupe before the index');
  localStorage.removeItem('kh.noRid'); S.done();
});
test('P3: usage events never carry rid', async (t) => {
  const S = sim(t, NOW + 71e6);
  A.track('search', { n: 1, rid: 'x' }); S.go(200); await flushAll();
  const evs = S.reqs.flatMap(r => r.evs); assert.ok(evs.length >= 1); assert.ok(evs.every(e => !('rid' in e.props)));
  S.done();
});
test('P1 stall (rt4): event while the form is open + navigation every 10 s for 20 min → usage resumes ≤61 s after quiet ends, kh.aq drains, no real event ±60 s of the report', async (t) => {
  const S = sim(t, NOW + 72e6);
  A.track('visit'); let due = 0, off = 0;
  for (let s = 0; s <= 1200; s++) {
    S.go(s);
    if (s % 10 === 0) A.track(s % 20 ? 'search' : 'reroute', { n: s });
    if (s === 128) A.reportQuiet(Infinity); // form opens
    if (s === 180) { A.submitReport('layer', { k: 'closure', t: 'delay', la: 33.5, lo: 36.3 }, { rand: () => 0.5 }); due = A._pendingReports()[0].due; A.reportQuietOff(); off = Date.now(); }
    await new Promise(r => setImmediate(r));
  }
  S.go(1300); await flushAll();
  const { real, reps } = S.check([S.at(128), S.at(180)]);
  assert.equal(reps.length, 1); assert.ok(reps[0].at <= due + 90e3);
  const times = S.reqs.filter(r => r.evs.some(e => e.install_id !== 'anon')).map(r => r.at);
  const firstAfterQuiet = times.find(x => x > off);
  // quiet ends at off+60 s; the first eligible event (next 10 s tick) is held 60 s, then batched (≤ 8 s)
  assert.ok(firstAfterQuiet && firstAfterQuiet <= off + 60e3 + 10e3 + 60e3 + 9e3, `usage resumed ${(firstAfterQuiet - off) / 1000}s after the form closed`);
  const firstAfterRep = times.find(x => x > reps[0].at);
  assert.ok(firstAfterRep && firstAfterRep <= reps[0].at + 60e3 + 10e3 + 60e3 + 9e3, 'usage resumes after the report quiet');
  for (let i = 1; i < times.length; i++) if (times[i - 1] > reps[0].at + 61e3 && times[i] < S.at(1200)) assert.ok(times[i] - times[i - 1] < 120e3, 'no long stall later');
  assert.equal(A._queue().length, 0, 'kh.aq empty again'); assert.equal(JSON.parse(localStorage.getItem('kh.aq') || '[]').length, 0);
  assert.ok(real.length > 50);
  S.done();
});
test('P1 hide: all eligible events go out in several batches of ≤50 (keepalive budget), not just one', async (t) => {
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); // let the previous test's in-flight sends settle
  const S = sim(t, NOW + 73e6);
  for (let i = 0; i < 90; i++) A.track('search', { n: i });
  S.go(61); await new Promise(r => setImmediate(r)); // all 90 queued (held 60 s), flush timer pending
  await A.flush({ hide: true }); await new Promise(r => setImmediate(r));
  assert.ok(S.reqs.length >= 2 && S.reqs.every(r => r.evs.length <= 50)); assert.equal(S.reqs.flatMap(r => r.evs).length, 90, S.reqs.map(r => r.evs.length + ':' + r.evs[0].type).join() + ' q' + A._queue().length + ' held' + A._held() + ' now' + Date.now() + ' st' + S.at(0));
  assert.equal(A._queue().length, 0); S.done();
});
test('transit: city/line fit never zooms out below z12 (Aleppo was z9.4)', () => {
  const tr = readFileSync(root + 'js/transit.js', 'utf8'), core = readFileSync(root + 'js/core.js', 'utf8');
  assert.match(tr, /TR_MIN_Z = 12/); assert.doesNotMatch(tr, /map\.fitBounds\(/); assert.equal((tr.match(/minZoom: TR_MIN_Z/g) || []).length, 2); assert.match(tr, /fitArea\(cityFitBounds/); assert.match(tr, /fitLine = \(map, bb\) => fitArea/); // one shared fit (city switch + line)
  assert.match(core, /cam\.zoom < minZoom/);
});
test('P3: offline at due time → sent on the online event; P2a: toast says saved / sent shortly (EN/AR/DE)', async (t) => {
  const S = sim(t, NOW + 80e6);
  const r = A.submitReport('layer', { k: 'closure', t: 'closed', la: 33.5, lo: 36.3 });
  navigator.onLine = false; t.mock.timers.tick(r.due - Date.now() + 5e3); await A.sendDueReports(); assert.equal(S.reqs.length, 0);
  navigator.onLine = true; await A.sendDueReports(); assert.equal(S.reqs.length, 1); assert.equal(A._pendingReports().length, 0);
  assert.match(readFileSync(root + 'js/analytics.js', 'utf8'), /addEventListener\('online', \(\) => sendDueReports\(\)\)/);
  const I = await import('../../js/i18n.js');
  const T = I.STR || I.default || null; const src = readFileSync(root + 'js/i18n.js', 'utf8');
  for (const w of ['saved and will be sent for review shortly', 'حُفظ بلاغك وسيُرسل قريبًا للمراجعة', 'deine Meldung ist gespeichert und wird in Kürze zur Prüfung gesendet']) assert.ok(src.includes(w), w);
  assert.ok(!/report was sent for review|أُرسل بلاغك للمراجعة|wurde zur Prüfung gesendet/.test(src));
  S.done();
});

test('P1: quiet state and report marks are shared via localStorage (other tabs)', async (t) => {
  const S = sim(t, NOW + 50e6);
  A.reportQuiet(Infinity); assert.ok(+localStorage.getItem('kh.quiet') > Date.now());
  assert.equal(A.track('search', {}), false);
  A.reportQuietOff(); S.go(30); assert.equal(A.track('search', {}), false);
  // event persisted by another tab 30 s before a report mark is dropped on adopt
  localStorage.setItem('kh.held', JSON.stringify([{ id: 'x', type: 'search', props: {}, ts: S.at(0) - 30e3, sid: 's' }]));
  S.go(200); A._adoptHeld(); assert.equal(A._heldCount(), 0); await flushAll(); assert.equal(S.reqs.length, 0);
  S.done();
});

test('P2: note PII filter (emails, phones Latin + Arabic-Indic, URLs, @handles)', () => {
  for (const s of ['call 0933 123 456', '+963 11 222 3333', '٠٩٣٣١٢٣٤٥٦', '۰۹۳۳ ۱۲۳ ۴۵۶', 'mail a.b@x.org', 'see https://x.io/a', 'www.example.com', 't.me/somebody', 'ask @ahmad_1', 'اتصل @سامر'])
    { assert.equal(C.hasPII(s), true, s); assert.equal(C.buildClosureReport('closed', s, 33.5, 36.3).err, 'pii', s); }
  for (const s of ['Bridge closed, 2 lanes', 'km 12 water 30 cm', 'حاجز إسمنتي على الطريق', 'Stau ab 17:30', 'Baustelle bis 2026'])
    { assert.equal(C.hasPII(s), false, s); assert.equal(C.buildClosureReport('closed', s, 33.5, 36.3).ok, true, s); }
  assert.doesNotMatch(C.stripPII('call 0933 123 456 or a@b.com @bob ok'), /\d{3}|@|b\.com/);
});

test('P3: blocklist allows "حاجز إسمنتي" (concrete barrier), still blocks military phrasing', () => {
  assert.equal(C.neutralText('حاجز إسمنتي'), true);
  for (const s of ['حاجز عسكري', 'army', 'Checkpoint', 'Militär']) assert.equal(C.neutralText(s), false, s);
});

test('P3: Arabic plurals via Intl.PluralRules + reworded strings', async () => {
  const I = await import('../../js/i18n.js');
  I.setLang('ar');
  const tpl = Object.fromEntries(['zero', 'one', 'two', 'few', 'many', 'other'].map(c => [c, I.t('clRW_' + c)]).filter(([c, v]) => v !== 'clRW_' + c));
  assert.match(C.plural('ar', 1, tpl), /واحدة/); assert.match(C.plural('ar', 2, tpl), /مشكلتا/);
  assert.match(C.plural('ar', 3, tpl), /مشاكل/); assert.match(C.plural('ar', 11, tpl), /مشكلة/);
  assert.doesNotMatch(I.t('clDisclaimer'), /قُد بحذر/); assert.match(I.t('clDisclaimer'), /انتبه أثناء القيادة/);
  assert.match(I.t('clK_construction'), /صيانة/);
  for (const l of ['en', 'de', 'ar']) { I.setLang(l); for (const k of ['clE_noroad', 'clE_pii', 'clRW_one', 'clRW_other']) assert.notEqual(I.t(k), k, `${l}.${k}`); }
  I.setLang('en'); assert.equal(C.plural('en', 1, { one: '1 x', other: '{n} xs' }), '1 x'); assert.equal(C.plural('en', 4, { one: '1 x', other: '{n} xs' }), '4 xs');
});

test('P3: PII filter keeps dates (Latin + Arabic-Indic), still catches phones next to them', () => {
  for (const d of ['٢٠٢٦/١١/٠٤', '2026 11 04', '2026-11-04', '04.11.2026', 'مغلق حتى ٢٠٢٦/١١/٠٤']) { assert.equal(C.hasPII(d), false, d); assert.equal(C.stripPII(d), d); assert.equal(C.buildClosureReport('closed', d, 33.5, 36.3).ok, true, d); }
  for (const p of ['0933 12 34 56', '+963 2026 11 04', '٠٩٣٣١٢٣٤٥٦', '2026/11/04 0933123456']) assert.equal(C.hasPII(p), true, p);
});
test('P3: view migration guards the numeric casts of la/lo with a regex', () => {
  const sql = readFileSync(root + 'supabase/migrations/20261105_reports_view_closures.sql', 'utf8');
  for (const k of ['la', 'lo']) { assert.match(sql, new RegExp(`case when props->>'${k}' ~ '[^']+' then \\(props->>'${k}'\\)::numeric end`)); }
  assert.doesNotMatch(sql.replace(/case when[^\n]*?end/g, ''), /\(props->>'l[ao]'\)::numeric/);
});

test('P2: snapToRoad works in metres (zoom-independent), refuses > 60 m, name from transportation_name', async () => {
  const CL = await import('../../js/closures.js');
  const road = { sourceLayer: 'transportation', properties: { class: 'primary' }, geometry: { type: 'LineString', coordinates: [[36.28, 33.51], [36.30, 33.51]] } };
  const label = { sourceLayer: 'transportation_name', properties: { name: 'Al-Thawra St' }, geometry: { type: 'LineString', coordinates: [[36.285, 33.51], [36.295, 33.51]] } };
  const mapAt = z => { const k = 512 * 2 ** z / 360, boxes = []; return { boxes, getZoom: () => z, project: ([x, y]) => ({ x: x * k, y: -y * k }),
    queryRenderedFeatures: b => { boxes.push(b); return [road, label]; } }; };
  const dLat = m => m / 111195;
  for (const z of [12, 14, 16, 18]) {
    const m = mapAt(z);
    const s = CL.snapToRoad(m, 36.29, 33.51 + dLat(40));
    assert.equal(s.snapped, true, 'z' + z); assert.equal(s.road, 'Al-Thawra St'); assert.ok(Math.abs(s.lat - 33.51) < 1e-9);
    const far = CL.snapToRoad(m, 36.29, 33.51 + dLat(75));
    assert.equal(far.snapped, false, 'z' + z + ' 75 m must be refused');
    const mpp = 40075016.686 * Math.cos(33.51 * Math.PI / 180) / (512 * 2 ** z), half = (m.boxes[0][1][0] - m.boxes[0][0][0]) / 2 * mpp;
    if (z >= 14) assert.ok(half >= 60 && half < 90, `z${z}: search box half-size ${half.toFixed(1)} m`);
  }
  // only line name: fallback to the transportation feature's own name
  const m = mapAt(16); m.queryRenderedFeatures = () => [{ ...road, properties: { name: 'Baghdad St' } }];
  assert.equal(CL.snapToRoad(m, 36.29, 33.51).road, 'Baghdad St');
  // label not rendered in the box: name read from the source tiles via querySourceFeatures(source, transportation_name)
  const m2 = mapAt(16); const asked = [];
  m2.queryRenderedFeatures = () => [{ ...road, source: 'openmaptiles' }];
  m2.querySourceFeatures = (sid, o) => { asked.push([sid, o.sourceLayer]); return [label]; };
  assert.equal(CL.snapToRoad(m2, 36.29, 33.51).road, 'Al-Thawra St');
  assert.deepEqual(asked, [['openmaptiles', 'transportation_name']]);
  // label segment 33 m away (Nour's case) is still used; ≤ 60 m like the snap, > 60 m falls back to the line name
  const off = mm => ({ ...label, geometry: { type: 'LineString', coordinates: [[36.285, 33.51 + dLat(mm)], [36.295, 33.51 + dLat(mm)]] } });
  m2.querySourceFeatures = () => [off(33)]; assert.equal(CL.snapToRoad(m2, 36.29, 33.51).road, 'Al-Thawra St');
  m2.queryRenderedFeatures = () => [{ ...road, source: 'openmaptiles', properties: { name: 'Line' } }];
  m2.querySourceFeatures = () => [off(70)]; assert.equal(CL.snapToRoad(m2, 36.29, 33.51).road, 'Line');
  const src = readFileSync(root + 'js/closures.js', 'utf8');
  assert.match(src, /item\.snapped !== false/); assert.match(src, /clE_noroad/);
});

test('P3: CLI: --hours without a value and broken JSON give a friendly error, nothing written', () => {
  const d = mkdtempSync(join(tmpdir(), 'clx-'));
  writeFileSync(join(d, 'r.json'), JSON.stringify([{ id: 5, props: { k: 'closure', t: 'closed', la: 33.5, lo: 36.3 } }]));
  writeFileSync(join(d, 'a.json'), JSON.stringify({ 5: {} })); writeFileSync(join(d, 'bad.json'), '{ "5": { hours: 4 ');
  const out = join(d, 'o.json'), cli = root + 'scripts/closures/export-approved.mjs';
  for (const [args, re] of [[['--reports', join(d, 'r.json'), '--approve', join(d, 'a.json'), '--hours'], /--hours needs a value/],
    [['--reports', join(d, 'r.json'), '--approve', join(d, 'bad.json')], /bad\.json is not valid JSON/]]) {
    const r = spawnSync(process.execPath, [cli, ...args, '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 1); assert.match(r.stderr, /^Nothing was written\./); assert.match(r.stderr, re); assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/);
    assert.equal(existsSync(out), false);
  }
});

test('P3: CLI prints a friendly error (no stack) for non-neutral notes and hours 0', () => {
  const d = mkdtempSync(join(tmpdir(), 'clx-'));
  writeFileSync(join(d, 'r.json'), JSON.stringify([{ id: 5, props: { k: 'closure', t: 'closed', la: 33.5, lo: 36.3 } }]));
  for (const [ap, extra, re] of [[{ 5: { note: 'army road' } }, [], /not allowed/], [{ 5: { hours: 0 } }, [], /positive number/], [{ 5: {} }, ['--hours', '0'], /positive number/]]) {
    writeFileSync(join(d, 'a.json'), JSON.stringify(ap));
    let err = null;
    try { execFileSync(process.execPath, [root + 'scripts/closures/export-approved.mjs', '--reports', join(d, 'r.json'), '--approve', join(d, 'a.json'), '--out', join(d, 'o.json'), ...extra], { stdio: 'pipe' }); } catch (e) { err = e; }
    assert.ok(err, 'must fail'); assert.equal(err.status, 1);
    const msg = err.stderr.toString(); assert.match(msg, re); assert.doesNotMatch(msg, /\n\s+at /); // no stack trace
  }
});

test('P3: moderation view migration covers closures; README wording is neutral', () => {
  const sql = readFileSync(root + 'supabase/migrations/20261105_reports_view_closures.sql', 'utf8');
  assert.match(sql, /props->>'k' in \('report', 'closure'\)/); assert.match(sql, /DO NOT run/);
  const md = readFileSync(root + 'scripts/closures/README.md', 'utf8');
  assert.equal(C.neutralText(md.replace(/blocklist/g, '')), true); assert.doesNotMatch(md, /checkpoint/i); assert.doesNotMatch(md, /client_ts/);
});

test('P3 #24: Web Locks: 3 tabs in the same ms → exactly one send; fallback token claim without navigator.locks', async (t) => {
  const S = sim(t, NOW + 80e6);
  let n = 0; globalThis.fetch = async () => { n++; return { ok: true, status: 204, text: async () => '' }; };
  const r = A.submitReport('layer', { k: 'closure', t: 'closed', la: 33.5, lo: 36.3 });
  t.mock.timers.tick(r.due - Date.now());
  // three "tabs": the in-module guard is bypassed by calling the locked path concurrently via the lock mock
  const res = await Promise.all([A.sendDueReports(), A.sendDueReports(), A.sendDueReports()]); await flushAll();
  assert.equal(n, 1, 'one insert'); assert.ok(res.filter(x => x === 1).length <= 1); assert.equal(A._pendingReports().length, 0);
  // fallback (no Web Locks): token claim, a second tab that overwrote the claim wins, the first backs off
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }); n = 0;
  const r2 = A.submitReport('layer', { k: 'closure', t: 'delay', la: 33.5, lo: 36.3 });
  t.mock.timers.tick(r2.due - Date.now() + 61e3);
  const p = A.sendDueReports(); await new Promise(r => setImmediate(r));
  localStorage.setItem('kh.rq', JSON.stringify(A._pendingReports().map(x => ({ ...x, ct: 'other-tab' }))));
  t.mock.timers.tick(200); assert.equal(await p, 0); assert.equal(n, 0, 'backed off: the other tab owns the claim');
  assert.match(readFileSync(root + 'js/analytics.js', 'utf8'), /navigator\?\.locks/);
  assert.match(readFileSync(root + 'js/analytics.js', 'utf8'), /cur\.get\(x\.id\)\?\.ct === tok/);
  S.done();
});
test('P3 #24: permanent 400s (23502, 22P02, 42501) are dropped at once; 5xx/429/network are retried', async (t) => {
  for (const [st, body, keep] of [[400, '{"code":"23502"}', false], [400, '{"code":"22P02"}', false], [403, '{"code":"42501"}', false], [500, '', true], [429, '', true], [0, 'net', true]]) {
    const S = sim(t, NOW + 81e6);
    localStorage.setItem('kh.noRid', String(Date.now())); // plain insert path
    globalThis.fetch = async () => { if (st === 0) throw new TypeError('net'); return { ok: false, status: st, text: async () => body }; };
    const r = A.submitReport('layer', { k: 'closure', t: 'closed', la: 33.5, lo: 36.3 });
    t.mock.timers.tick(r.due - Date.now()); await A.sendDueReports(); await flushAll();
    assert.equal(A._pendingReports().length, keep ? 1 : 0, `${st} ${body}`);
    localStorage.removeItem('kh.noRid'); S.done();
  }
});
test('P3 #24: rid migration dedupes with row_number(), pinned search_path, still DO NOT run', () => {
  const sql = readFileSync(root + 'supabase/migrations/20261106_kh_events_rid.sql', 'utf8');
  assert.match(sql, /row_number\(\) over \(partition by props->>'rid' order by id\)/); assert.match(sql, /d\.rn > 1/);
  assert.doesNotMatch(sql, /using public\.kh_events b/); assert.match(sql, /set search_path = pg_catalog, public/); assert.match(sql, /DO NOT run/);
});
