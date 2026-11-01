/* Khareeta service worker – offline app shell + map data cache */
const VERSION = '20261101-2100';
const SHELL = 'kh-shell-' + VERSION;
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
  'data/poi-syria.json',
  'js/route.js',
  'js/search.js',
  'js/ui.js',
  'js/util.js',
  'fonts/inter-latin-400-normal.woff2',
  'fonts/inter-latin-500-normal.woff2',
  'fonts/inter-latin-600-normal.woff2',
  'fonts/inter-latin-700-normal.woff2',
  'fonts/inter-latin-ext-400-normal.woff2',
  'fonts/inter-latin-ext-500-normal.woff2',
  'fonts/inter-latin-ext-600-normal.woff2',
  'fonts/inter-latin-ext-700-normal.woff2',
  'fonts/noto-sans-arabic-arabic-400-normal.woff2',
  'fonts/noto-sans-arabic-arabic-500-normal.woff2',
  'fonts/noto-sans-arabic-arabic-600-normal.woff2',
  'fonts/noto-sans-arabic-arabic-700-normal.woff2',
  'sprites/khareeta-dark.json',
  'sprites/khareeta-dark.png',
  'sprites/khareeta-dark@2x.json',
  'sprites/khareeta-dark@2x.png',
  'sprites/khareeta-dark@3x.json',
  'sprites/khareeta-dark@3x.png',
  'sprites/khareeta-light.json',
  'sprites/khareeta-light.png',
  'sprites/khareeta-light@2x.json',
  'sprites/khareeta-light@2x.png',
  'sprites/khareeta-light@3x.json',
  'sprites/khareeta-light@3x.png',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'];
const TILES = 'kh-tiles', OFFLINE = 'kh-offline', RT = 'kh-rt';
const MAX_TILES = 6000, MAX_AGE = 21 * 864e5;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
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

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = req.url;
  if (isTile(u)) return e.respondWith(tileFetch(req));
  if (isStatic(u)) return e.respondWith(cacheFirst(req, RT));
  if (isStyle(u)) return e.respondWith(networkFirst(req, RT, 6000));
  const url = new URL(u);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req, SHELL, 4000).catch(() => caches.match('index.html')));
    if (url.pathname.endsWith('/admin.html') || url.pathname.includes('/admin')) return;
    return e.respondWith(caches.match(req, { ignoreSearch: true }).then(h => h || fetch(req).then(r => { if (r.ok) { const cl = r.clone(); caches.open(SHELL).then(c => c.put(req, cl)); } return r; })));
  }
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
