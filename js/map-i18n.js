// Khareeta · map label language + theme helpers for MapLibre GL JS v5.
// Copy to /js/map-i18n.js. See DESIGN.md §3.9 and §6.
//
//   import { initRTL, labelExpression, applyMapLanguage, styleUrlFor } from './map-i18n.js';
//   initRTL('vendor/rtl-text/mapbox-gl-rtl-text.js');           // BEFORE new maplibregl.Map()
//   const map = new maplibregl.Map({ container: 'map', style: await loadStyle(theme), ... });
//   map.on('style.load', () => applyMapLanguage(map, uiLang));   // run after every setStyle()

/** Load the RTL plugin eagerly: Syrian OSM `name` tags are Arabic, so Arabic labels appear in every UI language. */
export function initRTL(url) {
  const ml = window.maplibregl;
  if (!ml || ml.getRTLTextPluginStatus?.() !== 'unavailable') return;
  ml.setRTLTextPlugin(url, false /* lazy=false: load now */).catch((e) => console.warn('RTL plugin failed', e));
}

/** Label expression per UI language. Fallback chain always ends at the local `name`. */
export function labelExpression(lang) {
  switch (lang) {
    case 'ar': return ['coalesce', ['get', 'name:ar'], ['get', 'name']];
    case 'de': return ['coalesce', ['get', 'name:de'], ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
    default:   return ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
  }
}

/** Places get a second, smaller line with the Arabic original in en/de (helps match street signs in Syria). */
const BILINGUAL_LAYERS = new Set(['place-city', 'place-town', 'place-village', 'place-neighbourhood']);
function bilingual(primary) {
  return ['case',
    ['all', ['has', 'name:ar'], ['!=', primary, ['get', 'name:ar']]],
    ['format', primary, {}, '\n', {}, ['get', 'name:ar'], { 'font-scale': 0.8 }],
    primary];
}

/**
 * Rewrites text-field on every layer tagged metadata["khareeta:label"] === true.
 * Layers with a ['format', ...] text-field (e.g. label-peak) keep their structure; only the name part is replaced.
 */
export function applyMapLanguage(map, lang, { bilingualPlaces = true } = {}) {
  const expr = labelExpression(lang);
  // getLayersOrder()/getLayer() avoid map.getStyle(), which deep-copies the whole style on every call
  const layers = map.getLayersOrder ? map.getLayersOrder().map(id => map.getLayer(id)) : map.getStyle().layers;
  for (const layer of layers) {
    if (!layer || layer.type !== 'symbol' || layer.metadata?.['khareeta:label'] !== true) continue;
    const current = map.getLayoutProperty(layer.id, 'text-field');
    if (current === undefined) continue;
    let next = expr;
    if (Array.isArray(current) && current[0] === 'format') { next = current.slice(); next[1] = expr; }
    else if (bilingualPlaces && lang !== 'ar' && BILINGUAL_LAYERS.has(layer.id)) next = bilingual(expr);
    map.setLayoutProperty(layer.id, 'text-field', next);
  }
}

/** Resolve the style URL for a theme. theme: 'light' | 'dark' | 'system'. */
export function styleUrlFor(theme, base = './') {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  return `${base}map-style-${dark ? 'dark' : 'light'}.json`;
}

/**
 * MapLibre requires an absolute sprite URL. The style JSON ships with "./sprites/khareeta-<theme>" so it stays
 * deployable under any path; this resolves it against the page URL (works offline too: the SW caches /sprites/*).
 */
export function absolutizeSprite(style) {
  if (typeof style.sprite === 'string' && !/^[a-z]+:/i.test(style.sprite)) style.sprite = new URL(style.sprite, location.href).href;
  return style;
}

/** Fetch a theme style as an object ready for new maplibregl.Map({ style }). */
export async function loadStyle(theme, base = './') {
  const res = await fetch(styleUrlFor(theme, base));
  return absolutizeSprite(await res.json());
}

/**
 * Switch theme without losing route/app sources: MapLibre v5 setStyle(..., {transformStyle}) keeps app data.
 */
export function switchMapTheme(map, theme, lang) {
  map.setStyle(styleUrlFor(theme), {
    diff: true,
    transformStyle: (prev, next) => {
      absolutizeSprite(next);
      if (prev?.sources?.['khareeta-route']) next.sources['khareeta-route'] = prev.sources['khareeta-route'];
      return next;
    },
  });
  map.once('style.load', () => applyMapLanguage(map, lang));
}
