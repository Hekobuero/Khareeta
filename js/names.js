// Pure name helpers (no DOM): one fallback chain for labels, search results, the POI layer and the place sheet.
// Places without an Arabic name (foreign shops with only name / name:en / brand) are never hidden.
//   AR:    name:ar → (Arabic-script name) → name → name:en → brand
//   EN/DE: name:<lang> → name:en → int_name → name:latin → name → brand
const AR_RE = /[\u0600-\u06FF]/;
export function nameChain(lang) {
  if (lang === 'ar') return ['name:ar', 'name', 'name:en', 'brand'];
  const own = lang && lang !== 'en' ? ['name:' + lang] : [];
  return [...own, 'name:en', 'int_name', 'name:latin', 'name', 'brand'];
}
export function pickNameFor(tags = {}, lang = 'en') {
  tags = tags || {};
  const ar = tags['name:ar'] || (AR_RE.test(tags.name || '') ? tags.name : '');
  let primary = '';
  if (lang === 'ar') primary = ar || tags.name || tags['name:en'] || tags.brand || '';
  else for (const k of nameChain(lang)) if (tags[k]) { primary = tags[k]; break; }
  let secondary = '';
  if (lang === 'ar') secondary = tags['name:en'] && tags['name:en'] !== primary ? tags['name:en'] : '';
  else secondary = ar && ar !== primary ? ar : '';
  return { primary: primary || '', secondary };
}
/** MapLibre text-field expression with the same chain (vector tiles have no brand; our GeoJSON POIs do). */
export function labelExpression(lang) {
  return ['coalesce', ...nameChain(lang).map(k => ['get', k])];
}
