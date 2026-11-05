// Landmark-Directions: unit tests with mocked local OSM/map features (no network).
// Run: node --test tests/route/landmarks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.localStorage ??= {
  _m: {},
  getItem(k) { return this._m[k] ?? null; },
  setItem(k, v) { this._m[k] = String(v); },
  removeItem(k) { delete this._m[k]; },
};
globalThis.document ??= {
  documentElement: { lang: '', dir: '', setAttribute() {} },
  querySelector: () => null,
  addEventListener() {},
};

const root = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');

const {
  classifyLandmark, landmarkName, pickLandmark, enrichStepsWithLandmarks,
  clearLandmarkIndex, upsertLandmarks, seedFromSyriaPois, formatLandmarkInstr,
  deArticle, stepUsesLandmark, LANDMARK_RADIUS_M, isBeforeManeuver, getLandmarkIndex,
  TIER_SLACK_M,
} = await import('../../js/landmarks.js');
const { setLang, t, getLang } = await import('../../js/i18n.js');

function item(lon, lat, tags) {
  return { lon, lat, tags };
}

function banner(lm, action, lang) {
  setLang(lang);
  const tpl = {
    text: t(lm.relation === 'after' ? 'lmAfter' : 'lmAt'),
    art: lang === 'de' ? deArticle(lm.kind) : '',
  };
  return formatLandmarkInstr(lm, action, tpl);
}

test('classifyLandmark ranks worship / square / historic over shop', () => {
  assert.equal(classifyLandmark({ amenity: 'place_of_worship', name: 'X' }), 'worship');
  assert.equal(classifyLandmark({ place: 'square', name: 'X' }), 'square');
  assert.equal(classifyLandmark({ leisure: 'park', name: 'X' }), 'park');
  assert.equal(classifyLandmark({ historic: 'monument', name: 'X' }), 'historic');
  assert.equal(classifyLandmark({ tourism: 'museum', name: 'X' }), 'tourism');
  assert.equal(classifyLandmark({ shop: 'bakery', name: 'X' }), 'shop');
  assert.equal(classifyLandmark({ amenity: 'hospital', name: 'X' }), 'amenity');
  assert.equal(classifyLandmark({ amenity: 'cafe', name: 'X' }), null);
  assert.equal(classifyLandmark({ amenity: 'place_of_worship' }), 'worship'); // classify does not require name
  assert.equal(landmarkName({ amenity: 'place_of_worship' }, 'en'), ''); // unnamed ignored at pick time
});

test('landmarkName respects UI lang with fallback to name', () => {
  const tags = { name: 'الجامع الأموي', 'name:en': 'Umayyad Mosque', 'name:de': 'Umayyaden-Moschee', 'name:ar': 'الجامع الأموي' };
  assert.equal(landmarkName(tags, 'en'), 'Umayyad Mosque');
  assert.equal(landmarkName(tags, 'de'), 'Umayyaden-Moschee');
  assert.equal(landmarkName(tags, 'ar'), 'الجامع الأموي');
  assert.equal(landmarkName({ name: 'Only' }, 'en'), 'Only');
  assert.equal(landmarkName({}, 'en'), '');
});

test('pickLandmark chooses closest suitable named object within radius', () => {
  const maneuver = [36.29128, 33.51145];
  const features = [
    item(36.2915, 33.5116, { name: 'Far Shop', shop: 'convenience' }),
    item(36.2913, 33.5115, { name: 'Al-Omari Mosque', amenity: 'place_of_worship', 'name:de': 'Omari-Moschee', 'name:ar': 'الجامع العمري' }),
    item(36.2925, 33.5125, { name: 'Too Far Park', leisure: 'park' }),
  ];
  const lm = pickLandmark(maneuver, features, { lang: 'en', radius: LANDMARK_RADIUS_M });
  assert.ok(lm);
  assert.equal(lm.name, 'Al-Omari Mosque');
  assert.equal(lm.kind, 'worship');
  assert.ok(lm.dist < 50);
});

test('prefer worship/square/historic over shop when distances similar', () => {
  const maneuver = [36.3, 33.5];
  const features = [
    item(36.30005, 33.50005, { name: 'Abu Bakery', shop: 'bakery' }),
    item(36.30008, 33.50008, { name: 'Citadel Gate', historic: 'city_gate' }),
  ];
  const lm = pickLandmark(maneuver, features, { lang: 'en', radius: 120 });
  assert.equal(lm.kind, 'historic');
  assert.equal(lm.name, 'Citadel Gate');
  assert.ok(Math.abs(lm.dist) <= TIER_SLACK_M + 50);
});

test('unnamed and out-of-range ignored; no hallucination', () => {
  const maneuver = [36.3, 33.5];
  assert.equal(pickLandmark(maneuver, [
    item(36.3001, 33.5001, { amenity: 'place_of_worship' }),
    item(36.31, 33.51, { name: 'Far Mosque', amenity: 'place_of_worship' }),
  ], { lang: 'en', radius: 100 }), null);

  assert.equal(pickLandmark(maneuver, null, { lang: 'en' }), null);
  assert.equal(pickLandmark(maneuver, [], { lang: 'en' }), null);
  assert.equal(pickLandmark(null, [item(36.3, 33.5, { name: 'X', leisure: 'park' })], { lang: 'en' }), null);
});

test('prefer landmark BEFORE the turn when both sides available', () => {
  // Travel east toward maneuver; feature west of maneuver is before; east is after
  const maneuver = [36.3, 33.5];
  const approachBearing = 90; // due east
  const features = [
    item(36.2995, 33.5, { name: 'Before Mosque', amenity: 'place_of_worship' }),
    item(36.3005, 33.5, { name: 'After Mosque', amenity: 'place_of_worship' }),
  ];
  const lm = pickLandmark(maneuver, features, { lang: 'en', approachBearing, radius: 120 });
  assert.equal(lm.name, 'Before Mosque');
  assert.equal(lm.relation, 'after'); // before-turn → "after X, turn…"
  assert.equal(isBeforeManeuver(maneuver, [36.2995, 33.5], approachBearing), true);
  assert.equal(isBeforeManeuver(maneuver, [36.3005, 33.5], approachBearing), false);
});

test('enrichStepsWithLandmarks attaches at most one landmark per step', () => {
  clearLandmarkIndex();
  const steps = [
    { type: 'depart', name: 'Start', loc: [36.299, 33.5] },
    { type: 'turn', modifier: 'right', name: 'Street A', loc: [36.3, 33.5] },
    { type: 'continue', name: 'Street B', loc: [36.301, 33.501] },
    { type: 'arrive', name: 'End', loc: [36.302, 33.502] },
  ];
  const features = [
    item(36.30005, 33.50005, { name: 'Omari Mosque', amenity: 'place_of_worship', 'name:de': 'Omari-Moschee' }),
  ];
  enrichStepsWithLandmarks(steps, 'de', features);
  assert.equal(steps[0].landmark, undefined); // depart
  assert.ok(steps[1].landmark);
  assert.equal(steps[1].landmark.name, 'Omari-Moschee');
  assert.ok(stepUsesLandmark(steps[1]));
  assert.equal(steps[3].landmark, undefined); // arrive
});

test('formatLandmarkInstr EN/AR/DE — after / at phrasing', () => {
  const afterDe = banner({ name: 'Omari-Moschee', kind: 'worship', relation: 'after' }, 'rechts abbiegen', 'de');
  assert.equal(afterDe, 'Nach der Omari-Moschee rechts abbiegen');
  const atDe = banner({ name: 'Omari-Moschee', kind: 'worship', relation: 'at' }, 'weiter', 'de');
  assert.equal(atDe, 'An der Omari-Moschee weiter');

  const afterEn = banner({ name: 'Al-Omari Mosque', kind: 'worship', relation: 'after' }, 'turn right', 'en');
  assert.equal(afterEn, 'After Al-Omari Mosque, turn right');
  const atEn = banner({ name: 'Al-Omari Mosque', kind: 'worship', relation: 'at' }, 'continue', 'en');
  assert.equal(atEn, 'At Al-Omari Mosque, continue');

  const arAfter = banner({ name: 'الجامع العمري', kind: 'worship', relation: 'after' }, 'انعطف يمينًا', 'ar');
  assert.equal(arAfter, 'بعد الجامع العمري، انعطف يمينًا');
  const arAt = banner({ name: 'الجامع العمري', kind: 'worship', relation: 'at' }, 'استمر', 'ar');
  assert.equal(arAt, 'عند الجامع العمري، استمر');
});

test('i18n keys lmAfter/lmAt exist for EN/AR/DE (banner + voice)', () => {
  for (const lang of ['en', 'ar', 'de']) {
    setLang(lang);
    assert.match(t('lmAfter'), /\{n\}/);
    assert.match(t('lmAt'), /\{n\}/);
    assert.match(t('lmAfter'), /\{a\}/);
    const vo = t('vo');
    assert.match(vo.lmAfter, /\{n\}/);
    assert.match(vo.lmAt, /\{n\}/);
  }
});

test('deArticle handles German definite article by kind', () => {
  assert.equal(deArticle('worship'), 'der ');
  assert.equal(deArticle('square'), 'dem ');
  assert.equal(deArticle('historic'), 'dem ');
  assert.equal(deArticle('park'), 'dem ');
  assert.equal(deArticle('shop'), '');
});

test('offline: index from seeded local features; no network', async () => {
  clearLandmarkIndex();
  const fetchCalls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (...a) => { fetchCalls.push(a); throw new Error('network blocked'); };
  try {
    upsertLandmarks([
      item(36.3, 33.5, { amenity: 'place_of_worship', name: 'Cached Mosque' }),
    ]);
    const lm = pickLandmark([36.3, 33.5], getLandmarkIndex(), { lang: 'en' });
    assert.ok(lm);
    assert.equal(lm.name, 'Cached Mosque');
    assert.equal(fetchCalls.length, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('seedFromSyriaPois uses category tags; shop without name skipped', () => {
  clearLandmarkIndex();
  const n = seedFromSyriaPois([
    { lon: 36.3, lat: 33.5, c: 'mosque', s: 'mosque', osm: 'n1', name: 'Great Mosque', ar: 'الجامع', en: 'Great Mosque' },
    { lon: 36.301, lat: 33.501, c: 'shop', s: 'convenience', osm: 'n2', name: '', ar: '', en: '' },
  ]);
  assert.ok(n >= 1);
  const lm2 = pickLandmark([36.3, 33.5], getLandmarkIndex(), { lang: 'en' });
  assert.ok(lm2);
  assert.match(lm2.name, /Great Mosque|الجامع/);
});

test('fallback: street-name path when no landmark (source wiring)', () => {
  const routeSrc = read('js/route.js');
  assert.match(routeSrc, /formatLandmarkInstr/);
  assert.match(routeSrc, /enrichStepsWithLandmarks/);
  assert.match(routeSrc, /stepUsesLandmark/);
  assert.match(routeSrc, /harvestFromMap/);
  assert.match(routeSrc, /seedFromSyriaPois/);
  assert.match(routeSrc, /onto\(|turnR|mods\[m\]/);
  // no landmark → instr falls through to street-name switch
  clearLandmarkIndex();
  const steps = [{ type: 'turn', modifier: 'right', name: 'Main St', loc: [36.3, 33.5] }];
  enrichStepsWithLandmarks(steps, 'en', []);
  assert.equal(steps[0].landmark, undefined);
  assert.equal(stepUsesLandmark(steps[0]), false);
});

test('banner and voice stay in sync via step.landmark', () => {
  const routeSrc = read('js/route.js');
  const voiceSrc = read('js/voice.js');
  assert.match(routeSrc, /from '\.\/landmarks\.js'/);
  assert.match(voiceSrc, /from '\.\/landmarks\.js'/);
  assert.match(voiceSrc, /formatLandmarkInstr/);
  assert.match(voiceSrc, /stepUsesLandmark/);
  assert.match(voiceSrc, /s\.landmark\.relation/);
  assert.match(routeSrc, /function instr[\s\S]*?stepUsesLandmark/);
});

test('sw precaches landmarks.js; relative path only', () => {
  const sw = read('sw.js');
  assert.match(sw, /['"]js\/landmarks\.js['"]/);
  assert.doesNotMatch(sw, /https?:\/\/[^'"]*landmarks/);
});

test('landmarks module does not call external geocoders', () => {
  const src = read('js/landmarks.js');
  // implementation must not fetch Overpass/Nominatim/Photon (comment may mention them)
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /overpass-api|nominatim\.openstreetmap|photon\.komoot/i);
  assert.doesNotMatch(src, /google|mapbox|here\.com|bingmaps|apple\.com|api[_-]?key/i);
});

test('relation after vs at matches maneuver approach', () => {
  clearLandmarkIndex();
  const turn = { type: 'turn', modifier: 'left', name: 'X', loc: [36.3, 33.5] };
  const cont = { type: 'continue', modifier: 'straight', name: 'Y', loc: [36.301, 33.5] };
  const features = [
    item(36.2995, 33.5, { name: 'Park', leisure: 'park' }), // before eastbound approach to turn
  ];
  // first step has no prev → approachBearing null → treated as before → relation after
  enrichStepsWithLandmarks([turn, cont], 'en', features);
  assert.ok(turn.landmark);
  assert.equal(turn.landmark.relation, 'after');
});

test('roundabout / arrive / depart never get landmark cues', () => {
  clearLandmarkIndex();
  const features = [item(36.3, 33.5, { name: 'Near Mosque', amenity: 'place_of_worship' })];
  const steps = [
    { type: 'depart', loc: [36.3, 33.5], name: 'A' },
    { type: 'roundabout', modifier: 'right', exit: 2, loc: [36.3, 33.5], name: 'B' },
    { type: 'rotary', loc: [36.3, 33.5], name: 'C' },
    { type: 'ferry', loc: [36.3, 33.5], name: 'D' },
    { type: 'arrive', loc: [36.3, 33.5], name: 'E' },
    { type: 'turn', modifier: 'left', loc: [36.3, 33.5], name: 'F' },
  ];
  enrichStepsWithLandmarks(steps, 'en', features);
  assert.equal(steps[0].landmark, undefined);
  assert.equal(steps[1].landmark, undefined);
  assert.equal(steps[2].landmark, undefined);
  assert.equal(steps[3].landmark, undefined);
  assert.equal(steps[4].landmark, undefined);
  assert.ok(steps[5].landmark);
  assert.equal(stepUsesLandmark(steps[1]), false);
  assert.equal(stepUsesLandmark(steps[5]), true);
});

test('CNAME still present', () => {
  assert.equal(read('CNAME').trim(), 'khareeta.app');
});
