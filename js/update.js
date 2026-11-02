// Service-worker registration + "New version available – Reload" banner.
// New workers wait (sw.js only skips waiting on the very first install); the page reloads exactly once,
// after the user tapped Reload and the new worker took control. Offline keeps working from the cache.
import { t } from './i18n.js';
import { ic } from './icons.js';

let shown = false;
function banner(reg) {
  if (shown || !reg.waiting || !navigator.serviceWorker.controller) return;
  shown = true;
  const el = document.createElement('div');
  el.id = 'updBar'; el.className = 'updbar'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<span class="updtxt">${t('updateAvail')}</span><button class="updgo" id="updGo">${t('reloadNow')}</button><button class="ib updx" id="updX" aria-label="${t('close')}">${ic('close', 'sm')}</button>`;
  document.body.appendChild(el);
  el.querySelector('#updGo').onclick = () => {
    const w = reg.waiting;
    if (!w) return location.reload();
    reloadOnChange = true;
    w.postMessage('skipWaiting');
    // safety net: if controllerchange never fires (e.g. the worker was already replaced), reload once anyway
    setTimeout(() => { if (!reloaded) { reloaded = true; location.reload(); } }, 4000);
  };
  el.querySelector('#updX').onclick = () => el.remove();
}
let reloadOnChange = false, reloaded = false;
export function registerSW(url = 'sw.js') {
  const sw = navigator.serviceWorker;
  sw.addEventListener('controllerchange', () => {
    if (!reloadOnChange || reloaded) return; // first install / other tab: no automatic reload, so no loop
    reloaded = true; location.reload();
  });
  return sw.register(url).then(reg => {
    banner(reg);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed') banner(reg); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {}); });
    return reg;
  }).catch(e => console.warn('sw', e));
}
