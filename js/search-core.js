// Offline search core (pure, no DOM, no network): Arabic/Latin normalisation, transliteration aliases, fuzzy matching
// (Damerau-Levenshtein, optimal string alignment) and a small local index over saved places, recent searches and the
// bundled OSM gazetteer (data/gazetteer-sy.json, built by tools/gazetteer/build.py). Tested in tests/saved/.

// ---------- normalisation ----------
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function normText(s) {
  return String(s || '').normalize('NFKC').toLowerCase()     // Arabic presentation forms (ﺣﻠﺐ → حلب), ligatures
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')                 // Latin diacritics (ā, é …)
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')           // tashkeel, superscript alef, tatweel
    .replace(/[\u200c-\u200f\u202a-\u202e\u2066-\u2069]/g, '')          // zero-width / bidi marks
    .replace(/[أإآٱ]/g, 'ا').replace(/[ىی]/g, 'ي').replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '').replace(/ک/g, 'ك').replace(/گ/g, 'ك')
    .replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d))).replace(/[۰-۹]/g, d => String(FA_DIGITS.indexOf(d)))
    .replace(/['’‘`ʿʾ]/g, '')                                         // Dar'a, Ma‘arrat
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const AR_ART = /^ال(?=..)/, LAT_ART = /^(?:al|el|as|ash|ad|ar|az|an|at|ath|adh)[ -](?=..)/;
// one word without its article: "اللاذقيه" → "لاذقيه", "al-raqqa" → "raqqa"
export function stripArticle(w) { return w.replace(AR_ART, '').replace(LAT_ART, ''); }
const isLatin = s => /^[a-z0-9 ]+$/.test(s);
// Latin spelling skeleton: doubled letters, common transliteration digraphs and vowel noise folded together
export function latinKey(s) {
  return s.replace(/ou/g, 'u').replace(/ee/g, 'i').replace(/aa/g, 'a').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/q/g, 'k').replace(/c(?=[aouklr ]|$)/g, 'k')
    .replace(/kh/g, 'k').replace(/dh/g, 'd').replace(/th/g, 't').replace(/gh/g, 'g').replace(/sh/g, 's').replace(/y/g, 'i').replace(/e/g, 'a')
    .replace(/(.)\1+/g, '$1').replace(/h(?=\s|$)/g, '');
}
// Every search key of a text: normalised, without article (per word), Latin skeleton.
export function keysOf(s) {
  const n = normText(s); if (!n) return [];
  const out = new Set([n]);
  const noArt = n.split(' ').map(stripArticle).join(' '); out.add(noArt);
  out.add(n.replace(/^(al|el) /, '').replace(/^ال/, ''));
  if (isLatin(n)) { out.add(latinKey(n)); out.add(latinKey(noArt)); }
  return [...out].filter(Boolean);
}

// ---------- transliteration aliases (EN / DE / FR / common romanisations → Arabic name) ----------
export const ALIASES = {
  'حلب': 'aleppo halab haleb alep',
  'دمشق': 'damascus damaskus dimashq dimashk damas sham ash-sham الشام',
  'حمص': 'homs hims hums',
  'حماه': 'hama hamah hamat',
  'اللاذقيه': 'latakia lattakia latakiya lattaquie latakieh ladhiqiyah al-ladhiqiyah lazkiye',
  'طرطوس': 'tartus tartous tartos tortosa',
  'ادلب': 'idlib idleb edlib edleb',
  'درعا': 'daraa deraa dara dera dar\'a',
  'السويداء': 'suwayda sweida sweda as-suwayda soueida',
  'الرقه': 'raqqa rakka raqqah ar-raqqa',
  'دير الزور': 'deir ez-zor deir ezzor deir al-zor dayr az-zawr deirezzor',
  'الحسكه': 'hasakah hasaka hassakeh al-hasakah',
  'القامشلي': 'qamishli kamishli qamishlo',
  'تدمر': 'palmyra tadmur tadmor',
  'القنيطره': 'quneitra qunaitra kuneitra',
  'بصرى': 'bosra busra bosra al-sham',
  'معلولا': 'maaloula maalula malula',
  'جبله': 'jableh jabla jebleh',
  'بانياس': 'baniyas banias',
  'منبج': 'manbij menbij',
  'عفرين': 'afrin efrin',
  'الباب': 'al-bab bab',
  'اعزاز': 'azaz aazaz',
  'جرمانا': 'jaramana jaramanah',
  'دوما': 'douma duma',
  'الزبداني': 'zabadani zebdani',
  'صافيتا': 'safita',
  'سلميه': 'salamiyah salamiyeh salamieh',
  'مصياف': 'masyaf misyaf',
  'المزه': 'mezzeh mazzeh mezze',
};
const ALIAS_KEYS = new Map(); // normalised alias → normalised Arabic name
for (const [ar, list] of Object.entries(ALIASES)) for (const a of list.split(' ')) for (const k of keysOf(a.replace(/-/g, ' '))) ALIAS_KEYS.set(k, normText(ar));
export function aliasesFor(name) { const n = normText(name); const out = []; for (const [k, v] of ALIAS_KEYS) if (v === n) out.push(k); return out; }

// ---------- fuzzy ----------
// Damerau-Levenshtein (optimal string alignment) with an early exit above max.
export function damerau(a, b, max = Infinity) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (!la) return lb; if (!lb) return la;
  let p2 = null, p1 = Array.from({ length: lb + 1 }, (_, j) => j), cur;
  for (let i = 1; i <= la; i++) {
    cur = [i]; let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + c);
      if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    p2 = p1; p1 = cur;
  }
  return p1[lb];
}
// allowed typos by query length: 1–3 → 0, 4–5 → 1, 6–9 → 2, ≥10 → 3
export function tolerance(len) { return len <= 3 ? 0 : len <= 5 ? 1 : len <= 9 ? 2 : 3; }
export function trigrams(s) { const p = `  ${s} `, out = new Set(); for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3)); return out; }
export function trigramSim(a, b) { const A = trigrams(a), B = trigrams(b); let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n || 1); }

// score one query key against one entry key (0 = no match, higher = better)
export function matchScore(q, k) {
  if (!q || !k) return 0;
  if (q === k) return 100;
  if (k.startsWith(q)) return 90 - Math.min(20, k.length - q.length);
  if (k.split(' ').some(w => w.startsWith(q))) return 75;
  if (q.length >= 3 && k.includes(q)) return 60;
  const tol = tolerance(q.length);
  if (!tol) return 0;
  const d = damerau(q, k, tol);
  if (d <= tol) return 70 - 12 * d;
  // typo in a typed prefix ("damasc" for "damascus"): compare with the key's prefix of the same length
  if (k.length > q.length) { const dp = damerau(q, k.slice(0, q.length), tol); if (dp <= tol && q.length >= 4) return 58 - 12 * dp; }
  for (const w of k.split(' ')) if (w.length >= 3 && damerau(q, w, tol) <= tol) return 50;
  return q.length >= 5 && trigramSim(q, k) >= 0.55 ? 40 : 0;
}

// ---------- index ----------
// entry: { id, name, alt?: [names], lon, lat, kind: 'saved'|'recent'|'place', w?: weight 0..30, ... }
export function buildIndex(entries) {
  return entries.map(e => {
    const names = [e.name, ...(e.alt || [])].filter(Boolean);
    const keys = new Set();
    for (const n of names) { for (const k of keysOf(n)) keys.add(k); for (const a of aliasesFor(n)) keys.add(a); }
    const bg = new Set(); for (const k of keys) for (let i = 0; i < k.length - 1; i++) bg.add(k.slice(i, i + 2));
    return { e, keys: [...keys], bg };
  });
}
const bigrams = s => { const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); return o; };
export function queryKeys(q) {
  const ks = new Set(keysOf(q));
  for (const k of [...ks]) { const ar = ALIAS_KEYS.get(k); if (ar) { ks.add(ar); for (const x of keysOf(ar)) ks.add(x); } }
  return [...ks];
}
export function searchIndex(index, q, { limit = 8, minScore = 40 } = {}) {
  const qk = queryKeys(q); if (!qk.length) return [];
  const qb = qk.map(bigrams), out = [];
  for (const it of index) {
    // cheap pre-filter: a match (even with typos) shares at least ~1/3 of the query's letter pairs
    // …except major cities: a short Latin typo can share no letter pair at all ("hmos" ↔ "homs")
    if (it.e.place !== 'city' && !qb.some(b => { let n = 0; for (const x of b) if (it.bg.has(x)) n++; return n >= Math.max(1, Math.floor(b.size / 3)); })) continue;
    let best = 0;
    for (const a of qk) for (const k of it.keys) { const s = matchScore(a, k); if (s > best) best = s; if (best === 100) break; }
    if (best >= minScore) out.push({ ...it.e, score: best + (it.e.w || 0) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------- gazetteer ----------
export const PLACE_TAG = ['city', 'town', 'suburb', 'quarter', 'neighbourhood', 'village'];
// compact data/gazetteer-sy.json rows → index entries (weights: city > town > district > village, population)
export function gazetteerEntries(g) {
  const types = g?.t || PLACE_TAG;
  return (g?.p || []).map(([ar, en, x, y, ti, pop], i) => ({
    id: 'gz' + i, kind: 'place', name: ar, alt: en ? [en] : [], ar, en, lon: x / 1e4, lat: y / 1e4, place: types[ti],
    w: ({ city: 25, town: 15, suburb: 10, quarter: 8, neighbourhood: 8, village: 0 }[types[ti]] || 0) + Math.min(5, Math.log10(pop || 1)),
  }));
}

// ---------- viewport gate (P1: "Café" in Berlin listed Syrian "Kafr…" villages 2600 km away and zoomed to z2.6) ----------
export const GZ_NEAR_M = 50000;   // gazetteer hits within 50 km of the view centre count as nearby
export const GZ_FAR_MIN = 100;    // farther hits only for a (near-)exact name match ("Homs", "Kafr Mize"), never fuzzy
export const FIT_NEAR_M = 15000;  // text results only frame the map if they are this close to the view centre
function distM(a, b) { const R = 6371008.8, r = Math.PI / 180, dl = (b[1] - a[1]) * r, dn = (b[0] - a[0]) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(x))); }
/** Gate gazetteer hits by the current view: name matches (score >= GZ_FAR_MIN) anywhere, nearest first, then fuzzy hits
 *  only when they are near the view. Far fuzzy hits ("Café" ≈ "Kafr …" 2600 km away) are dropped. */
export function gateByView(items, c, { nearM = GZ_NEAR_M, farMin = GZ_FAR_MIN, open = false } = {}) {
  if (open) return items; // view in Syria or an Arabic query: the whole gazetteer is local (typos like «حمصه» must still find Homs)
  const strong = [], weak = [];
  for (const x of items) {
    if (x.lon == null) continue;
    const d = distM(c, [x.lon, x.lat]);
    if ((x.score ?? 0) >= farMin) strong.push([d, x]); else if (d <= nearM) weak.push(x);
  }
  return [...strong.sort((a, b) => a[0] - b[0]).map(e => e[1]), ...weak];
}
/** Results that may drive the camera: only those close to the view centre (never a country/continent-wide box). */
export function fitTargets(res, c, nearM = FIT_NEAR_M) { return res.filter(x => x.lon != null && distM(c, [x.lon, x.lat]) <= nearM); }
