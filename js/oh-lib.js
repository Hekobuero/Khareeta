// Lazy bridge to the vendored opening_hours.js (LGPL, ~160 KB gzip). Never on the startup path:
// loaded only when the "Open now" filter is switched on, or a sheet shows opening_hours js/oh.js can't parse.
// Device-local time (Date) is used, as the library evaluates in the browser's time zone.
let lib = null, loading = null;
export const ohLibReady = () => !!lib;
export function loadOHLib(importer = () => import('./vendor/opening_hours.js')) {
  return loading ??= importer().then(m => (lib = m.default || m.opening_hours || m)).catch(e => { loading = null; throw e; });
}
export function _setLib(L) { lib = L; } // tests
const cache = new Map();
/** {open, unknown, closes:Date|null, opens:Date|null} or null if unparsable / not loaded. */
export function libState(str, now = new Date()) {
  if (!lib || !str) return null;
  let oh = cache.get(str);
  if (oh === undefined) { try { oh = new lib(str, null, { mode: 0, warnings_severity: 0 }); } catch { oh = null; } if (cache.size > 500) cache.clear(); cache.set(str, oh); }
  if (!oh) return null;
  try {
    const open = oh.getState(now), unknown = oh.getUnknown(now), next = oh.getNextChange(now) || null;
    return { open: open && !unknown, unknown, closes: open ? next : null, opens: open ? null : next };
  } catch { return null; }
}
