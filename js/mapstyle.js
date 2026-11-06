// Map style: Khareeta design styles (map-style-light/dark.json, OpenFreeMap vector tiles) + optional Mapterhorn terrain.
// Labels are rewritten by map-i18n.js applyMapLanguage() after every style load (DESIGN §6).
import { settings } from './util.js';
import { getLang } from './i18n.js';
import { loadStyle, applyMapLanguage } from './map-i18n.js';
import { allowMapExtras, allowStylePrefetch } from './lowdata-core.js';

export const ATTR = {
  mapterhorn: '<a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">© Mapterhorn</a> terrain',
};
const cache = {};

export function getTheme() { try { return localStorage.getItem('k.theme') || 'system'; } catch { return 'system'; } }
export function setTheme(v) {
  try { localStorage.setItem('k.theme', v); } catch {}
  if (v === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
}
export function isDark() {
  const th = getTheme();
  return th === 'dark' || (th === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}
export function mapIsDark() { return settings.style === 'dark' || isDark(); }

export function labelLang() {
  const m = String(settings.mapLang || 'auto').replace('_both', '');
  if (m && m !== 'auto') return m;
  return getLang();
}
export function relabel(map) {
  try { applyMapLanguage(map, labelLang(), { bilingualPlaces: settings.bilingual !== false && labelLang() !== 'ar' }); } catch (e) { console.warn('relabel', e); }
}

export async function buildStyle(kind = settings.style) {
  const theme = mapIsDark() ? 'dark' : 'light';
  if (!cache[theme]) cache[theme] = await loadStyle(theme);
  const style = JSON.parse(JSON.stringify(cache[theme]));
  if (settings.lowData) style.layers = style.layers.filter(l => l.id !== 'building-3d');
  for (const l of style.layers) if (l.id === 'building-3d') (l.layout ||= {}).visibility = (!settings.lowData && settings.b3dOn) ? 'visible' : 'none';
  const terrain = kind === 'terrain';
  // Datensparmodus: no DEM / hillshade / 3D terrain extras (keeps the lighter vector style only).
  if (allowMapExtras(settings) && (terrain || settings.hillshade || settings.terrain3d)) {
    style.sources.dem = { type: 'raster-dem', tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'], tileSize: 512, maxzoom: 12, encoding: 'terrarium', attribution: ATTR.mapterhorn };
    if (terrain || settings.hillshade) {
      const idx = style.layers.findIndex(l => l.id === 'building' || /^road-/.test(l.id));
      style.layers.splice(idx > 0 ? idx : 1, 0, { id: 'hillshade', type: 'hillshade', source: 'dem', paint: {
        'hillshade-exaggeration': terrain ? 0.55 : 0.35,
        'hillshade-shadow-color': theme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(60,50,40,0.5)',
        'hillshade-highlight-color': theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.35)' } });
    }
    if (settings.terrain3d) style.terrain = { source: 'dem', exaggeration: 1.3 };
  }
  return style;
}
export function prefetchStyles() {
  if (!allowStylePrefetch(settings)) return;
  for (const th of ['light', 'dark']) if (!cache[th]) loadStyle(th).then(s => cache[th] = s).catch(() => {});
}
