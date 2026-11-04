// Place photos from Wikimedia Commons only (no keys, no other providers).
// Sources (OSM tags): image (Commons URLs only), wikimedia_commons (File: or Category:), wikidata (P18 via Wikidata API).
// Metadata + ~400 px thumbnails via the Commons API (imageinfo, iiurlwidth, extmetadata). Pure helpers are unit-tested
// in tests/photos/*.test.mjs; loadPhotos() takes the JSON fetcher as a parameter so it runs in Node too.
export const THUMB_W = 400, MAX_PHOTOS = 3;
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
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
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
const II = `prop=imageinfo&iiprop=url|size|mime|extmetadata&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl|ImageDescription|ObjectName&iiurlwidth=${THUMB_W}&format=json&formatversion=2&origin=*`;
export const imageInfoUrl = titles => `${API}?action=query&titles=${titles.map(encodeURIComponent).join('|')}&${II}`;
export const categoryUrl = cat => `${API}?action=query&generator=categorymembers&gcmtitle=${encodeURIComponent(cat)}&gcmtype=file&gcmlimit=${MAX_PHOTOS}&${II}`;

// HTML from extmetadata → plain text (no markup reaches the DOM).
export function plain(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
}
const httpsOnly = (u, hosts) => { if (!u) return null; try { const x = new URL(u, 'https://commons.wikimedia.org/'); return x.protocol === 'https:' && (!hosts || hosts.some(h => x.hostname === h || x.hostname.endsWith('.' + h))) ? x.href : null; } catch { return null; } };

// Commons API (formatversion=2) → [{ title, thumb, width, height, page, artist, license, licenseUrl, alt }]
export function parseImageInfo(j, order = []) {
  const pages = (j && j.query && j.query.pages) || [];
  const list = (Array.isArray(pages) ? pages : Object.values(pages)).filter(p => !p.missing && p.imageinfo && p.imageinfo[0]).map(p => {
    const ii = p.imageinfo[0], md = ii.extmetadata || {}, val = k => md[k] && md[k].value;
    if (ii.mime && !/^image\/(jpeg|png|webp|gif|tiff|svg\+xml)$/.test(ii.mime)) return null;
    const thumb = httpsOnly(ii.thumburl || ii.url, ['upload.wikimedia.org', 'thumb.wikimedia.org']);
    const page = httpsOnly(ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`, ['wikimedia.org']);
    if (!thumb || !page) return null;
    const tw = ii.thumbwidth || THUMB_W, th = ii.thumbheight || Math.round(THUMB_W * 3 / 4);
    return {
      title: p.title, thumb, width: tw, height: th, page,
      artist: plain(val('Artist')).slice(0, 120) || null,
      license: plain(val('LicenseShortName')).slice(0, 60) || null,
      licenseUrl: httpsOnly(plain(val('LicenseUrl')) || '', null),
      alt: (plain(val('ObjectName')) || p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')).slice(0, 140),
    };
  }).filter(Boolean);
  const idx = t => { const i = order.indexOf(t); return i < 0 ? 1e9 : i; };
  return list.sort((a, b) => idx(a.title) - idx(b.title));
}

// Fetch photos for tags. fetchJSON(url) → parsed JSON (throws on network error).
// Returns { photos, error } – error is 'offline' when nothing could be fetched.
export async function loadPhotos(tg, fetchJSON, { max = MAX_PHOTOS } = {}) {
  const src = photoSources(tg);
  if (!src.any) return { photos: [], error: null };
  let files = src.files.slice(), failed = 0, tried = 0;
  if (src.qid && files.length < max) { tried++; try { p18Files(await fetchJSON(wikidataUrl(src.qid))).forEach(f => { if (!files.includes(f)) files.push(f); }); } catch { failed++; } }
  files = files.slice(0, max);
  let photos = [];
  if (files.length) { tried++; try { photos = parseImageInfo(await fetchJSON(imageInfoUrl(files)), files); } catch { failed++; } }
  if (src.category && photos.length < max) {
    tried++; try { for (const p of parseImageInfo(await fetchJSON(categoryUrl(src.category)))) if (photos.length < max && !photos.some(x => x.title === p.title)) photos.push(p); } catch { failed++; }
  }
  return { photos, error: !photos.length && tried && failed === tried ? 'offline' : null };
}
