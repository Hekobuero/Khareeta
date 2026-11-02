/* Khareeta service worker – offline app shell + map data cache */
const VERSION = '20261102-2102';
const SHELL = 'kh-shell-' + VERSION;
// Minimal app shell: what the first screen needs to boot offline (≈1.8 MB raw, mostly revalidated 304s on the
// first visit because the page has just loaded the same files). Fonts, sprites, logos, icons and the POI data
// are cached at runtime (stale-while-revalidate, cache ASSETS) – including the ones the page loaded before this
// worker took control (see 'warm' below).
const SHELL_FILES = [
  './',
  'index.html',
  'css/tokens.css',
  'css/app.css',
  'manifest.webmanifest',
  'map-style-light.json',
  'map-style-dark.json',
  'vendor/maplibre-gl/maplibre-gl.js',
  'vendor/maplibre-gl/maplibre-gl.css',
  'vendor/rtl-text/mapbox-gl-rtl-text.js',
  'js/analytics.js',
  'js/app.js',
  'js/core.js',
  'js/fmt.js',
  'js/hours.js',
  'js/i18n.js',
  'js/icons.js',
  'js/map-i18n.js',
  'js/mapstyle.js',
  'js/offline.js',
  'js/place.js',
  'js/poi.js',
  'js/route.js',
  'js/search.js',
  'js/suggest.js',
  'js/ui.js',
  'js/update.js',
  'js/util.js',
  'fonts/glyphs-empty.pbf',
  'icons/icon.svg',
  'icons/icon-192.png'];
const TILES = 'kh-tiles', OFFLINE = 'kh-offline', RT = 'kh-rt', ASSETS = 'kh-assets';
const MAX_TILES = 6000, MAX_AGE = 21 * 864e5;

async function hasBanner() {
  for (const k of await caches.keys()) if (k.startsWith('kh-shell-') && k !== SHELL && await (await caches.open(k)).match('js/update.js')) return true;
  return false;
}
// Older builds precached fonts, sprites and the POI data in their versioned shell cache, which 'activate' deletes:
// carry those entries over to the runtime cache first, so an update never loses offline icons, fonts or POIs.
async function migrate() {
  try {
    const dst = await caches.open(ASSETS);
    for (const k of await caches.keys()) {
      if (!k.startsWith('kh-shell-') || k === SHELL) continue;
      const src = await caches.open(k);
      for (const req of await src.keys()) {
        const p = new URL(req.url).pathname;
        if (!isAsset(p) || await dst.match(assetKey(req.url))) continue;
        const r = await src.match(req); if (r) await dst.put(assetKey(req.url), r);
      }
    }
  } catch {}
}
self.addEventListener('install', e => {
  // 'no-cache' = revalidate with the server (ETag) instead of re-downloading: files the page just loaded come back as 304.
  // Updates wait for the page's "Reload" banner (js/update.js), so an open tab never mixes old and new modules.
  // Skip waiting only on the first install, or when the running version has no banner yet (older build).
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(f => new Request(f, { cache: 'no-cache' })))).then(migrate).then(async () => {
    if (!self.registration.active || !(await hasBanner())) return self.skipWaiting();
  }));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('kh-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const tileKey = u => u.replace(/^(https:\/\/tiles\.openfreemap\.org\/planet)\/[^/]+\//, '$1/_/');
const isTile = u => /tiles\.openfreemap\.org\/(planet|natural_earth)\//.test(u) || /tiles\.mapterhorn\.com\/\d/.test(u);
const isStatic = u => /tiles\.openfreemap\.org\/(fonts|sprites)\//.test(u);
const isStyle = u => /tiles\.openfreemap\.org\/(styles\/|planet$)/.test(u) || /tiles\.mapterhorn\.com\/tilejson/.test(u);

let puts = 0;
async function trim() {
  const c = await caches.open(TILES); const ks = await c.keys();
  if (ks.length > MAX_TILES) for (const k of ks.slice(0, ks.length - MAX_TILES + 500)) await c.delete(k);
}
async function tileFetch(req) {
  const key = tileKey(req.url);
  const hit = (await caches.match(key, { cacheName: OFFLINE })) || (await caches.match(key, { cacheName: TILES }));
  const fresh = hit && Date.now() - (+hit.headers.get('x-kh-date') || 0) < MAX_AGE;
  if (hit && (fresh || !navigator.onLine)) return hit;
  try {
    const r = await fetch(req);
    if (r.ok) {
      const blob = await r.clone().blob();
      const res = new Response(blob, { headers: { 'Content-Type': r.headers.get('Content-Type') || '', 'x-kh-date': String(Date.now()) } });
      const target = hit && (await caches.open(OFFLINE).then(c => c.match(key))) ? OFFLINE : TILES;
      caches.open(target).then(c => c.put(key, res)).then(() => { if (++puts % 200 === 0) trim(); });
    }
    return r;
  } catch (e) { if (hit) return hit; throw e; }
}
async function cacheFirst(req, name) {
  const hit = await caches.match(tileKey(req.url));
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) { const c = await caches.open(name); c.put(tileKey(req.url), r.clone()); }
  return r;
}
async function networkFirst(req, name, timeout = 5000) {
  const c = await caches.open(name);
  try {
    const r = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout))]);
    if (r.ok) c.put(req, r.clone());
    return r;
  } catch (e) {
    const hit = await c.match(req) || await caches.match(req);
    if (hit) return hit;
    throw e;
  }
}

// ----- runtime assets: stale-while-revalidate -----
const isAsset = p => /\/(fonts\/[^/]+\.woff2|sprites\/[^/]+|data\/(poi\/)?[^/]+\.json|icons\/[^/]+\.(png|svg)|favicon[^/]*)$/.test(p) && !p.endsWith('/icons/og-image.png');
const assetKey = u => { const x = new URL(u); x.search = ''; x.hash = ''; return x.href; };
async function swr(req, e) {
  const key = assetKey(req.url), c = await caches.open(ASSETS);
  const hit = (await c.match(key)) || (await caches.match(key, { ignoreSearch: true }));
  const net = fetch(req).then(r => { if (r.ok && r.status === 200) return c.put(key, r.clone()).then(() => r); return r; });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}
// The page sends the same-origin assets it loaded before this worker controlled it (first visit). They are copied
// from the browser's HTTP cache (no second download) so fonts, sprites and POIs work offline after one visit.
async function warm(urls) {
  const c = await caches.open(ASSETS);
  for (const u of urls) {
    let url; try { url = new URL(u, self.registration.scope); } catch { continue; }
    if (url.origin !== location.origin || !isAsset(url.pathname)) continue;
    const key = assetKey(url.href);
    if (await caches.match(key, { ignoreSearch: true })) continue;
    try { const r = await fetch(key); if (r.ok && r.status === 200) await c.put(key, r); } catch {}
  }
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = req.url;
  if (isTile(u)) return e.respondWith(tileFetch(req));
  if (isStatic(u)) return e.respondWith(cacheFirst(req, RT));
  if (isStyle(u)) return e.respondWith(networkFirst(req, RT, 6000));
  const url = new URL(u);
  if (url.origin === location.origin) {
    // SEO / sharing files: always straight from the network, never cached by the SW (no offline fallback to index.html)
    if (/\/(robots\.txt|sitemap\.xml)$/.test(url.pathname) || url.pathname.endsWith('/icons/og-image.png')) return;
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req, SHELL, 4000).catch(() => caches.match('index.html')));
    if (url.pathname.endsWith('/admin.html') || url.pathname.includes('/admin')) return;
    if (isAsset(url.pathname)) return e.respondWith(swr(req, e));
    return e.respondWith(caches.match(req, { ignoreSearch: true }).then(h => h || fetch(req).then(r => { if (r.ok) { const cl = r.clone(); caches.open(SHELL).then(c => c.put(req, cl)); } return r; })));
  }
});
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  else if (e.data && e.data.type === 'warm' && Array.isArray(e.data.urls)) e.waitUntil(warm(e.data.urls.slice(0, 200)));
});
