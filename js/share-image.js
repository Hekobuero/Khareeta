// Share place / route as a PNG card. Uses MapLibre canvas capture + share-image-core compose.
// Web Share API with files when available; otherwise download. No server upload.
import { t, getLang } from './i18n.js';
import { toast } from './util.js';
import { track } from './analytics.js';
import { ic } from './icons.js';
import {
  basemapMissing,
  ATTR, CARD_W, MAP_H, SHARE_IMAGE_I18N, composeSharePng, normalizeCardMeta, fmtCoordPair,
} from './share-image-core.js';

export { SHARE_IMAGE_I18N, normalizeCardMeta, fmtCoordPair };

const FILENAME = (kind) => `khareeta-${kind || 'place'}-${Date.now()}.png`;

function isDark() {
  try {
    return document.documentElement.dataset.theme === 'dark'
      || matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
  } catch { return false; }
}

/** Capture the live MapLibre canvas as ImageBitmap / HTMLCanvasElement. */
export async function captureMapBitmap(map, { padPx = 0 } = {}) {
  if (!map) throw new Error('no-map');
  // Force a clean frame with the drawing buffer preserved
  try { map.triggerRepaint?.(); } catch {}
  await new Promise(r => {
    let done = false;
    const fin = () => { if (done) return; done = true; r(); };
    try { map.once?.('idle', fin); } catch { setTimeout(fin, 80); }
    setTimeout(fin, 600);
  });
  const canvas = map.getCanvas?.();
  if (!canvas) throw new Error('no-canvas');
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(canvas); } catch { /* fall through */ }
  }
  // clone to a new canvas so we own the pixels after WebGL may clear
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  return c;
}

/**
 * Offline and no basemap tiles rendered (nothing cached for this view)? Then the card would show a blank band:
 * we label it and toast a hint. Online we never claim "no map".
 */
export { basemapMissing };

export async function buildShareBlob({ map, meta, lang, dark, noMap }) {
  const mapImage = map ? await captureMapBitmap(map) : null;
  return composeSharePng({
    noMap: !!noMap,
    mapImage,
    meta,
    lang: lang || getLang(),
    dark: dark ?? isDark(),
    width: CARD_W,
    mapH: MAP_H,
    attribution: ATTR,
  });
}

function canShareFiles(file) {
  try {
    return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
  } catch { return false; }
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function tryClipboard(blob) {
  try {
    if (!navigator.clipboard || !window.ClipboardItem) return false;
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch { return false; }
}

/**
 * Compose + share/download a place or route PNG.
 * track() only gets {ok, via} — never coords/names/addresses.
 */
export async function shareAsImage({ map, meta, lang } = {}) {
  const L = lang || getLang();
  let blob;
  const noMap = basemapMissing(map);
  if (noMap) toast(t('shareImageNoMap') || SHARE_IMAGE_I18N.en.shareImageNoMap);
  try {
    blob = await buildShareBlob({ map, meta, lang: L, noMap });
  } catch (e) {
    console.warn('share-image', e);
    toast(t('shareImageFail') || SHARE_IMAGE_I18N.en.shareImageFail);
    track('share_image', { ok: false });
    return { ok: false };
  }
  const file = new File([blob], FILENAME(meta?.kind), { type: 'image/png' });
  if (canShareFiles(file)) {
    try {
      await navigator.share({
        files: [file],
        title: 'Khareeta',
        text: meta?.kind === 'route' ? (meta.title || '') : (meta?.name || ''),
      });
      track('share_image', { ok: true, via: 'share' });
      return { ok: true, via: 'share', blob };
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, via: 'abort' };
      // fall through to download
    }
  }
  downloadBlob(blob, file.name);
  const copied = await tryClipboard(blob);
  toast(copied
    ? (t('shareImageCopyOk') || SHARE_IMAGE_I18N.en.shareImageCopyOk)
    : (t('shareImageSaved') || SHARE_IMAGE_I18N.en.shareImageSaved));
  track('share_image', { ok: true, via: copied ? 'download+copy' : 'download' });
  return { ok: true, via: copied ? 'download+copy' : 'download', blob };
}

/** Build a short action-row button (icon + label). */
export function shareImageBtn({ id = 'pShareImg', label } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'abtn';
  b.id = id;
  b.innerHTML = `${ic('image')}<span>${label || t('shareImageShort')}</span>`;
  return b;
}

/** Build meta from a place sheet / whats-here payload. */
export function placeMetaFrom(p = {}) {
  const oh = p.ohStatus || p.status || null;
  return normalizeCardMeta({
    kind: 'place',
    name: p.name || p.title || '',
    address: p.address || p.addr || '',
    lat: p.lat, lon: p.lon,
    coords: p.coords,
    statusText: oh?.text || oh?.label || (typeof oh === 'string' ? oh : ''),
    statusCls: oh?.cls || oh?.kind || '',
  }, getLang());
}

/** Build meta from the live route state. */
export function routeMetaFrom(rs = {}, labels = {}) {
  return normalizeCardMeta({
    kind: 'route',
    from: rs.fromLabel || rs.from || labels.from || '',
    to: rs.toLabel || rs.to || labels.to || '',
    via: rs.viaLabels || rs.via || labels.via || [],
    modeLabel: labels.mode || rs.modeLabel || '',
    durationLabel: labels.duration || rs.durationLabel || '',
    distanceLabel: labels.distance || rs.distanceLabel || '',
    title: labels.title || '',
  }, getLang());
}
