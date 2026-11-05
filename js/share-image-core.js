// Share-as-image card composition (pure helpers + canvas drawing). No MapLibre, no network.
// Used by js/share-image.js and tests/share/share-image.test.mjs.
// Attribution stays ON the card (OSM / OpenFreeMap / OpenMapTiles), matching the in-app credit.

export const CARD_W = 1200;
export const MAP_H = 780;
export const INFO_MIN = 200;
export const PAD = 40;
export const RADIUS = 28;
export const ATTR = '© OpenStreetMap contributors · OpenFreeMap · © OpenMapTiles';
export const BRAND = 'Khareeta · خريطة';

export const SHARE_IMAGE_I18N = {
  en: {
    shareAsImage: 'Share as image',
    shareImageShort: 'Image',
    shareImageSaved: 'Image saved',
    shareImageFail: 'Could not create the image',
    shareImageCopyOk: 'Image copied',
    shareFrom: 'From',
    shareTo: 'To',
    shareViaStops: 'Via',
    coords: 'Coordinates',
    shareImageNoMap: 'Map not saved offline – text only',
  },
  ar: {
    shareAsImage: 'مشاركة كصورة',
    shareImageShort: 'صورة',
    shareImageSaved: 'تم حفظ الصورة',
    shareImageFail: 'تعذّر إنشاء الصورة',
    shareImageCopyOk: 'تم نسخ الصورة',
    shareFrom: 'من',
    shareTo: 'إلى',
    shareViaStops: 'عبر',
    coords: 'الإحداثيات',
    shareImageNoMap: 'الخريطة غير محفوظة دون اتصال – نص فقط',
  },
  de: {
    shareAsImage: 'Als Bild teilen',
    shareImageShort: 'Bild',
    shareImageSaved: 'Bild gespeichert',
    shareImageFail: 'Bild konnte nicht erstellt werden',
    shareImageCopyOk: 'Bild kopiert',
    shareFrom: 'Von',
    shareTo: 'Nach',
    shareViaStops: 'Über',
    coords: 'Koordinaten',
    shareImageNoMap: 'Karte nicht offline gespeichert – nur Text',
  },
};

/** Unicode first-strong isolate (FSI … PDI): keeps «Von: مسجد…» readable in LTR and «من: Omari» in RTL. */
export const FSI = '\u2068', PDI = '\u2069';
export const isolate = (v) => FSI + String(v ?? '') + PDI;
/** "Label: value" with the value bidi-isolated (canvas has no <bdi>). */
export const labelValue = (label, value) => `${label}: ${isolate(value)}`;
/** After wrapping, every line must carry balanced isolates (a split can leave FSI or PDI alone). */
export function balanceIsolates(line) {
  let s = String(line), depth = 0, opensNeeded = 0;
  for (const ch of s) {
    if (ch === FSI) depth++;
    else if (ch === PDI) { if (depth) depth--; else opensNeeded++; }
  }
  return FSI.repeat(opensNeeded) + s + PDI.repeat(depth);
}

const tr = (lang, k) => (SHARE_IMAGE_I18N[lang] || SHARE_IMAGE_I18N.en)[k] ?? SHARE_IMAGE_I18N.en[k];

export const THEME = {
  light: {
    surface: '#FFFFFF', text: '#1C1C1E', text2: '#5C5C63', text3: '#76767E',
    sep: 'rgba(60,60,67,.14)', accent: '#0A66D6', success: '#187436', danger: '#C5221F',
    warn: '#A05A00', attrBg: 'rgba(255,255,255,.82)', mapFallback: '#E8E6E1',
  },
  dark: {
    surface: '#1C1C1E', text: '#F5F5F7', text2: '#AEAEB5', text3: '#8E8E96',
    sep: 'rgba(235,235,245,.12)', accent: '#5AA2FF', success: '#4CC274', danger: '#FF6B61',
    warn: '#F2A33A', attrBg: 'rgba(28,28,30,.82)', mapFallback: '#2C2C2E',
  },
};

/** Round lat/lon for display (5 decimals, same as share links). */
export const fmtCoordPair = (lat, lon) =>
  (Number.isFinite(+lat) && Number.isFinite(+lon)) ? `${(+lat).toFixed(5)}, ${(+lon).toFixed(5)}` : '';

/**
 * Normalise place/route payload for the card.
 * Place: { kind:'place', name, address?, lat, lon, statusText?, statusCls? }
 * Route: { kind:'route', from, to, via?, modeLabel, durationLabel?, distanceLabel? }
 */
export function normalizeCardMeta(raw = {}, lang = 'en') {
  const kind = raw.kind === 'route' ? 'route' : 'place';
  if (kind === 'route') {
    const via = Array.isArray(raw.via) ? raw.via.filter(Boolean).map(s => String(s).trim()).filter(Boolean).slice(0, 4) : [];
    return {
      kind: 'route',
      from: String(raw.from || '').trim().slice(0, 120) || '—',
      to: String(raw.to || '').trim().slice(0, 120) || '—',
      via,
      modeLabel: String(raw.modeLabel || '').trim().slice(0, 40),
      durationLabel: String(raw.durationLabel || '').trim().slice(0, 40),
      distanceLabel: String(raw.distanceLabel || '').trim().slice(0, 40),
      title: String(raw.title || '').trim().slice(0, 120),
    };
  }
  return {
    kind: 'place',
    name: String(raw.name || tr(lang, 'coords')).trim().slice(0, 120) || tr(lang, 'coords'),
    address: String(raw.address || '').trim().slice(0, 160),
    coords: raw.coords || fmtCoordPair(raw.lat, raw.lon),
    statusText: raw.statusText ? String(raw.statusText).trim().slice(0, 80) : '',
    statusCls: raw.statusCls === 'open' || raw.statusCls === 'soon' || raw.statusCls === 'closed' ? raw.statusCls : '',
  };
}

export function wrapLines(measure, text, maxW, maxLines = 3) {
  const s = String(text || '').trim();
  if (!s) return [];
  const words = s.split(/\s+/);
  const lines = [];
  let cur = '';
  const push = (line) => { if (line) lines.push(line); };
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (measure(trial) <= maxW || !cur) cur = trial;
    else { push(cur); cur = w; if (lines.length >= maxLines - 1) break; }
  }
  if (lines.length < maxLines) push(cur);
  else if (cur) {
    // ellipsis on last line
    let last = lines[lines.length - 1] || cur;
    while (last.length > 1 && measure(last + '…') > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  // leftover when we broke early
  if (lines.length >= maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[lines.length - 1];
    if (!last.endsWith('…')) {
      while (last.length > 1 && measure(last + '…') > maxW) last = last.slice(0, -1);
      lines[lines.length - 1] = last + '…';
    }
  }
  return lines.slice(0, maxLines);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function statusColor(th, cls) {
  if (cls === 'open') return th.success;
  if (cls === 'closed') return th.danger;
  if (cls === 'soon') return th.warn;
  return th.text2;
}

/**
 * Draw the share card onto an existing 2d context (or a mock that implements the same subset).
 * `mapImage` is optional (CanvasImageSource / ImageBitmap). Without it the map area is a solid fallback.
 * Returns { width, height, attribution }.
 */
export function drawShareCard(ctx, {
  mapImage = null,
  meta: rawMeta = {},
  lang = 'en',
  dark = false,
  width = CARD_W,
  mapH = MAP_H,
  attribution = ATTR,
  brand = BRAND,
  noMap = false,
} = {}) {
  const th = dark ? THEME.dark : THEME.light;
  const rtl = lang === 'ar';
  const meta = normalizeCardMeta(rawMeta, lang);
  const font = rtl
    ? '"Noto Sans Arabic", "Inter", system-ui, sans-serif'
    : '"Inter", "Noto Sans Arabic", system-ui, sans-serif';
  const measure = (txt, size = 28, weight = 500) => {
    ctx.font = `${weight} ${size}px ${font}`;
    return (ctx.measureText(String(txt)).width) || 0;
  };

  const maxText = width - PAD * 2;
  const lines = [];
  if (meta.kind === 'route') {
    const head = meta.title || [meta.durationLabel, meta.distanceLabel, meta.modeLabel].filter(Boolean).join(' · ');
    if (head) lines.push({ text: head, size: 36, weight: 700, color: th.text });
    lines.push({ text: labelValue(tr(lang, 'shareFrom'), meta.from), size: 26, weight: 500, color: th.text });
    if (meta.via.length) lines.push({ text: `${tr(lang, 'shareViaStops')}: ${meta.via.map(isolate).join(' · ')}`, size: 24, weight: 500, color: th.text2 });
    lines.push({ text: labelValue(tr(lang, 'shareTo'), meta.to), size: 26, weight: 500, color: th.text });
  } else {
    lines.push({ text: meta.name, size: 40, weight: 700, color: th.text });
    if (meta.address) lines.push({ text: meta.address, size: 26, weight: 500, color: th.text2 });
    if (meta.statusText) lines.push({ text: meta.statusText, size: 24, weight: 600, color: statusColor(th, meta.statusCls), status: true });
    if (meta.coords) lines.push({ text: meta.coords, size: 22, weight: 500, color: th.text3, ltr: true });
  }

  // expand wrapped lines for height
  const drawn = [];
  for (const L of lines) {
    const wrapped = wrapLines(t => measure(t, L.size, L.weight), L.text, maxText, L.size >= 36 ? 2 : 3);
    for (const w of wrapped) drawn.push({ ...L, text: balanceIsolates(w) });
  }
  const lineGap = 10;
  const textH = drawn.reduce((h, L) => h + L.size + lineGap, 0);
  const infoH = Math.max(INFO_MIN, PAD + textH + 28 + 22); // brand row
  const height = mapH + infoH;

  if (ctx.canvas) { ctx.canvas.width = width; ctx.canvas.height = height; }
  // background
  ctx.fillStyle = th.surface;
  roundRect(ctx, 0, 0, width, height, RADIUS);
  ctx.fill();

  // clip map area (top rounded)
  ctx.save();
  roundRect(ctx, 0, 0, width, mapH + RADIUS, RADIUS);
  ctx.clip();
  ctx.fillStyle = th.mapFallback;
  ctx.fillRect(0, 0, width, mapH);
  if (mapImage) {
    try {
      // cover-fit the map bitmap into the map band
      const iw = mapImage.width || mapImage.videoWidth || width;
      const ih = mapImage.height || mapImage.videoHeight || mapH;
      const scale = Math.max(width / iw, mapH / ih);
      const dw = iw * scale, dh = ih * scale;
      const dx = (width - dw) / 2, dy = (mapH - dh) / 2;
      ctx.drawImage(mapImage, dx, dy, dw, dh);
    } catch { /* solid fallback already painted */ }
  }
  if (noMap) {
    // offline + no cached tiles: say so on the card instead of an unexplained blank band
    const hint = tr(lang, 'shareImageNoMap');
    ctx.font = `600 30px ${font}`;
    ctx.fillStyle = th.text2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.fillText(hint, width / 2, mapH / 2, width - PAD * 2);
  }
  // soft fade into info panel
  const fade = ctx.createLinearGradient?.(0, mapH - 48, 0, mapH);
  if (fade) {
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, dark ? 'rgba(0,0,0,.35)' : 'rgba(0,0,0,.12)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, mapH - 48, width, 48);
  }
  // attribution pill ON the map (always visible)
  const attr = String(attribution || ATTR);
  ctx.font = `600 18px ${font}`;
  const attrW = Math.min(measure(attr, 18, 600) + 24, width - 24);
  const attrH = 28;
  const attrX = rtl ? width - 16 - attrW : 16;
  const attrY = mapH - attrH - 14;
  ctx.fillStyle = th.attrBg;
  roundRect(ctx, attrX, attrY, attrW, attrH, 8);
  ctx.fill();
  ctx.fillStyle = th.text2;
  ctx.textBaseline = 'middle';
  ctx.direction = 'ltr'; // attribution stays LTR (Latin brand names)
  ctx.textAlign = 'left';
  ctx.fillText(attr, attrX + 12, attrY + attrH / 2, attrW - 20);
  ctx.restore();

  // info panel
  ctx.fillStyle = th.surface;
  ctx.fillRect(0, mapH - 1, width, infoH + 1);
  // separator
  ctx.fillStyle = th.sep;
  ctx.fillRect(PAD, mapH, width - PAD * 2, 1);

  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.textBaseline = 'top';
  const x0 = rtl ? width - PAD : PAD;
  let y = mapH + PAD - 4;
  for (const L of drawn) {
    ctx.font = `${L.weight} ${L.size}px ${font}`;
    ctx.fillStyle = L.color;
    if (L.ltr) { ctx.direction = 'ltr'; ctx.textAlign = rtl ? 'right' : 'left'; }
    else { ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left'; }
    ctx.fillText(L.text, x0, y, maxText);
    y += L.size + lineGap;
  }
  // brand
  ctx.font = `600 18px ${font}`;
  ctx.fillStyle = th.text3;
  ctx.direction = 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.fillText(brand, x0, height - 36, maxText);

  return { width, height, attribution: attr, meta, noMap: !!noMap };
}

/** Create a real canvas (browser / OffscreenCanvas) and return a PNG Blob. */
export async function composeSharePng(opts = {}) {
  const w = opts.width || CARD_W;
  const mapH = opts.mapH || MAP_H;
  // pre-measure height via a throwaway path: drawShareCard sets canvas size
  const canUseOffscreen = typeof OffscreenCanvas !== 'undefined';
  const canvas = canUseOffscreen ? new OffscreenCanvas(w, mapH + INFO_MIN + 100) : (() => {
    if (typeof document === 'undefined') throw new Error('no-canvas');
    return document.createElement('canvas');
  })();
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no-2d');
  drawShareCard(ctx, { ...opts, width: w, mapH });
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png', quality: 0.92 });
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob')), 'image/png');
  });
}

/** PNG signature check (magic bytes). */
export function isPng(buf) {
  if (!buf || buf.byteLength < 8) return false;
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47 && u[4] === 0x0d && u[5] === 0x0a && u[6] === 0x1a && u[7] === 0x0a;
}

/** Read IHDR width/height from a PNG ArrayBuffer. */
export function pngSize(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!isPng(u) || u.byteLength < 24) return null;
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

// offline + no vector-tile features rendered → the snapshot would be an empty map
export function basemapMissing(map, online = (typeof navigator === 'undefined' ? true : navigator.onLine !== false)) {
  if (online || !map) return false;
  try {
    // only basemap (vector tile) features count – route line, POI overlay and UI guards are local GeoJSON
    const n = map.queryRenderedFeatures?.();
    return !Array.isArray(n) || !n.some(f => f?.source === 'openmaptiles' || f?.layer?.source === 'openmaptiles');
  } catch { return true; }
}
