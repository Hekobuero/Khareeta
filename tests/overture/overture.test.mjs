// Overture shops layer: data format, licence/privacy rules and the pure helpers in js/overture-data.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { socialLink, normPhone, website } from '../../js/links.js';
import { tilesFor, ovActive, ovItem, ovFeature, ovCatLabel, OV_BBOX, OV_SY, OV_CATS, inSyria, touchesSyria, ovReport, ovHidden, OV_HIDE_KEY } from '../../js/overture-data.js';

const DIR = new URL('../../data/overture/', import.meta.url);
const ix = JSON.parse(readFileSync(new URL('index.json', DIR)));
const tiles = Object.fromEntries(Object.keys(ix.tiles).map(k => [k, JSON.parse(readFileSync(new URL(`t${k}.json`, DIR)))]));
const rows = Object.values(tiles).flatMap(t => t.f);

test('index matches tile files', () => {
  const files = readdirSync(DIR).filter(f => /^t.*\.json$/.test(f)).map(f => f.slice(1, -5)).sort();
  assert.deepEqual(files, Object.keys(ix.tiles).sort());
  for (const [k, t] of Object.entries(tiles)) { assert.equal(t.dv, ix.dv); assert.equal(t.f.length, ix.tiles[k]); }
  assert.equal(rows.length, ix.rows);
  assert.ok(rows.length > 1000);
  assert.equal(ix.groups.length, ix.cats.length);
});
test('total size stays small (< 3 MB)', () => {
  const b = readdirSync(DIR).reduce((s, f) => s + statSync(new URL(f, DIR)).size, 0);
  assert.ok(b < 3e6, `${b} bytes`);
});
test('rows: inside Syria, in their tile, valid shape', () => {
  for (const [k, t] of Object.entries(tiles)) {
    const [x, y] = k.split('_').map(Number);
    for (const r of t.f) {
      assert.ok(r.length >= 5 && r.length <= 9);
      const [lon, lat, id, name, ci] = r;
      assert.match(id, /^[0-9a-f]{12}$/);
      assert.ok(inSyria(lon, lat), `${name} outside Syria`);
      assert.equal(Math.floor(lon * 10), x); assert.equal(Math.floor(lat * 10), y);
      assert.ok(typeof name === 'string' && name.length > 0);
      assert.ok(Number.isInteger(ci) && ix.cats[ci]);
    }
  }
});
test('privacy & licence: no e-mail addresses, no Foursquare, licence file present', () => {
  const all = readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => readFileSync(new URL(f, DIR), 'utf8')).join('\n');
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(all.replace(/https?:\/\/[^"]+/g, '')), 'no e-mail');
  assert.ok(!/foursquare|fsq/i.test(all.replace(/Foursquare records excluded/, '').replace(/https?:\/\/[^"]+/g, '')), 'no Foursquare source ids');
  assert.match(readFileSync(new URL('LICENSE.txt', DIR), 'utf8'), /CDLA-Permissive-2\.0/);
  assert.match(ix.source, /Overture Maps Foundation/);
});
test('no non-business categories', () => {
  for (const c of ix.cats) assert.ok(!/religious|worship|government|monument|landmark|historic|museum|mountain|castle|airport/.test(c) && c !== 'park', c);
});
test('links pass js/links.js validation', () => {
  let bad = 0, n = 0;
  for (const r of rows) {
    if (r[5]) { n++; if (!normPhone(r[5])) bad++; }
    if (r[7]) { n++; if (!socialLink('facebook', r[7])) bad++; }
    if (r[8]) { n++; if (!socialLink('instagram', r[8])) bad++; }
    if (r[6]) assert.match(r[6], /^https?:\/\//i);
  }
  assert.ok(bad / n < 0.02, `${bad}/${n} invalid`); // the sheet drops the rest via links.js
});
test('tilesFor / ovActive', () => {
  const dam = [36.27, 33.5, 36.32, 33.53];
  const ks = tilesFor(dam, ix);
  assert.ok(ks.includes('362_335'));
  assert.deepEqual(tilesFor([13.3, 52.5, 13.5, 52.6], ix), []);
  assert.ok(tilesFor([35, 32, 43, 38], ix).length <= 40);
  assert.equal(ovActive(true, 14, dam), true);
  assert.equal(ovActive(true, 13.9, dam), false);
  assert.equal(ovActive(false, 16, dam), false);
  assert.equal(ovActive(true, 16, [13.3, 52.5, 13.5, 52.6]), false);
});
test('ovItem builds an unverified, OSM-free place item', () => {
  const r = rows.find(r => r[5] && r[7]);
  const it = ovItem(r, ix, 'k');
  assert.equal(it.ov, true); assert.equal(it.full, true); assert.equal(it.osm_type, undefined); assert.equal(it.ovId, r[2]);
  assert.equal(it.tags.phone, r[5]); assert.equal(it.tags['contact:facebook'], r[7]);
  assert.ok(!('email' in it.tags));
  const f = ovFeature(r, ix, 7);
  assert.deepEqual(f.geometry.coordinates, [r[0], r[1]]); assert.equal(f.properties.i, 7);
  assert.equal(website({ website: 'javascript:alert(1)' }), null);
});
test('category labels in EN/AR/DE', () => {
  assert.equal(ovCatLabel('restaurant', 'ar'), 'مطعم');
  assert.equal(ovCatLabel('dental_clinic', 'de'), 'Zahnarztpraxis');
  assert.equal(ovCatLabel('some_new_thing', 'en'), 'Some new thing');
  for (const c of ix.cats) {
    assert.ok(OV_CATS.includes(c), 'no translation for ' + c);
    assert.match(ovCatLabel(c, 'ar'), /[\u0600-\u06ff]/, c);
  }
  const py = readFileSync(new URL('../../scripts/overture/build_overture.py', import.meta.url), 'utf8');
  const allow = py.slice(py.indexOf('ALLOW = {'), py.indexOf("AR = '")).match(/'([a-z_]+)'/g).map(x => x.slice(1, -1));
  for (const c of allow) assert.ok(OV_CATS.includes(c), 'allowlisted category without AR/DE label: ' + c);
});
test('i18n strings exist in all languages', async () => {
  const src = readFileSync(new URL('../../js/i18n.js', import.meta.url), 'utf8');
  for (const k of ['ovLayer', 'ovUnverified', 'ovAttr', 'ovAddOsm', 'cOverture', 'ovReport', 'ovReportWhy', 'ovR_private', 'ovR_wrong', 'ovR_closed', 'ovReported', 'ovReportQueued']) assert.equal(src.split(k + ':').length - 1, 3, k);
});

// ---- QA 2026-11-04 (PR #16): privacy, data quality, outline, report button ----
const names = rows.map(r => r[3]);
const AR = '\u0600-\u06ff';
test('privacy: QA example names are gone', () => {
  for (const n of ['منزل خالد أبوشامة', 'امام جامع الروضة', 'عدلاء يونس عبود', 'شاهر الصباغ', 'أبو سعيد']) assert.ok(!names.includes(n), n);
  assert.ok(!rows.some(r => /terranova/i.test(r[3]) && !String(r[5] || '').startsWith('+963')), 'Kyiv/Beirut Terranova');
});
test('privacy: no homes, clerics, kunya or person-only names', () => {
  for (const n of names) {
    assert.ok(!/(^|\s)(منزل|بيت|دار)(\s|$)|\b(house of|haus von)\b/i.test(n), 'home: ' + n);
    assert.ok(!/(^|\s)(ال)?(امام|إمام|شيخ|خطيب)(\s|$)/.test(n), 'cleric: ' + n);
    assert.ok(!new RegExp(`(^|\\s)(أبو|ابو|أم|ام)\\s*[${AR}]`).test(n), 'kunya: ' + n);
    assert.ok(!/نقابة|محامي|\blawyers?\b|bar association/i.test(n), 'institution: ' + n);
  }
});
test('privacy: only +963 phones; mobiles only for commercial categories', () => {
  const py = readFileSync(new URL('../../scripts/overture/build_overture.py', import.meta.url), 'utf8');
  const landOnly = py.slice(py.indexOf('**{k: False'), py.indexOf("AR = '")).match(/'([a-z_]+)'/g).map(x => x.slice(1, -1));
  for (const r of rows) {
    if (!r[5]) continue;
    const d = r[5].replace(/[^\d+]/g, '');
    assert.ok(d.startsWith('+963') || d.startsWith('0'), 'foreign phone ' + r[5]);
    const mob = /^(\+963|0)9\d{8}$/.test(d);
    if (mob) assert.ok(!landOnly.includes(ix.cats[r[4]]), `mobile on ${ix.cats[r[4]]}: ${r[3]}`);
  }
});
test('quality: no exact duplicates, no centroid stacks, no locality names', () => {
  const k = new Set(), at = {};
  for (const r of rows) { const key = r[3] + '|' + r[0] + ',' + r[1]; assert.ok(!k.has(key), key); k.add(key); at[r[0] + ',' + r[1]] = (at[r[0] + ',' + r[1]] || 0) + 1; }
  for (const [p, c] of Object.entries(at)) assert.ok(c <= 3, `${c} places at ${p}`);
  for (const n of ['دمشق', 'حلب', 'حمص', 'Damascus', 'Aleppo', 'Syria']) assert.ok(!names.includes(n), n);
  for (const c of ix.cats) assert.ok(!/locality|neighbo|admin|attorney|law/.test(c), c);
});
test('links: no tracking parameters, no m.me', () => {
  for (const r of rows) for (const u of r.slice(6)) {
    if (!u) continue;
    assert.ok(!/[?&](fbclid|utm_[a-z]+|igshid|mibextid)=/i.test(u), u);
    assert.ok(!/^https?:\/\/(www\.)?m\.me\//i.test(u), u);
  }
});
test('Syria outline: no index load in Beirut or Gaziantep', () => {
  const v = (lon, lat, d = 0.02) => [lon - d, lat - d, lon + d, lat + d];
  for (const [lon, lat] of [[35.5, 33.89], [37.38, 37.06], [35.84, 34.43], [36.16, 36.2], [35.93, 31.95]]) {
    assert.equal(ovActive(true, 15, v(lon, lat)), false, `${lon},${lat}`);
    assert.deepEqual(tilesFor(v(lon, lat), ix), []);
  }
  for (const [lon, lat] of [[36.29, 33.51], [37.16, 36.2], [35.78, 35.52], [35.88, 34.89], [36.72, 34.73], [40.14, 35.33], [41.22, 37.05]])
    assert.equal(ovActive(true, 15, v(lon, lat)), true, `${lon},${lat}`);
  assert.deepEqual(OV_SY[0], OV_SY.at(-1));
  assert.equal(touchesSyria([13.3, 52.5, 13.5, 52.6]), false);
});
test('report / remove: hides locally, sends one anonymous event via the mocked track()', () => {
  const mem = new Map(), store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  const sent = [], track = (type, props) => sent.push([type, props]);
  assert.equal(ovReport('', 'private', { store, track }), false);
  assert.equal(ovReport('abc123', 'spam', { store, track }), false);
  assert.equal(sent.length, 0);
  assert.equal(ovReport('abc123', 'private', { store, track }), true); // mock track() does not confirm queueing → only hidden
  assert.ok(ovHidden(store).has('abc123'));
  assert.deepEqual(JSON.parse(mem.get(OV_HIDE_KEY)), ['abc123']);
  assert.deepEqual(sent, [['layer', { k: 'ov_report', id: 'abc123', r: 'private' }]]);
  assert.equal(ovReport('def', 'closed', { store }), true); // no analytics → still hidden locally
  assert.deepEqual([...ovHidden(store)], ['abc123', 'def']);
  assert.equal(ovHidden({ getItem: () => '{bad' }).size, 0);
  const an = readFileSync(new URL('../../js/analytics.js', import.meta.url), 'utf8');
  assert.match(an, /ALLOWED = new Set\([^)]*'layer'/); // 'layer' is an allowed kh_events type
  const pl = readFileSync(new URL('../../js/place.js', import.meta.url), 'utf8');
  assert.match(pl, /ovReport\(item\.ovId, b\.dataset\.r, \{ track \}\)/);
  assert.match(readFileSync(new URL('../../css/app.css', import.meta.url), 'utf8'), /\.ov-report \.abtn\{min-height:44px;min-width:44px\}/);
});

test('QA P3: report toast only claims a report when analytics queued it; neutral wording (no "anonymous")', () => {
  const mem = new Map(), store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  assert.equal(ovReport('q1', 'wrong', { store, track: () => true }), 'queued');
  assert.equal(ovReport('q2', 'wrong', { store, track: () => false }), true); // analytics off (DNT/opt-out)
  assert.equal(ovReport('q3', 'wrong', { store, track: () => { throw new Error('x'); } }), true);
  assert.deepEqual([...ovHidden(store)], ['q1', 'q2', 'q3']);
  const pl = readFileSync(new URL('../../js/place.js', import.meta.url), 'utf8');
  assert.match(pl, /t\(res === 'queued' \? 'ovReportQueued' : 'ovReported'\)/);
  const an = readFileSync(new URL('../../js/analytics.js', import.meta.url), 'utf8');
  assert.match(an, /if \(OFF \|\| !ALLOWED\.has\(type\)\) return false;/);
  assert.match(an, /return true; \/\/ queued/);
  const src = readFileSync(new URL('../../js/i18n.js', import.meta.url), 'utf8');
  const vals = [...src.matchAll(/ovReport(?:ed|Queued): '([^']*)'/g)].map(m => m[1]);
  assert.equal(vals.length, 6);
  for (const v of vals) assert.doesNotMatch(v, /anonym|دون هوية|sent anonymously/i);
  for (const v of vals.filter((_, i) => i % 2 === 0)) assert.doesNotMatch(v, /sent|gesendet|أُرسل|Meldung|report/i); // plain 'hidden' text
  assert.match(src, /ovReported: 'Ort auf diesem Gerät ausgeblendet\.'/);
});
test('QA P3 data: no junk names, no webmail/tracking links, no near-duplicates, no mixed stacks', () => {
  const foreign = /[\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0900-\u0dff\u0e00-\u0eff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
  const paren = /\([^)]*\b(i syrien|kulle|berg|wadi|lat \d|long \d)\b[^)]*\)/i;
  const track = /[?&](utm_[a-z_]+|fbclid|gclid|igsh|igshid|stkn|wa_status_inline|g_st|authuser|_sg|mibextid)=|instagram\.com\/[^?]*\?(.*&)?r=/i;
  const webmail = /^https?:\/\/([a-z0-9-]+\.)*(mail\.live\.com|hotmail\.com|outlook\.|mail\.google\.com|gmail\.com|mail\.yahoo\.com)/i;
  for (const r of rows) {
    assert.doesNotMatch(r[3], foreign, r[3]);
    assert.doesNotMatch(r[3], paren, r[3]);
    assert.doesNotMatch(r[3], /^(Tall|Wādī|Jabal)\b/, r[3]);
    for (const u of r.slice(6)) { if (!u) continue; assert.doesNotMatch(u, track, u); assert.doesNotMatch(u, webmail, u); }
  }
  const norm = s => s.toLowerCase().replace(/[\u064b-\u065f\u0640]|[^\p{L}\p{N}]/gu, '');
  const seen = new Map();
  for (const r of rows) {
    const k = norm(r[3]);
    for (const o of seen.get(k) || []) {
      const d = Math.hypot((o[1] - r[1]) * 111320, (o[0] - r[0]) * 111320 * Math.cos(r[1] * Math.PI / 180));
      if (ix.groups[o[4]][0] === ix.groups[r[4]][0]) assert.ok(d > 200, `${r[3]} duplicated ${Math.round(d)} m apart`);
    }
    seen.set(k, [...(seen.get(k) || []), r]);
  }
  const at = new Map();
  for (const r of rows) { const k = r[0] + ',' + r[1]; at.set(k, [...(at.get(k) || []), ix.groups[r[4]][0]]); }
  for (const [k, g] of at) assert.equal(new Set(g).size, 1, `mixed stack at ${k}`);
});
