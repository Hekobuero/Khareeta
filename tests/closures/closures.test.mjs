// Road reports: payload privacy/shape, static file validation + expiry, route proximity, moderator export, i18n, SW.
// fetch is ALWAYS mocked – nothing reaches the production Supabase project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
  assert.equal(C.rowsToEntries(rows, { 13: { hours: 9999 } }, NOW)[0].note, ''); // user notes never published
  assert.equal(Date.parse(C.rowsToEntries(rows, { 13: { hours: 9999 } }, NOW)[0].expires) - NOW, C.MAX_DAYS * 864e5);
  assert.throws(() => C.rowsToEntries(rows, { 11: { note: 'army checkpoint' } }, NOW), /neutral/);
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
  const keys = ['clOpen', 'clTitle', 'clKind', 'clNote', 'clPosHint', 'clModerated', 'clE_kind', 'clSince', 'clUntil', 'clDisclaimer', 'clReportHere', 'clRouteWarn1', 'clRouteWarnN', ...C.CLOSURE_KINDS.map(k => 'clK_' + k)];
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
