// Printable map / route export (HTML → window.print / Save as PDF). No servers, no API keys.
// Reuses MapLibre canvas capture from share-image.js. Honours data-saver (no new network).
import { t, getLang } from './i18n.js';
import { toast, settings, fmtDist, fmtDur } from './util.js';
import { track } from './analytics.js';
import { App } from './core.js';
import {
  MAP_EXPORT_I18N, PRINT_ATTR, buildPrintHtml, normalizePrintMeta, printFilename, safeMapDataUrl,
} from './map-export-core.js';
import { captureMapBitmap, basemapMissing } from './share-image.js';

export { MAP_EXPORT_I18N, buildPrintHtml, normalizePrintMeta };

function isDark() {
  try {
    return document.documentElement.dataset.theme === 'dark'
      || (matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light');
  } catch { return false; }
}

async function bitmapToDataUrl(bmp) {
  if (!bmp) return '';
  const c = document.createElement('canvas');
  const w = bmp.width || bmp.videoWidth || 0;
  const h = bmp.height || bmp.videoHeight || 0;
  if (!w || !h) return '';
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  try { return c.toDataURL('image/png'); } catch { return ''; }
  finally { try { bmp.close?.(); } catch {} }
}

function downloadHtml(html, name) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function openPrintWindow(html) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (!w) {
    URL.revokeObjectURL(url);
    return null;
  }
  // revoke after the print document has loaded
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return w;
}

/**
 * Build printable HTML for a route (summary + map snapshot + turn list).
 * Does not fetch anything – only reads the live map canvas when available.
 */
export async function buildRoutePrintHtml({ map, route, stops = [], modeLabel, lang, dark, autoPrint = true } = {}) {
  const L = lang || getLang();
  const r = route;
  const noMap = basemapMissing(map);
  let mapDataUrl = '';
  if (map && !noMap) {
    try {
      const bmp = await captureMapBitmap(map);
      mapDataUrl = safeMapDataUrl(await bitmapToDataUrl(bmp));
    } catch (e) { console.warn('map-export capture', e); }
  }
  const via = stops.slice(1, -1).map(s => s?.name).filter(Boolean);
  // Prefer caller-provided step texts (route.js passes instr(s)); fall back to s.text / s.instr.
  const steps = (r?.steps || []).map(s => ({
    text: String(s.text || s.instr || '').trim(),
    distLabel: s.distLabel || (s.distance > 0 && s.type !== 'arrive' ? fmtDist(s.distance) : ''),
  })).filter(s => s.text);
  const meta = normalizePrintMeta({
    kind: 'route',
    from: stops[0]?.name || '',
    to: stops.at?.(-1)?.name || stops[stops.length - 1]?.name || '',
    via,
    modeLabel: modeLabel || '',
    durationLabel: r ? fmtDur(r.duration) : '',
    distanceLabel: r ? fmtDist(r.distance) : '',
    title: r ? [fmtDur(r.duration), fmtDist(r.distance), modeLabel].filter(Boolean).join(' · ') : '',
    steps,
  }, L);
  return buildPrintHtml({
    lang: L,
    dark: dark ?? isDark(),
    mapDataUrl,
    noMap: noMap || !mapDataUrl,
    meta,
    attribution: PRINT_ATTR,
    autoPrint,
  });
}

/**
 * Open print dialog (Save as PDF) for the current route, with HTML download fallback.
 * Respects data-saver: no new network; may toast a hint when lowData is on.
 */
export async function printRoute({ map, route, stops, modeLabel } = {}) {
  if (settings.lowData) toast(t('mapExportLowData') || MAP_EXPORT_I18N.en.mapExportLowData);
  let html;
  try {
    html = await buildRoutePrintHtml({
      map: map || App.map,
      route,
      stops,
      modeLabel,
      autoPrint: true,
    });
  } catch (e) {
    console.warn('map-export', e);
    toast(t('mapExportFail') || MAP_EXPORT_I18N.en.mapExportFail);
    track('map_export', { ok: false, kind: 'route' });
    return { ok: false };
  }
  const name = printFilename('route') + '.html';
  const w = openPrintWindow(html);
  if (w) {
    toast(t('mapExportReady') || MAP_EXPORT_I18N.en.mapExportReady);
    track('map_export', { ok: true, kind: 'route', via: 'print' });
    return { ok: true, via: 'print', html };
  }
  downloadHtml(html, name);
  toast(t('mapExportSaved') || MAP_EXPORT_I18N.en.mapExportSaved);
  track('map_export', { ok: true, kind: 'route', via: 'download' });
  return { ok: true, via: 'download', html };
}

/** Place printable (map + name/address; no turn list). */
export async function printPlace({ map, place } = {}) {
  if (settings.lowData) toast(t('mapExportLowData') || MAP_EXPORT_I18N.en.mapExportLowData);
  const L = getLang();
  const noMap = basemapMissing(map || App.map);
  let mapDataUrl = '';
  if ((map || App.map) && !noMap) {
    try {
      const bmp = await captureMapBitmap(map || App.map);
      mapDataUrl = safeMapDataUrl(await bitmapToDataUrl(bmp));
    } catch (e) { console.warn('map-export place capture', e); }
  }
  const meta = normalizePrintMeta({
    kind: 'place',
    name: place?.name || place?.title || '',
    address: place?.address || place?.addr || '',
    coords: place?.lat != null ? `${(+place.lat).toFixed(5)}, ${(+place.lon).toFixed(5)}` : '',
    statusText: place?.ohStatus?.text || '',
  }, L);
  let html;
  try {
    html = buildPrintHtml({
      lang: L,
      dark: isDark(),
      mapDataUrl,
      noMap: noMap || !mapDataUrl,
      meta,
      autoPrint: true,
    });
  } catch (e) {
    toast(t('mapExportFail') || MAP_EXPORT_I18N.en.mapExportFail);
    track('map_export', { ok: false, kind: 'place' });
    return { ok: false };
  }
  const w = openPrintWindow(html);
  if (w) {
    toast(t('mapExportReady') || MAP_EXPORT_I18N.en.mapExportReady);
    track('map_export', { ok: true, kind: 'place', via: 'print' });
    return { ok: true, via: 'print', html };
  }
  downloadHtml(html, printFilename('place') + '.html');
  toast(t('mapExportSaved') || MAP_EXPORT_I18N.en.mapExportSaved);
  track('map_export', { ok: true, kind: 'place', via: 'download' });
  return { ok: true, via: 'download', html };
}
