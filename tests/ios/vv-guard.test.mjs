// iOS (DuckDuckGo) focus-zoom guard: pure decision + wiring with a fake visualViewport. No network, no real iPhone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { vvFix, isTextField, VIEWPORT_LOCK } from '../../js/vv-core.js';
import { initVVGuard } from '../../js/vv.js';
const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('focused field + page zoom → relock viewport and scroll back', () => {
  assert.deepEqual(vvFix({ scale: 1.25, offsetTop: 40, offsetLeft: 10 }, { x: 0, y: 0 }, true, true), { meta: true, scroll: true });
});
test('search bar field + only shifted (offset) → scroll back, no relock', () => {
  assert.deepEqual(vvFix({ scale: 1, offsetTop: 60, offsetLeft: 0 }, { x: 0, y: 0 }, true, true), { meta: false, scroll: true });
});
test('sheet field shifted above the keyboard (not zoomed) → left alone', () => {
  assert.deepEqual(vvFix({ scale: 1, offsetTop: 200, offsetLeft: 0 }, { x: 0, y: 0 }, true, false), { meta: false, scroll: false });
});
test('no field focused (map pinch etc.) → never acts', () => {
  assert.deepEqual(vvFix({ scale: 2, offsetTop: 100, offsetLeft: 50 }, { x: 5, y: 5 }, false), { meta: false, scroll: false });
});
test('isTextField', () => {
  assert.ok(isTextField({ tagName: 'INPUT', type: 'search' })); assert.ok(isTextField({ tagName: 'TEXTAREA' }));
  assert.ok(!isTextField({ tagName: 'INPUT', type: 'checkbox' })); assert.ok(!isTextField({ tagName: 'CANVAS' })); assert.ok(!isTextField(null));
});

function fakeEnv() {
  const L = {}, on = (o) => (n, f) => { (o[n] ??= []).push(f); };
  const vvL = {}, docL = {};
  const vv = { scale: 1, offsetTop: 0, offsetLeft: 0, addEventListener: on(vvL) };
  const meta = { c: VIEWPORT_LOCK, setAttribute(_, v) { this.c = v; this.n = (this.n || 0) + 1; } };
  const win = { visualViewport: vv, scrollX: 0, scrollY: 0, scrolls: 0, scrollTo() { this.scrolls++; this.scrollY = 0; }, requestAnimationFrame: f => { f(); return 0; }, setTimeout: (f) => 0 };
  const doc = { activeElement: null, querySelector: () => meta, addEventListener: on(docL) };
  return { vv, vvL, docL, meta, win, doc };
}
test('wiring: zoom while the search field is focused is undone', () => {
  const e = fakeEnv(); initVVGuard(e.win, e.doc);
  const q = { tagName: 'INPUT', type: 'search', closest: s => s === '#top' ? {} : null };
  e.doc.activeElement = q; e.docL.focusin.forEach(f => f({ target: q }));
  e.vv.scale = 1.3; e.vv.offsetTop = 80; e.vvL.resize.forEach(f => f());
  assert.ok(e.meta.n >= 1, 'viewport relocked'); assert.ok(e.win.scrolls >= 1, 'scrolled back');
});
test('wiring: map pinch (no focused field) changes nothing – MapLibre keeps its zoom', () => {
  const e = fakeEnv(); initVVGuard(e.win, e.doc);
  e.doc.activeElement = { tagName: 'CANVAS' }; e.vv.scale = 1.5; e.vvL.resize.forEach(f => f()); e.vvL.scroll.forEach(f => f());
  assert.equal(e.meta.n || 0, 0); assert.equal(e.win.scrolls, 0);
});
test('no global gesturestart block added; no transform on <html>; viewport lock + 16px inputs kept', () => {
  const vv = read('js/vv.js').replace(/^\/\/.*$/gm, ''); assert.doesNotMatch(vv, /gesture|documentElement\.style|transform/);
  const html = read('index.html'); assert.match(html, /maximum-scale=1, user-scalable=no/);
  assert.ok(html.includes(VIEWPORT_LOCK));
  const css = read('css/app.css'); assert.match(css, /input:not\(\[type=checkbox\]\)[^{]*\{font-size:max\(16px/); assert.match(css, /text-size-adjust:100%/);
  assert.match(read('js/app.js'), /initVVGuard\(\)/);
  for (const f of ['js/vv.js', 'js/vv-core.js', 'js/live-core.js']) assert.ok(read('sw.js').includes(`'${f}'`), f + ' in SW shell');
});
