// iOS focus-zoom guard, pure decision (no DOM – tested in tests/ios/vv-guard.test.mjs).
// P0 (Hidro, iPhone DuckDuckGo, live 20261106-1756): DDG's WKWebView ignores maximum-scale=1 / user-scalable=no and
// zooms/shifts the visual viewport when the search field gets focus. The map's own pinch (MapLibre, touch-action:none
// on the canvas) never changes window.visualViewport, so a scaled/shifted visual viewport is always page zoom.
// We only act while a text field is focused (or right after blur) – the map's gestures are never touched.
export const VV_EPS = 0.01;
export const TEXT_INPUT = /^(text|search|email|url|tel|number|password|date|time|datetime-local|month|week)$/;
export function isTextField(el) {
  if (!el || !el.tagName) return false;
  const tg = el.tagName.toUpperCase();
  if (tg === 'TEXTAREA' || tg === 'SELECT') return true;
  if (tg === 'INPUT') return TEXT_INPUT.test(String(el.type || 'text').toLowerCase());
  return !!el.isContentEditable;
}
/** vv: { scale, offsetTop, offsetLeft }, scroll: { x, y } (window.scrollX/Y), active: focused text field or recent blur.
 *  topBar: the focused field sits in the top search bar (#top) – only then a plain shift is undone; a field low in a
 *  sheet may legitimately be scrolled above the keyboard.
 *  → { meta: re-assert the viewport lock (iOS resets the scale), scroll: scroll the layout viewport back to 0,0 } */
export function vvFix(vv, scroll = { x: 0, y: 0 }, active = false, topBar = false) {
  if (!active || !vv) return { meta: false, scroll: false };
  const zoomed = Math.abs((vv.scale || 1) - 1) > VV_EPS;
  const shifted = Math.abs(vv.offsetTop || 0) > 0.5 || Math.abs(vv.offsetLeft || 0) > 0.5 || Math.abs(scroll.x || 0) > 0.5 || Math.abs(scroll.y || 0) > 0.5;
  return { meta: zoomed, scroll: zoomed || (shifted && topBar) };
}
// Same lock as index.html; re-written with a throw-away change so WebKit re-applies it (and drops the focus zoom).
export const VIEWPORT_LOCK = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
