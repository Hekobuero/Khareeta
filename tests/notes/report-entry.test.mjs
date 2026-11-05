// One "Report…" entry (place + What's here sheets), 429 message, toasts hidden on open, osm_note_sent allowed. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.fetch = () => { throw new Error('network access in tests is forbidden'); };
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const C = await import('../../js/notes-core.js');
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const I = read('js/i18n.js');
const val = (k, i) => [...I.matchAll(new RegExp('^  ' + k + ": '([^']*)'", 'gm'))].map(m => m[1])[i];

test('i18n: Report… + choice strings EN/AR/DE', () => {
  for (const k of ['rmOpen', 'rmKh', 'rmKhSub', 'rmOsm', 'rmOsmSub', 'ntErr_ratelimit']) assert.equal([...I.matchAll(new RegExp('^  ' + k + ':', 'gm'))].length, 3, k);
  assert.deepEqual([0, 1, 2].map(i => val('rmOpen', i)), ['Report…', 'إبلاغ…', 'Melden…']);
  assert.equal(val('rmKh', 2), 'An Khareeta (privat)'); assert.equal(val('rmKhSub', 2), 'Sperrungen, Gefahren – nur für unser Team');
  assert.equal(val('rmOsm', 2), 'Kartenfehler auf OpenStreetMap (öffentlich)'); assert.equal(val('rmOsmSub', 2), 'Für alle sichtbar, hilft der Karte');
  assert.equal(val('ntErr_ratelimit', 2), 'Zu viele Meldungen – bitte in einer Minute erneut');
  assert.match(val('ntErr_ratelimit', 0), /Too many reports/); assert.match(val('ntErr_ratelimit', 1), /دقيقة/);
});
test('place + whats-here: one entry, same icon, no separate report/note buttons, OSM edit link kept', () => {
  const re = read('js/report-entry.js');
  assert.match(re, /REPORT_ICON = 'flag'/); assert.match(re, /ic\(REPORT_ICON\)/); assert.match(re, /rm-edit/);
  for (const [f, id] of [['js/place.js', 'pRm'], ['js/whats-here.js', 'whRm']]) {
    const s = read(f);
    assert.ok(s.includes(`reportEntryHtml('${id}'`) && s.includes(`wireReportEntry(body, '${id}'`), f);
    assert.ok(!/id="(pReport|pNote|whNote)"/.test(s), f + ': old buttons gone');
    assert.ok(!/t\('(rpOpen|ntOpen|rpAddHere)'\)/.test(s), f);
    assert.match(s, /onKh: \(\) => .*openReport/); assert.match(s, /onOsm: \(\) => import\('\.\/notes\.js'\)/);
    assert.match(s, /openstreetmap\.org\/edit/);
  }
  assert.ok(read('sw.js').includes("'js/report-entry.js'"));
});
test('429 → ratelimit (not "rejected"), throttle kept; other 4xx still client', async () => {
  const store = mem();
  const r = await C.makeSender({ store, fetchFn: async () => ({ ok: false, status: 429, json: async () => ({}) }) })({ lat: 1, lon: 1, type: 'road' });
  assert.deepEqual(r, { ok: false, err: 'ratelimit', status: 429 }); assert.ok(C.waitMs(store) > 0);
  assert.match(read('js/notes.js'), /'ratelimit'\]\.includes\(r\.err\)/);
});
test('forms hide old toasts when opened', () => {
  assert.match(read('js/util.js'), /export function hideToast\(\)/);
  assert.match(read('js/notes.js'), /export function openMapNote\(p\) \{\n\s+hideToast\(\)/);
  assert.match(read('js/report.js'), /export function openReport\(item, type\) \{\n\s+hideToast\(\)/);
});
test('analytics: osm_note_sent allowed (props empty), DB constraint too', () => {
  assert.match(read('js/analytics.js'), /const ALLOWED = new Set\(\[[^\]]*'osm_note_sent'/);
  assert.match(read('js/notes.js'), /track\('osm_note_sent', \{\}\)/);
  assert.ok(read('supabase.sql').includes("'osm_note_sent'"));
  assert.ok(read('supabase/migrations/20261107_osm_note_event.sql').includes("'osm_note_sent'"));
});
