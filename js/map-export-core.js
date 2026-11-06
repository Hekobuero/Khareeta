// Printable map/route export helpers (pure: no DOM, no network, no MapLibre).
// Builds a self-contained HTML document the user can print / “Save as PDF”.
// Attribution is always included. No external scripts, fonts CDNs, or API keys.

export const PRINT_ATTR = '© OpenStreetMap contributors · OpenFreeMap · © OpenMapTiles';
export const PRINT_BRAND = 'Khareeta · خريطة';

export const MAP_EXPORT_I18N = {
  en: {
    mapExportPrint: 'Print / PDF',
    mapExportPrintShort: 'PDF',
    mapExportTitle: 'Route',
    mapExportPlaceTitle: 'Place',
    mapExportSteps: 'Directions',
    mapExportSummary: 'Summary',
    mapExportFail: 'Could not create the printable page',
    mapExportReady: 'Print dialog opened – choose “Save as PDF” if you want a file',
    mapExportSaved: 'Printable page saved',
    mapExportNoMap: 'Map not available offline – text only',
    mapExportFrom: 'From',
    mapExportTo: 'To',
    mapExportVia: 'Via',
    mapExportLowData: 'Data saver is on – exporting the current view only (no new downloads)',
  },
  ar: {
    mapExportPrint: 'طباعة / PDF',
    mapExportPrintShort: 'PDF',
    mapExportTitle: 'المسار',
    mapExportPlaceTitle: 'مكان',
    mapExportSteps: 'الاتجاهات',
    mapExportSummary: 'الملخص',
    mapExportFail: 'تعذّر إنشاء صفحة الطباعة',
    mapExportReady: 'فُتح مربع الطباعة – اختر «حفظ كـ PDF» إذا أردت ملفًا',
    mapExportSaved: 'تم حفظ صفحة الطباعة',
    mapExportNoMap: 'الخريطة غير متاحة دون اتصال – نص فقط',
    mapExportFrom: 'من',
    mapExportTo: 'إلى',
    mapExportVia: 'عبر',
    mapExportLowData: 'وضع توفير البيانات مفعّل – يُصدَّر العرض الحالي فقط (بدون تنزيلات جديدة)',
  },
  de: {
    mapExportPrint: 'Drucken / PDF',
    mapExportPrintShort: 'PDF',
    mapExportTitle: 'Route',
    mapExportPlaceTitle: 'Ort',
    mapExportSteps: 'Wegbeschreibung',
    mapExportSummary: 'Übersicht',
    mapExportFail: 'Druckseite konnte nicht erstellt werden',
    mapExportReady: 'Druckdialog geöffnet – „Als PDF speichern“ wählen, wenn du eine Datei willst',
    mapExportSaved: 'Druckseite gespeichert',
    mapExportNoMap: 'Karte offline nicht verfügbar – nur Text',
    mapExportFrom: 'Von',
    mapExportTo: 'Nach',
    mapExportVia: 'Über',
    mapExportLowData: 'Datensparmodus an – nur die aktuelle Ansicht wird exportiert (keine neuen Downloads)',
  },
};

export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const tr = (lang, k) => (MAP_EXPORT_I18N[lang] || MAP_EXPORT_I18N.en)[k] ?? MAP_EXPORT_I18N.en[k];

/**
 * Normalise print payload.
 * Route: { kind:'route', from, to, via?, modeLabel, durationLabel?, distanceLabel?, steps:[{text, distLabel?}] }
 * Place: { kind:'place', name, address?, coords?, statusText? }
 */
export function normalizePrintMeta(raw = {}, lang = 'en') {
  const kind = raw.kind === 'place' ? 'place' : 'route';
  if (kind === 'place') {
    return {
      kind: 'place',
      name: String(raw.name || '').trim().slice(0, 160) || '—',
      address: String(raw.address || '').trim().slice(0, 200),
      coords: String(raw.coords || '').trim().slice(0, 64),
      statusText: String(raw.statusText || '').trim().slice(0, 80),
    };
  }
  const via = Array.isArray(raw.via)
    ? raw.via.filter(Boolean).map(s => String(s).trim()).filter(Boolean).slice(0, 6)
    : [];
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map(s => ({
      text: String(s?.text || s?.instr || '').trim().slice(0, 240),
      distLabel: String(s?.distLabel || s?.distanceLabel || '').trim().slice(0, 40),
    })).filter(s => s.text).slice(0, 80)
    : [];
  return {
    kind: 'route',
    from: String(raw.from || '').trim().slice(0, 120) || '—',
    to: String(raw.to || '').trim().slice(0, 120) || '—',
    via,
    modeLabel: String(raw.modeLabel || '').trim().slice(0, 40),
    durationLabel: String(raw.durationLabel || '').trim().slice(0, 40),
    distanceLabel: String(raw.distanceLabel || '').trim().slice(0, 40),
    title: String(raw.title || '').trim().slice(0, 160),
    steps,
  };
}

export function safeMapDataUrl(u) {
  if (typeof u !== 'string' || u.length < 32 || u.length > 12_000_000) return '';
  if (!/^data:image\/(png|jpeg);base64,/.test(u)) return '';
  if (/[<>'"]/.test(u.slice(0, 64))) return '';
  return u;
}

/**
 * Build a printable HTML document (UTF-8). No external resources.
 * @param {{ lang?: string, dark?: boolean, mapDataUrl?: string, noMap?: boolean, meta?: object, attribution?: string, brand?: string, autoPrint?: boolean }} opts
 */
export function buildPrintHtml(opts = {}) {
  const lang = ['en', 'ar', 'de'].includes(opts.lang) ? opts.lang : 'en';
  const rtl = lang === 'ar';
  const dark = !!opts.dark;
  const meta = normalizePrintMeta(opts.meta || {}, lang);
  const attr = String(opts.attribution || PRINT_ATTR);
  const brand = String(opts.brand || PRINT_BRAND);
  const mapUrl = safeMapDataUrl(opts.mapDataUrl || '');
  const noMap = !!opts.noMap || !mapUrl;
  const autoPrint = opts.autoPrint !== false;

  const head = meta.kind === 'route'
    ? (meta.title || [meta.durationLabel, meta.distanceLabel, meta.modeLabel].filter(Boolean).join(' · ') || tr(lang, 'mapExportTitle'))
    : (meta.name || tr(lang, 'mapExportPlaceTitle'));

  const summaryRows = [];
  if (meta.kind === 'route') {
    summaryRows.push([tr(lang, 'mapExportFrom'), meta.from]);
    if (meta.via.length) summaryRows.push([tr(lang, 'mapExportVia'), meta.via.join(' · ')]);
    summaryRows.push([tr(lang, 'mapExportTo'), meta.to]);
    if (meta.modeLabel) summaryRows.push([meta.modeLabel, [meta.durationLabel, meta.distanceLabel].filter(Boolean).join(' · ')]);
  } else {
    if (meta.address) summaryRows.push([tr(lang, 'mapExportSummary'), meta.address]);
    if (meta.coords) summaryRows.push([MAP_EXPORT_I18N[lang].mapExportSummary === tr(lang, 'mapExportSummary') ? 'GPS' : 'GPS', meta.coords]);
    if (meta.statusText) summaryRows.push(['', meta.statusText]);
  }

  const stepsHtml = meta.kind === 'route' && meta.steps.length
    ? `<h2>${escHtml(tr(lang, 'mapExportSteps'))}</h2>
<ol class="steps">${meta.steps.map((s, i) =>
    `<li><span class="n">${i + 1}.</span><span class="tx" dir="auto">${escHtml(s.text)}</span>${s.distLabel ? `<span class="d">${escHtml(s.distLabel)}</span>` : ''}</li>`
  ).join('')}</ol>`
    : '';

  const mapBlock = noMap
    ? `<div class="map empty"><p>${escHtml(tr(lang, 'mapExportNoMap'))}</p></div>`
    : `<div class="map"><img src="${mapUrl}" alt="" width="1200" height="780"/><div class="attr">${escHtml(attr)}</div></div>`;

  const summaryHtml = summaryRows.length
    ? `<dl class="sum">${summaryRows.map(([k, v]) =>
      `<div><dt>${escHtml(k)}</dt><dd dir="auto">${escHtml(v)}</dd></div>`
    ).join('')}</dl>`
    : '';

  const printScript = autoPrint
    ? `<script>addEventListener('load',function(){setTimeout(function(){try{print()}catch(e){}},250)});<\/script>`
    : '';

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escHtml(brand)} – ${escHtml(head)}</title>
<style>
  :root{color-scheme:${dark ? 'dark' : 'light'};--bg:${dark ? '#1c1c1e' : '#fff'};--fg:${dark ? '#f5f5f7' : '#1c1c1e'};--muted:${dark ? '#aeaeb5' : '#5c5c63'};--line:${dark ? 'rgba(235,235,245,.14)' : 'rgba(60,60,67,.14)'};--attr:rgba(255,255,255,.88)}
  *{box-sizing:border-box}
  body{margin:0;padding:24px;font:15px/1.45 system-ui,-apple-system,"Segoe UI","Noto Sans Arabic",sans-serif;background:var(--bg);color:var(--fg)}
  header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:16px;flex-wrap:wrap}
  header .brand{font-weight:700;font-size:14px;color:var(--muted)}
  h1{font-size:22px;margin:0 0 4px;font-weight:700}
  h2{font-size:16px;margin:20px 0 8px;font-weight:700}
  .sum{margin:0;display:grid;gap:6px}
  .sum div{display:grid;grid-template-columns:auto 1fr;gap:8px 12px;align-items:baseline}
  .sum dt{font-weight:600;color:var(--muted);font-size:13px}
  .sum dd{margin:0}
  .map{position:relative;margin:16px 0;border-radius:12px;overflow:hidden;background:${dark ? '#2c2c2e' : '#e8e6e1'};border:1px solid var(--line)}
  .map img{display:block;width:100%;height:auto;max-height:70vh;object-fit:cover}
  .map.empty{min-height:120px;display:flex;align-items:center;justify-content:center;color:var(--muted);padding:24px;text-align:center}
  .map .attr{position:absolute;inset-inline-start:10px;bottom:10px;background:var(--attr);color:#1c1c1e;font:600 11px/1.2 system-ui,sans-serif;padding:4px 8px;border-radius:6px;direction:ltr;unicode-bidi:isolate}
  .steps{margin:0;padding:0;list-style:none;border-top:1px solid var(--line)}
  .steps li{display:grid;grid-template-columns:2rem 1fr auto;gap:8px;padding:10px 0;border-bottom:1px solid var(--line);align-items:start}
  .steps .n{color:var(--muted);font-variant-numeric:tabular-nums}
  .steps .d{color:var(--muted);font-size:13px;white-space:nowrap}
  footer{margin-top:24px;font-size:12px;color:var(--muted);direction:ltr;unicode-bidi:isolate}
  @media print{
    body{padding:12px}
    .map img{max-height:45vh}
    a{color:inherit;text-decoration:none}
  }
</style>
</head>
<body>
<header>
  <div>
    <h1 dir="auto">${escHtml(head)}</h1>
    <div class="brand">${escHtml(brand)}</div>
  </div>
</header>
<section aria-label="${escHtml(tr(lang, 'mapExportSummary'))}">
  ${summaryHtml}
</section>
${mapBlock}
${stepsHtml}
<footer>${escHtml(attr)} · ${escHtml(brand)}</footer>
${printScript}
</body>
</html>`;
}

/** Filename stem for downloads (no path separators). */
export function printFilename(kind = 'route') {
  const k = kind === 'place' ? 'place' : 'route';
  return `khareeta-${k}-${Date.now()}`;
}
