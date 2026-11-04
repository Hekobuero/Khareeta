// In-app reports: link validation, lookalike blocking, local rate limit, payload shape/size, and the send path.
// fetch is ALWAYS mocked – no test ever reaches the production Supabase project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; };
const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('network access in tests is forbidden'); };
Object.assign(globalThis, {
  localStorage: mem(), sessionStorage: mem(), location: { protocol: 'https:', hostname: 'khareeta.app', search: '', href: 'https://khareeta.app/' },
  screen: { width: 390, height: 844 }, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {},
  document: { referrer: '', visibilityState: 'visible', addEventListener() {}, documentElement: {} },
});
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'iPhone', language: 'en', languages: ['en'], maxTouchPoints: 5, onLine: true }, configurable: true });

const C = await import('../../js/report-core.js');
const A = await import('../../js/analytics.js');

test('links: https only, allowlisted hosts per kind', () => {
  assert.equal(C.checkLink('https://www.facebook.com/SomeCafe', 'facebook').ok, true);
  assert.equal(C.checkLink('facebook.com/SomeCafe', 'facebook').url, 'https://facebook.com/SomeCafe');
  assert.equal(C.checkLink('https://instagram.com/cafe.dam', 'instagram').ok, true);
  assert.equal(C.checkLink('https://wa.me/963944000000', 'whatsapp').ok, true);
  assert.equal(C.checkLink('https://t.me/cafedam', 'telegram').ok, true);
  assert.equal(C.checkLink('https://example.sy/menu', 'website').ok, true);
  assert.equal(C.checkLink('http://facebook.com/x', 'facebook').err, 'https');
  assert.equal(C.checkLink('javascript:alert(1)', 'website').err, 'https');
  assert.equal(C.checkLink('//facebook.com/x', 'facebook').err, 'https');
  assert.equal(C.checkLink('https://instagram.com/x', 'facebook').err, 'host');
  assert.equal(C.checkLink('https://facebook.com/x', 'website').err, 'kind');
  assert.equal(C.checkLink('https://facebook.com/', 'facebook').err, 'bad');
  assert.equal(C.checkLink('https://user@facebook.com/x', 'facebook').err, 'bad');
  assert.equal(C.checkLink('https://facebook.com:8443/x', 'facebook').err, 'bad');
  assert.equal(C.checkLink('https://192.168.0.1/x', 'website').err, 'host');
  assert.equal(C.checkLink('', 'website').err, 'empty');
  assert.equal(C.checkLink('https://x.sy', 'myspace').err, 'kind');
  assert.equal(C.checkLink('https://facebook.com/x#frag', 'facebook').url, 'https://facebook.com/x');
});
test('links: lookalike / Cyrillic / IDN domains are blocked', () => {
  for (const u of ['https://faceb00k.com/x', 'https://facebok.com/x', 'https://instagrarn.com/x', 'https://whatsapp-login.net/x', 'https://telegrarn.org/x', 'https://facebook.com.evil.io/x', 'https://xn--facebok-y0a.com/x']) {
    assert.equal(C.checkLink(u, 'website').err, 'lookalike', u);
  }
  const cyr = C.checkLink('https://fаcebook.com/x', 'facebook'); // Cyrillic "а"
  assert.equal(cyr.err, 'lookalike'); assert.equal(cyr.why, 'cyrillic');
  assert.equal(C.checkLink('https://инстаграм.рф/x', 'website').why, 'cyrillic');
  assert.equal(C.checkLink('https://telegraph.co.uk/x', 'website').ok, true); // not a lookalike (distance 2)
});
test('rate limit: 20 s gap, 5 per hour, 15 per day', () => {
  const s = mem(); let now = 1e12;
  for (let i = 0; i < 5; i++) { assert.equal(C.rateCheck(now, s).ok, true); C.rateNote(now, s); assert.equal(C.rateCheck(now + 1000, s).why, 'gap'); now += 30e3; }
  assert.equal(C.rateCheck(now, s).why, 'hour');
  now += 36e5; assert.equal(C.rateCheck(now, s).ok, true);
  const d = mem(); let t = 2e12; for (let i = 0; i < 15; i++) { C.rateNote(t, d); t += 2 * 36e5 / 5 + 1; }
  assert.equal(C.rateCheck(t, d).why, 'day');
  assert.equal(C.rateCheck(t + 864e5, d).ok, true);
});
test('payloads: required fields, clipping, ≤ 900 bytes, no user location', () => {
  const pl = { id: 'N123', src: 'osm', name: 'Cafe', lat: 33.5138123456, lon: 36.2765123456 };
  assert.equal(C.buildReport('missing', { name: 'X', cat: 'cafe' }, pl).err, 'name');
  assert.equal(C.buildReport('missing', { name: 'Bakery', cat: 'nope' }, pl).err, 'cat');
  assert.equal(C.buildReport('missing', { name: 'Bakery', cat: 'bakery' }, {}).err, 'pos');
  const m = C.buildReport('missing', { name: '  Fırın\n Abu   Ali ', cat: 'bakery' }, { lat: 33.5, lon: 36.3 });
  assert.deepEqual(m.props, { k: 'report', t: 'missing', la: 33.5, lo: 36.3, n: 'Fırın Abu Ali', c: 'bakery' });
  assert.equal(C.buildReport('wrong', { field: 'hours' }, pl).err, 'note');
  assert.equal(C.buildReport('wrong', { field: 'closed' }, pl).ok, true);
  assert.equal(C.buildReport('wrong', { field: 'closed' }, {}).err, 'place');
  const w = C.buildReport('wrong', { field: 'phone', note: 'x'.repeat(5000) }, { ...pl, name: 'n'.repeat(500) });
  assert.ok(w.ok && JSON.stringify(w.props).length <= 900 && w.props.v.length <= 300 && w.props.pn.length === 80);
  assert.equal(w.props.la, 33.51381);
  const l = C.buildReport('link', { kind: 'instagram', url: 'https://instagram.com/cafe' }, { ...pl, src: 'ov', id: 'abc' });
  assert.deepEqual([l.props.lk, l.props.u, l.props.src], ['instagram', 'https://instagram.com/cafe', 'ov']);
  assert.equal(C.buildReport('link', { kind: 'facebook', url: 'https://faceb00k.com/x' }, pl).link.err, 'lookalike');
  assert.equal(C.buildReport('spam', {}, pl).err, 'type');
});
test('sendNow: one POST to kh_events with the publishable key; ok only on 2xx', async () => {
  const calls = [];
  const mk = status => async (url, o) => { calls.push({ url, o }); return { ok: status < 300, status, text: async () => '' }; };
  const props = C.buildReport('link', { kind: 'telegram', url: 't.me/cafe' }, { id: 'N1', src: 'osm', lat: 33.5, lon: 36.3 }).props;
  assert.deepEqual(await A.sendNow('layer', props, { fetchImpl: mk(201) }), { ok: true });
  const c = calls[0];
  assert.equal(c.url, 'https://ihqcgjndnjxxgeqheoei.supabase.co/rest/v1/kh_events');
  assert.match(c.o.headers.apikey, /^sb_publishable_/);
  assert.equal(c.o.headers.Authorization, undefined);
  const [ev] = JSON.parse(c.o.body);
  assert.equal(ev.type, 'layer'); assert.equal(ev.props.k, 'report'); assert.equal(ev.props.u, 'https://t.me/cafe');
  assert.equal(ev.lat_r, null); assert.equal(ev.lon_r, null);
  assert.equal((await A.sendNow('layer', props, { fetchImpl: mk(400) })).ok, false);
  assert.equal((await A.sendNow('layer', props, { fetchImpl: async () => { throw new TypeError('net'); } })).why, 'network');
  assert.equal((await A.sendNow('report', props, { fetchImpl: mk(201) })).why, 'type'); // not an allowed kh_events.type
  navigator.onLine = false; assert.equal((await A.sendNow('layer', props, { fetchImpl: mk(201) })).why, 'offline'); navigator.onLine = true;
});
test('i18n: every report string exists in EN, AR and DE', () => {
  const src = readFileSync(new URL('../../js/i18n.js', import.meta.url), 'utf8');
  const keys = [...new Set([...readFileSync(new URL('../../js/report.js', import.meta.url), 'utf8').matchAll(/t\('(rp[A-Za-z_]+)'/g)].map(m => m[1]))].filter(k => !k.endsWith('_'));
  const dyn = [...C.REPORT_TYPES.map(k => 'rpT_' + k), ...C.REPORT_CATS.map(k => 'rpC_' + k), ...C.REPORT_FIELDS.map(k => 'rpF_' + k),
    ...['name', 'cat', 'pos', 'field', 'note', 'place', 'size', 'type', 'gap', 'rate', 'offline', 'send', 'dev'].map(k => 'rpE_' + k),
    ...['empty', 'https', 'bad', 'host', 'lookalike', 'kind'].map(k => 'rpE_link_' + k), 'rpOpen', 'rpAddHere', 'rpMissingMenu'];
  for (const k of [...keys, ...dyn]) assert.equal(src.split(`\n  ${k}: `).length - 1, 3, k);
});
test('no secrets, no Meta scraping, sw precaches the new modules', () => {
  const files = ['js/report.js', 'js/report-core.js', 'js/analytics.js'].map(f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(files, /service_role|sb_secret_|eyJhbGciOi/i);
  assert.doesNotMatch(files, /graph\.facebook|fetch\([^)]*(facebook|instagram)/i);
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'js\/report\.js'/); assert.match(sw, /'js\/report-core\.js'/);
});
test.after(() => { globalThis.fetch = realFetch; });
