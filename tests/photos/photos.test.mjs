// Unit tests for js/photos.js (no dependencies): node --test 'tests/photos/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geoEligible, geoUrl, geoRelevant, isJunkTitle, nameTokens, srcsetFor, MAX_PHOTOS, GEO_RADIUS, GEO_MAX, THUMB_W2 } from '../../js/photos.js';
import { commonsFile, commonsCategory, validQid, photoSources, p18Files, imageInfoUrl, categoryUrl, wikidataUrl, parseImageInfo, plain, loadPhotos, THUMB_W, photoTags, LICENSE_HOSTS } from '../../js/photos.js';

test('commonsFile: accepts only Wikimedia Commons', () => {
  assert.equal(commonsFile('File:Umayyad Mosque.jpg'), 'File:Umayyad Mosque.jpg');
  assert.equal(commonsFile('Image:umayyad_Mosque.JPG'), 'File:Umayyad Mosque.JPG');
  assert.equal(commonsFile('https://commons.wikimedia.org/wiki/File:Damascus_%28Citadel%29.jpg'), 'File:Damascus (Citadel).jpg');
  assert.equal(commonsFile('https://commons.m.wikimedia.org/wiki/File:A.png'), 'File:A.png');
  assert.equal(commonsFile('https://commons.wikimedia.org/wiki/Special:FilePath/A_b.jpg?width=300'), 'File:A b.jpg');
  assert.equal(commonsFile('https://upload.wikimedia.org/wikipedia/commons/a/ab/X_y.jpg'), 'File:X y.jpg');
  assert.equal(commonsFile('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/400px-X.jpg'), 'File:X.jpg');
  assert.equal(commonsFile('https://commons.wikimedia.org/w/index.php?title=File:Z.webp'), 'File:Z.webp');
  for (const bad of ['https://example.com/a.jpg', 'https://upload.wikimedia.org/wikipedia/en/a/ab/Local.jpg', 'https://commons.wikimedia.org.evil.com/wiki/File:A.jpg',
    'https://i.imgur.com/x.jpg', 'https://lh3.googleusercontent.com/x.jpg', 'javascript:alert(1)', 'File:Doc.pdf', 'File:Clip.webm', 'Category:X', '', null, 42])
    assert.equal(commonsFile(bad), null, String(bad));
});

test('category, qid validation', () => {
  assert.equal(commonsCategory('Category:Umayyad_Mosque'), 'Category:Umayyad Mosque');
  assert.equal(commonsCategory('File:A.jpg'), null);
  assert.ok(validQid('Q42')); assert.ok(!validQid('Q0')); assert.ok(!validQid('Q42&x=1')); assert.ok(!validQid('P18')); assert.ok(!validQid(undefined));
});

test('photoSources: dedupe, priority, ignores non-Commons image', () => {
  const s = photoSources({ image: 'https://commons.wikimedia.org/wiki/File:A.jpg;https://example.com/b.jpg', wikimedia_commons: 'File:A.jpg', wikidata: 'Q123' });
  assert.deepEqual(s.files, ['File:A.jpg']); assert.equal(s.qid, 'Q123'); assert.equal(s.category, null); assert.ok(s.any);
  assert.equal(photoSources({ image: 'https://example.com/b.jpg' }).any, false);
  assert.equal(photoSources({}).any, false);
  assert.equal(photoSources({ wikimedia_commons: 'Category:X' }).category, 'Category:X');
  assert.equal(photoSources({ wikidata: 'bogus' }).qid, null);
});

test('API URLs: Commons/Wikidata only, keyless, thumb width', () => {
  const u = new URL(imageInfoUrl(['File:A b.jpg', 'File:C&D.jpg']));
  assert.equal(u.origin, 'https://commons.wikimedia.org');
  assert.equal(u.searchParams.get('titles'), 'File:A b.jpg|File:C&D.jpg');
  assert.equal(u.searchParams.get('iiurlwidth'), String(THUMB_W));
  assert.match(u.searchParams.get('iiextmetadatafilter'), /Artist/);
  assert.match(u.searchParams.get('iiextmetadatafilter'), /LicenseShortName/);
  assert.match(u.searchParams.get('iiextmetadatafilter'), /LicenseUrl/);
  assert.equal(u.searchParams.get('origin'), '*');
  assert.ok(THUMB_W >= 320 && THUMB_W <= 480);
  assert.equal(new URL(categoryUrl('Category:X')).searchParams.get('gcmtitle'), 'Category:X');
  const w = new URL(wikidataUrl('Q42'));
  assert.equal(w.origin, 'https://www.wikidata.org'); assert.equal(w.searchParams.get('property'), 'P18');
  for (const x of [imageInfoUrl(['File:A.jpg']), categoryUrl('Category:X'), wikidataUrl('Q1')]) assert.doesNotMatch(x, /key=|token|google|mapbox|here\.com|bing|apple/i);
});

test('p18Files: skips deprecated and junk', () => {
  const j = { claims: { P18: [
    { rank: 'normal', mainsnak: { datavalue: { value: 'Umayyad mosque.jpg' } } },
    { rank: 'deprecated', mainsnak: { datavalue: { value: 'Old.jpg' } } },
    { rank: 'normal', mainsnak: { snaktype: 'novalue' } },
  ] } };
  assert.deepEqual(p18Files(j), ['File:Umayyad mosque.jpg']);
  assert.deepEqual(p18Files({}), []); assert.deepEqual(p18Files(null), []);
});

test('plain: strips markup and entities', () => {
  assert.equal(plain('<a href="//commons.wikimedia.org/wiki/User:X">Jane &amp; Joe</a>\n<span>Doe</span>'), 'Jane & Joe Doe');
  assert.equal(plain('<script>x</script>ok'), 'ok');
  assert.equal(plain(undefined), '');
});

const page = (title, extra = {}) => ({ title, imageinfo: [{ thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${title.slice(5)}/400px-x.jpg`, thumbwidth: 400, thumbheight: 300,
  descriptionurl: `https://commons.wikimedia.org/wiki/${title.replace(/ /g, '_')}`, mime: 'image/jpeg',
  extmetadata: { Artist: { value: '<a href="x">Jane</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' } }, ...extra }] });

test('parseImageInfo: fields, order, safety', () => {
  const j = { query: { pages: [page('File:B.jpg'), page('File:A.jpg'), { title: 'File:Gone.jpg', missing: true },
    page('File:Evil.jpg', { thumburl: 'https://evil.example/x.jpg' }), page('File:Vid.webm', { mime: 'video/webm' }),
    page('File:Js.jpg', { extmetadata: { LicenseUrl: { value: 'javascript:alert(1)' } } })] } };
  const r = parseImageInfo(j, ['File:A.jpg', 'File:B.jpg']);
  assert.deepEqual(r.map(p => p.title), ['File:A.jpg', 'File:B.jpg', 'File:Js.jpg']);
  assert.equal(r[0].artist, 'Jane'); assert.equal(r[0].license, 'CC BY-SA 4.0');
  assert.equal(r[0].licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0');
  assert.equal(r[0].width, 400); assert.equal(r[0].height, 300);
  assert.equal(r[0].alt, 'A');
  assert.equal(r[2].licenseUrl, null); assert.equal(r[2].artist, null);
  assert.equal(parseImageInfo({ query: { pages: [page('File:E.jpg', { extmetadata: { LicenseUrl: { value: '' } } })] } })[0].licenseUrl, null);
  assert.deepEqual(parseImageInfo({}), []);
  // thumbnails from thumb.wikimedia.org (current API) are accepted too
  assert.equal(parseImageInfo({ query: { pages: [page('File:T.jpg', { thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/05/T.jpg/500px-T.jpg' })] } }).length, 1);
  // formatversion=1 object shape
  assert.equal(parseImageInfo({ query: { pages: { 1: page('File:A.jpg') } } }).length, 1);
});

test('loadPhotos: wikidata → imageinfo, max option, no fetch without sources', async () => {
  const calls = [];
  const fetchJSON = async u => {
    calls.push(u);
    if (u.includes('wikidata')) return { claims: { P18: ['W1.jpg', 'W2.jpg', 'W3.jpg'].map(v => ({ rank: 'normal', mainsnak: { datavalue: { value: v } } })) } };
    const titles = new URL(u).searchParams.get('titles').split('|');
    return { query: { pages: titles.map(t => page(t)) } };
  };
  const r = await loadPhotos({ image: 'File:Own.jpg', wikidata: 'Q5' }, fetchJSON, { max: 3 });
  assert.deepEqual(r.photos.map(p => p.title), ['File:Own.jpg', 'File:W1.jpg', 'File:W2.jpg']);
  assert.equal(r.error, null); assert.equal(calls.length, 2);
  calls.length = 0;
  assert.deepEqual(await loadPhotos({ name: 'x', image: 'https://example.com/a.jpg' }, fetchJSON), { photos: [], error: null });
  assert.equal(calls.length, 0);
});

test('loadPhotos: offline → error offline; partial failure → no error', async () => {
  const off = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await loadPhotos({ wikidata: 'Q5', image: 'File:A.jpg' }, off), { photos: [], error: 'offline' });
  const half = async u => { if (u.includes('wikidata')) throw new Error('x'); return { query: { pages: [] } }; };
  assert.equal((await loadPhotos({ wikidata: 'Q5', image: 'File:A.jpg' }, half)).error, null);
});

test('i18n: photo texts in EN/AR/DE', () => {
  const src = readFileSync(new URL('../../js/i18n.js', import.meta.url), 'utf8');
  for (const k of ['photoBy', 'photoUnknown', 'photoSource', 'photoOpen', 'photoNone', 'photoOffline'])
    assert.equal((src.match(new RegExp(`\\b${k}: '`, 'g')) || []).length, 3, k);
});

test('service worker: photo cache is bounded and precaches photos.js', () => {
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'js\/photos\.js'/);
  const img = +sw.match(/MAX_PHOTO_IMG = (\d+)/)[1], api = +sw.match(/MAX_PHOTO_API = (\d+)/)[1];
  assert.ok(img > 0 && img <= 100 && api > 0 && api <= 200);
  assert.match(sw, /r\.type !== 'opaque'/);
  const re = new RegExp(sw.match(/const isPhotoImg = u => \/(.+)\/\.test\(u\);/)[1]);
  assert.ok(re.test('https://thumb.wikimedia.org/wikipedia/commons/thumb/0/05/T.jpg/500px-T.jpg'));
  assert.ok(re.test('https://upload.wikimedia.org/wikipedia/commons/0/05/T.jpg'));
  assert.ok(!re.test('https://example.com/wikipedia/commons/x.jpg'));
});

// ---- QA round 2 (PR #13) ----
test('service worker: photo response is cloned before the page consumes it (kh-photos gets filled)', async () => {
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  const src = sw.slice(sw.indexOf('const PHOTOS ='), sw.indexOf("self.addEventListener('fetch'"));
  const store = new Map();
  const cache = { match: async u => store.get(u), put: async (u, r) => { store.set(u, await r.text()); }, delete: async u => store.delete(u), keys: async () => [...store.keys()].map(url => ({ url })) };
  // Response whose clone() throws once the body was read – like the real Fetch API.
  const mkRes = body => { let used = false; const r = { ok: true, status: 200, type: 'cors', text: async () => { used = true; return body; }, clone() { if (used) throw new TypeError('body used'); return mkRes(body); } }; return r; };
  const fn = new Function('caches', 'fetch', 'setTimeout', src + '; return photoFetch;');
  const photoFetch = fn({ open: async () => cache }, async () => mkRes('IMG'), setTimeout);
  const url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/400px-X.jpg';
  const waits = [];
  const r = await photoFetch({ url }, { waitUntil: p => waits.push(p) });
  await r.text(); // page consumes the body first
  await Promise.all(waits);
  assert.equal(store.get(url), 'IMG');
});

test('licence and page links: only known hosts', () => {
  const j = { query: { pages: [
    { title: 'File:A.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:A.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' } } }] },
    { title: 'File:B.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/b.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:B.jpg', extmetadata: { LicenseShortName: { value: 'Custom' }, LicenseUrl: { value: 'https://evil.example/licence' } } }] },
    { title: 'File:C.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/c.jpg', descriptionurl: 'https://meta.wikimedia.org/wiki/File:C.jpg' }] },
  ] } };
  const l = parseImageInfo(j);
  assert.equal(l.length, 2);
  assert.equal(l[0].licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0');
  assert.equal(l[1].licenseUrl, null);
  assert.equal(l[1].license, 'Custom');
  assert.ok(l.every(p => new URL(p.page).hostname === 'commons.wikimedia.org'));
  assert.deepEqual(LICENSE_HOSTS.slice().sort(), ['creativecommons.org', 'gnu.org', 'opensource.org', 'wikimedia.org', 'wikipedia.org']);
});

test('plain: drops script/style content; commonsFile rejects http', () => {
  assert.equal(plain('<style>.a{color:red}</style>Jane <script>alert(1)</script>Doe'), 'Jane Doe');
  assert.equal(plain('A<script type="x">bad'), 'A');
  assert.equal(commonsFile('http://commons.wikimedia.org/wiki/File:A.jpg'), null);
  assert.equal(commonsFile('http://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg'), null);
});

test('photoTags: only photo keys (remembered for offline deep links)', () => {
  assert.deepEqual(photoTags({ name: 'X', wikidata: ' Q1 ', image: '', phone: '1' }), { wikidata: 'Q1' });
});

test('css: skeleton caption reserves the real caption height (no CLS)', () => {
  const css = readFileSync(new URL('../../css/app.css', import.meta.url), 'utf8');
  const m = css.match(/\.pphotos \.ph-cap \.skel\{[^}]*height:(\d+)px;margin:(\d+)px 0/);
  assert.ok(m); assert.equal(+m[1] + 2 * +m[2], 44);
});

// ---- more photos: geosearch, srcset, limits ----
test('limits: several photos but bounded; small thumbs; small geosearch radius', () => {
  assert.ok(MAX_PHOTOS >= 4 && MAX_PHOTOS <= 8); assert.ok(GEO_MAX <= 3);
  assert.ok(GEO_RADIUS > 0 && GEO_RADIUS <= 200); assert.ok(THUMB_W <= 400 && THUMB_W2 <= 640);
  const u = new URL(geoUrl(33.51121, 36.30655));
  assert.equal(u.origin, 'https://commons.wikimedia.org'); assert.equal(u.searchParams.get('generator'), 'geosearch');
  assert.equal(u.searchParams.get('ggscoord'), '33.5112|36.3066'); assert.equal(u.searchParams.get('ggsnamespace'), '6');
  assert.ok(+u.searchParams.get('ggslimit') <= 20); assert.doesNotMatch(geoUrl(1, 2), /key=|token|google/i);
});

test('geoEligible: only named landmarks', () => {
  assert.ok(geoEligible({ name: 'Azm Palace', historic: 'palace' }));
  assert.ok(geoEligible({ name: 'الجامع الأموي', amenity: 'place_of_worship' }));
  assert.ok(geoEligible({ name: 'National Museum', tourism: 'museum' }));
  assert.ok(!geoEligible({ historic: 'castle' }));
  assert.ok(!geoEligible({ name: 'Cafe X', amenity: 'cafe' }));
  assert.ok(!geoEligible({ name: 'Shop', shop: 'bakery' }));
  assert.ok(!geoEligible({ name: 'Road', highway: 'primary' }));
});

test('isJunkTitle: maps, logos, flags, portraits, svg', () => {
  for (const j of ['File:Map of Damascus.jpg', 'File:Syria location map.png', 'File:Flag_of_Syria.png', 'File:Logo-X.png', 'File:Coat of arms of Damascus.jpg', 'File:Portrait of a man.jpg', 'File:A.svg', 'File:Plan_mosque.jpg'])
    assert.ok(isJunkTitle(j), j);
  for (const ok of ['File:Umayyad Mosque courtyard.jpg', 'File:Azm Palace 01.jpg', 'File:Mariamite Cathedral of Damascus.jpg']) assert.ok(!isJunkTitle(ok), ok);
});

test('geoRelevant: needs a distinctive name token, generic words do not count', () => {
  const n = nameTokens({ name: 'قصر العظم', 'name:en': 'Azm Palace', 'name:de': 'Azm-Palast' });
  assert.ok(n.has('azm')); assert.ok(!n.has('palace'));
  assert.ok(geoRelevant({ title: 'File:Azm Palace 2010.jpg', alt: 'Azm Palace' }, n));
  assert.ok(!geoRelevant({ title: 'File:Damascus palace street.jpg', alt: '' }, n));
  assert.ok(!geoRelevant({ title: 'File:Map of Azm Palace.jpg', alt: '' }, n));
  assert.ok(!geoRelevant({ title: 'File:Azm.jpg', alt: '' }, new Set()));
  assert.ok(geoRelevant({ title: 'File:قصر العظم.jpg', alt: '' }, n));
});

test('srcsetFor: 1x/1.5x Commons thumbs only', () => {
  assert.equal(srcsetFor(`https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/${THUMB_W}px-X.jpg`),
    `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/${THUMB_W}px-X.jpg ${THUMB_W}w, https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/${THUMB_W2}px-X.jpg ${THUMB_W2}w`);
  assert.equal(srcsetFor('https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg'), '');
  assert.equal(srcsetFor(''), '');
});

test('loadPhotos: geosearch fills up with relevant nearby photos (marked nearby), skips junk', async () => {
  const calls = [];
  const fetchJSON = async u => {
    calls.push(u);
    const q = new URL(u).searchParams;
    if (q.get('generator') === 'geosearch') return { query: { pages: [
      { ...page('File:Azm Palace courtyard.jpg'), index: 2 }, { ...page('File:Azm Palace map.jpg'), index: 1 },
      { ...page('File:Random street.jpg'), index: 0 }, { ...page('File:Azm Palace fountain.jpg'), index: 1 }, { ...page('File:Own.jpg'), index: 0 }] } };
    return { query: { pages: q.get('titles').split('|').map(t => page(t)) } };
  };
  const tg = { name: 'Azm Palace', historic: 'palace', image: 'File:Own.jpg' };
  const r = await loadPhotos(tg, fetchJSON, { lat: 33.51, lon: 36.30 });
  assert.deepEqual(r.photos.map(p => p.title), ['File:Own.jpg', 'File:Azm Palace fountain.jpg', 'File:Azm Palace courtyard.jpg']);
  assert.ok(!r.photos[0].nearby && r.photos[1].nearby);
  // no coordinates → no geosearch; not a landmark → no geosearch
  calls.length = 0; await loadPhotos(tg, fetchJSON); assert.ok(!calls.some(u => u.includes('geosearch')));
  calls.length = 0; assert.deepEqual(await loadPhotos({ name: 'Cafe', amenity: 'cafe' }, fetchJSON, { lat: 1, lon: 2 }), { photos: [], error: null }); assert.equal(calls.length, 0);
  // geosearch skipped when tagged sources already give enough photos
  calls.length = 0; await loadPhotos({ ...tg, image: 'File:A.jpg;File:B.jpg;File:C.jpg' }, fetchJSON, { lat: 1, lon: 2 }); assert.ok(!calls.some(u => u.includes('geosearch')));
});

test('i18n: new photo strip texts in EN/AR/DE; SW caches geosearch JSON', () => {
  const src = readFileSync(new URL('../../js/i18n.js', import.meta.url), 'utf8');
  for (const k of ['photoNearby', 'photosCount']) assert.equal((src.match(new RegExp(`\\b${k}: '`, 'g')) || []).length, 3, k);
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  const re = new RegExp(sw.match(/const isPhotoApi = u => \/(.+)\/\.test\(u\);/)[1]);
  assert.ok(re.test(geoUrl(33.5, 36.3)));
  const place = readFileSync(new URL('../../js/place.js', import.meta.url), 'utf8');
  assert.match(place, /settings\.lowData/); assert.match(place, /srcset=/); assert.match(place, /loading="lazy"/);
});
