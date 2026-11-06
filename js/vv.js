// Wires js/vv-core.js: undo iOS focus-zoom / visual-viewport shift of the page UI (DuckDuckGo iOS, older WKWebViews).
// No gesturestart blocking here and no transform on <html> – MapLibre keeps its own pinch and its coordinates.
import { vvFix, isTextField, VIEWPORT_LOCK } from './vv-core.js';
export function initVVGuard(win = window, doc = document) {
  const vv = win.visualViewport; if (!vv) return null;
  const meta = doc.querySelector('meta[name=viewport]');
  let blurT = 0, raf = 0, lastTop = false;
  const active = () => isTextField(doc.activeElement) || Date.now() < blurT;
  const relock = () => { if (!meta) return; meta.setAttribute('content', VIEWPORT_LOCK.replace('initial-scale=1', 'initial-scale=1.0')); win.setTimeout(() => meta.setAttribute('content', VIEWPORT_LOCK), 30); };
  const run = () => {
    raf = 0;
    const f = vvFix({ scale: vv.scale, offsetTop: vv.offsetTop, offsetLeft: vv.offsetLeft }, { x: win.scrollX, y: win.scrollY }, active(), !!doc.activeElement?.closest?.('#top') || lastTop);
    if (f.meta) relock();
    if (f.scroll) win.scrollTo(0, 0);
    return f;
  };
  const queue = () => { if (!raf) raf = win.requestAnimationFrame(run); };
  vv.addEventListener('resize', queue); vv.addEventListener('scroll', queue);
  doc.addEventListener('focusin', e => { if (isTextField(e.target)) { lastTop = !!e.target.closest?.('#top'); queue(); win.setTimeout(queue, 350); } });
  doc.addEventListener('focusout', e => { if (isTextField(e.target)) { blurT = Date.now() + 800; win.setTimeout(queue, 60); win.setTimeout(queue, 400); } });
  return { run };
}
