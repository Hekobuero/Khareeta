// Place photos from Wikimedia Commons only (no keys, no other providers).
// Sources (OSM tags): image (Commons URLs only), wikimedia_commons (File: or Category:), wikidata (P18 via Wikidata API).
// Metadata + ~400 px thumbnails via the Commons API (imageinfo, iiurlwidth, extmetadata). Pure helpers are unit-tested
// in tests/photos/*.test.mjs; loadPhotos() takes the JSON fetcher as a parameter so it runs in Node too.
export const THUMB_W = 330, THUMB_W2 = 500, MAX_PHOTOS = 6;
// Commons geosearch (only for named landmarks/POIs without enough tagged photos): small radius, few results, relevance-filtered.
export const GEO_RADIUS = 120, GEO_LIMIT = 12, GEO_MAX = 3;
const API = 'https://commons.wikimedia.org/w/api.php';
const WD = 'https://www.wikidata.org/w/api.php';

const normTitle = s => { s = String(s || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : ''; };
const IMG = /\.(jpe?g|png|webp|gif|tiff?|svg)$/i;
const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };

// Commons file title ("File:Name.jpg") from a URL or a plain value, or null for anything that is not Commons.
export function commonsFile(v) {
  if (!v || typeof v !== 'string') return null;
  v = v.trim();
  let m = v.match(/^(?:File|Image):(.+)$/i);
  if (m) return IMG.test(m[1]) ? 'File:' + normTitle(m[1]) : null;
  let u; try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'https:') return null; // http image tags are rejected (no mixed content, no downgrade)
  const h = u.hostname.toLowerCase(), p = dec(u.pathname);
  let name = null;
  if (h === 'commons.wikimedia.org' || h === 'commons.m.wikimedia.org') {
    if ((m = p.match(/^\/wiki\/(?:File|Image):(.+)$/i))) name = m[1];
    else if ((m = p.match(/^\/wiki\/Special:FilePath\/(.+)$/i))) name = m[1];
    else if (p === '/w/index.php' && /^(File|Image):/i.test(u.searchParams.get('title') || '')) name = u.searchParams.get('title').replace(/^(File|Image):/i, '');
  } else if (h === 'upload.wikimedia.org') {
    // /wikipedia/commons/a/ab/Name.jpg or /wikipedia/commons/thumb/a/ab/Name.jpg/400px-Name.jpg
    if ((m = p.match(/^\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/))) name = m[1];
  }
  return name && IMG.test(name) ? 'File:' + normTitle(name) : null;
}
export const validQid = q => typeof q === 'string' && /^Q[1-9]\d{0,9}$/.test(q.trim());
export function commonsCategory(v) {
  const m = typeof v === 'string' && v.trim().match(/^Category:(.+)$/i);
  return m ? 'Category:' + normTitle(m[1]) : null;
}

// What to ask for, from the tags (deduplicated, in priority order).
export function photoSources(tg = {}) {
  const files = [];
  const push = f => { if (f && !files.includes(f)) files.push(f); };
  String(tg.image || '').split(';').forEach(s => push(commonsFile(s)));
  String(tg.wikimedia_commons || '').split(';').forEach(s => push(commonsFile(s)));
  const category = commonsCategory(tg.wikimedia_commons);
  const qid = validQid(tg.wikidata) ? tg.wikidata.trim() : null;
  return { files, category, qid, any: !!(files.length || category || qid) };
}

export const wikidataUrl = qid => `${WD}?action=wbgetclaims&entity=${encodeURIComponent(qid)}&property=P18&format=json&origin=*`;
export function p18Files(j) {
  return ((j && j.claims && j.claims.P18) || []).filter(c => c.rank !== 'deprecated').map(c => c.mainsnak?.datavalue?.value).filter(v => typeof v === 'string').map(v => commonsFile('File:' + v)).filter(Boolean);
}
const II = `prop=imageinfo&iiprop=url|size|mime|extmetadata&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl|ObjectName&iiurlwidth=${THUMB_W}&format=json&formatversion=2&origin=*`;
export const imageInfoUrl = titles => `${API}?action=query&titles=${titles.map(encodeURIComponent).join('|')}&${II}`;
export const categoryUrl = cat => `${API}?action=query&generator=categorymembers&gcmtitle=${encodeURIComponent(cat)}&gcmtype=file&gcmlimit=${MAX_PHOTOS}&${II}`;
// One request: files near the point + their imageinfo (coords rounded to ~10 m → better cache hits).
// prop=categories too: geosearch hits are checked against their Commons categories (people, politics, war, aerial, maps …).
export const geoUrl = (lat, lon, r = GEO_RADIUS) => `${API}?action=query&generator=geosearch&ggscoord=${(+lat).toFixed(4)}%7C${(+lon).toFixed(4)}&ggsradius=${r}&ggsnamespace=6&ggslimit=${GEO_LIMIT}&cllimit=max&${II.replace('prop=imageinfo', 'prop=imageinfo%7Ccategories')}`;

// Geosearch only for named landmarks / notable POIs (not shops, offices, roads, houses …).
const LANDMARK = { historic: /./, tourism: /^(attraction|museum|viewpoint|artwork|gallery|zoo|theme_park)$/, amenity: /^(place_of_worship|theatre|library|university|townhall|marketplace|fountain|monastery|arts_centre)$/,
  building: /^(mosque|church|cathedral|chapel|synagogue|temple|castle|palace|minaret|monastery)$/, leisure: /^(park|stadium|garden)$/, man_made: /^(tower|lighthouse|bridge|minaret)$/, bridge: /./, heritage: /./, castle_type: /./ };
export function geoEligible(tg = {}) {
  if (!String(tg.name || tg['name:en'] || tg['name:ar'] || '').trim()) return false;
  return Object.entries(LANDMARK).some(([k, re]) => typeof tg[k] === 'string' && tg[k] !== 'no' && re.test(tg[k]));
}
// Junk for every source (EN/DE/FR/AR): maps, plans, logos, flags, coats of arms, stamps, documents, diagrams; non-photo formats.
const JUNK = /\b(maps?|karten?|carte|locator|location map|lageplan|plan|grundriss|diagram|diagramm|sch[ée]ma|logo|flagg?e?|drapeau|coat of arms|wappen|blason|armoiries|emblem|embl[eè]me|seal|siegel|icon|symbol|stamp|briefmarke|timbre|banknote|coin|m[üu]nze|poster|plakat|affiche|document|dokument|scan|signature|screenshot|chart|graph|portrait|portr[äa]t|bildnis)\b/i;
const JUNK_AR = /(خريطة|خارطة|مخطط|شعار|علم سوريا|طابع|وثيقة|رسم بياني)/;
const norm = t => String(t || '').replace(/^File:/i, '').replace(/[_\-.(),]/g, ' ');
export function isJunkTitle(t) { const s = String(t || '').replace(/^File:/i, ''); return /\.(svg|gif|tiff?|pdf|djvu)$/i.test(s) || JUNK.test(norm(t)) || JUNK_AR.test(s); }
// Geosearch only (conservative – when in doubt, drop): people, portraits, politics, events, war/military/destruction,
// aerial/oblique archive views (Ifpo, Armée du Levant), old/dated event photos.
const GEO_BAD = /\b(portrait|portr[äa]t|selfie|people|person|persons|personen|personnes?|men|man|women|woman|frau|mann|homme|femme|boy|girl|child|children|kinder|enfants?|family|familie|famille|wedding|hochzeit|mariage|crowd|visitors?|besucher|tourists?|president|pr[äa]sident|politician|politiker|minister|ministre|king|k[öo]nig|roi|emir|sheikh|shaykh|imam|pope|papst|leader|official|delegation|meets?|meeting|visit|visits|visiting|besuch|visite|speech|rede|discours|ceremony|zeremonie|c[ée]r[ée]monie|funeral|beerdigung|fun[ée]railles|prayers?|celebration|feier|f[êe]te|event|veranstaltung|[ée]v[ée]nement|protests?|protest|demonstration|manifestation|rally|revolution|r[ée]volution|war|krieg|guerre|civil war|b[üu]rgerkrieg|military|milit[äa]r|militaire|army|armee|arm[ée]e|soldiers?|soldat(en)?|troops|tanks?|battle|schlacht|bataille|bomb(ing|ed)?|attack|anschlag|attentat|shelling|destroy(ed)?|destruction|zerst[öo]rte?[nrs]?|zerst[öo]rung|d[ée]truit|damaged?|besch[äa]digt|ruined|aerial|luftbild|luftaufnahme|a[ée]rienne|vue a[ée]rienne|oblique|ifpo|drone|bashir|assad|sharaa|jolani|julani|hafez|bashar)\b/i;
const GEO_BAD_AR = /(حرب|مدمر|دمار|قصف|جيش|عسكري|جنود|مظاهرة|احتجاج|ثورة|رئيس|وزير|زيارة|صورة شخصية|شخص|أشخاص|ناس|زوار|احتفال|جنازة|جوية|بشار|الأسد|الشرع|الجولاني|البشير)/;
const OLD_YEAR = /\b(18\d\d|19[0-6]\d)\b/; // archive photos before 1970 (aerial/oblique views of the old city etc.)
const NEW_YEAR = /\b(20(1[1-9]|2\d))\b/;       // titles naming a year since 2011: war/event photos – drop (conservative)
export function isGeoJunk(t) { const s = norm(t); return isJunkTitle(t) || GEO_BAD.test(s) || GEO_BAD_AR.test(s) || OLD_YEAR.test(s) || NEW_YEAR.test(s); }
// Categories of a geosearch hit: missing categories → drop (unknown = doubt).
const CAT_BAD = /\b(people|persons?|men|women|children|portraits?|politicians?|presidents?|ministers?|heads of state|royalty|clergy|imams|living people|births|deaths|events|protests?|demonstrations?|revolution|war|civil war|conflict|military|army|armed forces|soldiers|battles?|weapons|tanks|destroyed|destruction|damaged|bombing|attacks?|aerial|oblique|drone|maps?|plans|diagrams|flags|logos|coats of arms|stamps|ceremonies|funerals|visits|meetings|visitors|tourists|crowds|celebrations|ifpo|arm[ée]e du levant)\b/i;
const CAT_OLD = /\b(18\d\d|19[0-6]\d)\b|\b(20(1[1-9]|2\d)) (in|events)\b/i;
export function badCategories(cats) {
  if (!Array.isArray(cats) || !cats.length) return true;
  return cats.some(c => { const s = norm(String(c && c.title || c).replace(/^Category:/i, '')); return CAT_BAD.test(s) || GEO_BAD.test(s) || CAT_OLD.test(s) || GEO_BAD_AR.test(s); });
}
// Very wide panoramas (> 2.5 : 1) look bad in the 4:3 box → not used from geosearch (tagged ones are cropped with object-fit:cover).
export const MAX_ASPECT = 2.5;
export const tooWide = p => !!(p && p.ow && p.oh && p.ow / p.oh > MAX_ASPECT);
// Generic words (types, cities, articles; EN/DE/FR/AR) never count as a name match on their own.
const STOP = new Set(('al el the of and de der die das la le les in von du des syria syrie syrien damascus damaskus damas aleppo alep halab homs hama latakia old new great grand '
  + 'mosque mosquee moschee masjid jami jamia church kirche eglise cathedral chapel saint sankt beit bayt house haus maison gate tor porte bab temple western eastern northern southern palace palast palais qasr castle citadel citadelle zitadelle burg '
  + 'madrasa madrasah school hammam bath khan souq souk suq market street square tomb mausoleum shrine maqam museum musee park bridge tower minaret '
  + 'قلعة قصر جامع مسجد باب سوق متحف حلب دمشق كنيسة بيت حمام خان مدرسة شارع ساحة كبير').split(' '));
// Lower-case, no diacritics/harakat, Arabic article "ال" removed → "الجامع" and "جامع" are the same (generic) token.
const tokens = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '').replace(/^file:/, '').replace(/\.[a-z]+$/, '').replace(/['’ʿʾ`]/g, '').split(/[^\p{L}\p{N}]+/u)
  .map(w => w.replace(/^(ال|وال|بال)(?=\p{L}{2})/u, '')).filter(w => w.length > 2 && !STOP.has(w));
// Name variants of the place → tokens; a geosearch hit counts only when its title/object name shares a name token.
export function nameTokens(tg = {}) { const set = new Set(); for (const k of Object.keys(tg)) if (k === 'name' || /^(name|alt_name|old_name|official_name|int_name):?[a-z]{0,3}$/.test(k)) tokens(tg[k]).forEach(w => set.add(w)); return set; }
export function geoRelevant(photo, names) {
  if (!photo || isGeoJunk(photo.title) || isGeoJunk(photo.alt) || tooWide(photo)) return false;
  if (photo.categories !== undefined && badCategories(photo.categories)) return false;
  if (!names || !names.size) return false;
  return [...tokens(photo.title), ...tokens(photo.alt)].some(w => names.has(w));
}

// HTML from extmetadata → plain text (no markup reaches the DOM).
export function plain(html) {
  return String(html || '').replace(/<(script|style)\b[^>]*>[\s\S]*?(<\/\1\s*>|$)/gi, ' ').replace(/<!--[\s\S]*?(-->|$)/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
}
const httpsOnly = (u, hosts) => { if (!u) return null; try { const x = new URL(u, 'https://commons.wikimedia.org/'); return x.protocol === 'https:' && (!hosts || hosts.some(h => x.hostname === h || x.hostname.endsWith('.' + h))) ? x.href : null; } catch { return null; } };

// Commons thumb URL without tracking params (utm_*), so the SW cache key is stable.
export function cleanThumb(u) { try { const x = new URL(u); [...x.searchParams.keys()].filter(k => /^utm_/i.test(k)).forEach(k => x.searchParams.delete(k)); x.hash = ''; return x.href; } catch { return u; } }
// "<url> 330w, <url at THUMB_W2> 500w" for Commons thumbs ("/<any>px-Name", width read from the URL); '' when not a sized thumb.
export function srcsetFor(thumb) {
  if (!thumb) return '';
  const c = cleanThumb(thumb), q = c.indexOf('?'), path = q < 0 ? c : c.slice(0, q), qs = q < 0 ? '' : c.slice(q);
  const m = path.match(/\/(\d+)px-[^/]+$/);
  if (!m) return '';
  const w = +m[1]; if (w >= THUMB_W2) return `${c} ${w}w`;
  return `${c} ${w}w, ${path.replace(/\/\d+px-([^/]+)$/, `/${THUMB_W2}px-$1`)}${qs} ${THUMB_W2}w`;
}
// Licence links only to known licence hosts; anything else is shown as plain text.
export const LICENSE_HOSTS = ['creativecommons.org', 'wikimedia.org', 'wikipedia.org', 'gnu.org', 'opensource.org'];
// Only the photo-relevant tags (remembered per place so an offline deep link can still show cached photos).
export const PHOTO_KEYS = ['image', 'wikimedia_commons', 'wikidata'];
export function photoTags(tg = {}) { const o = {}; for (const k of PHOTO_KEYS) if (typeof tg[k] === 'string' && tg[k].trim()) o[k] = tg[k].trim().slice(0, 500); return o; }

// Commons API (formatversion=2) → [{ title, thumb, width, height, page, artist, license, licenseUrl, alt }]
export function parseImageInfo(j, order = []) {
  const pages = (j && j.query && j.query.pages) || [];
  const list = (Array.isArray(pages) ? pages : Object.values(pages)).filter(p => !p.missing && p.imageinfo && p.imageinfo[0]).map(p => {
    const ii = p.imageinfo[0], md = ii.extmetadata || {}, val = k => md[k] && md[k].value;
    if (ii.mime && !/^image\/(jpeg|png|webp|gif|tiff|svg\+xml)$/.test(ii.mime)) return null;
    const thumb = httpsOnly(cleanThumb(ii.thumburl || ii.url), ['upload.wikimedia.org', 'thumb.wikimedia.org']);
    const page = httpsOnly(ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`, ['commons.wikimedia.org']);
    if (!thumb || !page) return null;
    const tw = ii.thumbwidth || THUMB_W, th = ii.thumbheight || Math.round(THUMB_W * 3 / 4);
    return {
      title: p.title, thumb, srcset: srcsetFor(thumb), width: tw, height: th, page, ow: ii.width || tw, oh: ii.height || th,
      ...(p.categories ? { categories: p.categories.map(c => c.title) } : {}),
      artist: plain(val('Artist')).slice(0, 120) || null,
      license: plain(val('LicenseShortName')).slice(0, 60) || null,
      licenseUrl: httpsOnly(plain(val('LicenseUrl')) || '', LICENSE_HOSTS),
      alt: (plain(val('ObjectName')) || p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')).slice(0, 140),
    };
  }).filter(Boolean);
  const idx = t => { const i = order.indexOf(t); return i < 0 ? 1e9 : i; };
  return list.sort((a, b) => idx(a.title) - idx(b.title));
}

// Fetch photos for tags. fetchJSON(url) → parsed JSON (throws on network error).
// Returns { photos, error } – error is 'offline' when nothing could be fetched.
// opts: { max, lat, lon } – geosearch runs only when lat/lon are given, the place is a named landmark and tagged sources gave < GEO_MAX photos.
// HTTP status errors ("HTTP 500", {status}) = server problem, not offline.
export const isHttpError = e => !!e && (/^HTTP \d{3}/.test(e.message || '') || (e.status >= 400 && e.status < 600));
// Empty-box text: offline → photoOffline; server/API error (e.g. HTTP 500) → photoError; nothing found → photoNone.
export const photoEmptyKey = (err, online = globalThis.navigator?.onLine !== false) => !online || err === 'offline' ? 'photoOffline' : err === 'error' ? 'photoError' : 'photoNone';
export async function loadPhotos(tg, fetchJSON, { max = MAX_PHOTOS, lat, lon } = {}) {
  const src = photoSources(tg);
  const geo = Number.isFinite(+lat) && Number.isFinite(+lon) && lat !== null && lon !== null && geoEligible(tg);
  if (!src.any && !geo) return { photos: [], error: null };
  let files = src.files.slice(), failed = 0, tried = 0, httpErr = false;
  const fail = e => { failed++; if (isHttpError(e)) httpErr = true; };
  if (src.qid && files.length < max) { tried++; try { p18Files(await fetchJSON(wikidataUrl(src.qid))).forEach(f => { if (!files.includes(f)) files.push(f); }); } catch (e) { fail(e); } }
  files = files.slice(0, max);
  let photos = [];
  const add = p => { if (photos.length < max && !photos.some(x => x.title === p.title)) photos.push(p); };
  if (files.length) { tried++; try { photos = parseImageInfo(await fetchJSON(imageInfoUrl(files)), files); } catch (e) { fail(e); } }
  if (src.category && photos.length < max) {
    tried++; try { parseImageInfo(await fetchJSON(categoryUrl(src.category))).filter(p => !isJunkTitle(p.title)).forEach(add); } catch (e) { fail(e); }
  }
  if (geo && photos.length < GEO_MAX) {
    tried++;
    try {
      const j = await fetchJSON(geoUrl(lat, lon)), names = nameTokens(tg);
      const ps = (j && j.query && j.query.pages) || [], idx = new Map((Array.isArray(ps) ? ps : Object.values(ps)).map(p => [p.title, p.index ?? 0]));
      parseImageInfo(j).map(p => p.categories ? p : { ...p, categories: [] }).filter(p => geoRelevant(p, names)).sort((a, b) => idx.get(a.title) - idx.get(b.title)).slice(0, GEO_MAX).forEach(p => add({ ...p, nearby: true }));
    } catch (e) { fail(e); }
  }
  return { photos, error: !photos.length && tried && failed === tried ? (httpErr ? 'error' : 'offline') : null };
}
