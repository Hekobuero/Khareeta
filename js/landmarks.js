// Landmark cues for turn-by-turn (banner + voice): named OSM POIs already loaded locally.
// Cost 0 – no Overpass/Nominatim/Photon. Reads an in-memory index fed from Syria GeoJSON POIs,
// OpenMapTiles poi source features, and rendered kh-poi / world-poi layers.
import { haversine, bearing } from './util.js';
import { pickNameFor } from './names.js';
import { tileTags } from './tile-poi.js';
import { toItem } from './poi.js';

/** Search radius around a maneuver (spec: ~80–120 m). */
export const LANDMARK_RADIUS_M = 100;
/** Prefer a higher-tier landmark when within this of the nearest candidate. */
export const TIER_SLACK_M = 35;

/** Lower = preferred. worship/square/historic beat generic shops when distances are similar. */
export const TIER = Object.freeze({
  worship: 0,
  square: 1,
  historic: 2,
  tourism: 3,
  park: 4,
  amenity: 5,
  shop: 6,
});

const LAYERS_RENDER = ['kh-poi-1', 'kh-poi-2', 'kh-poi-3', 'kh-poi-0', 'kh-poi-f', 'kh-wpoi-1', 'kh-wpoi-2', 'kh-wpoi-3', 'poi-dot', 'poi-z15', 'poi'];

/** Classify OSM-like tags into a landmark tier key, or null if unsuitable. */
export function classifyLandmark(tags = {}) {
  if (!tags || typeof tags !== 'object') return null;
  if (tags.amenity === 'place_of_worship') return 'worship';
  if (tags.place === 'square' || tags.leisure === 'garden' || tags.highway === 'pedestrian') return 'square';
  if (tags.historic) return 'historic';
  if (tags.tourism) return 'tourism';
  if (tags.leisure === 'park') return 'park';
  if (tags.amenity === 'hospital' || tags.amenity === 'school' || tags.amenity === 'fuel') return 'amenity';
  if (tags.shop) return 'shop';
  // OpenMapTiles class shortcuts (when tags were not fully expanded)
  if (tags.class === 'place_of_worship') return 'worship';
  if (tags.class === 'park' || tags.subclass === 'park') return 'park';
  if (tags.class === 'hospital' || tags.class === 'school' || tags.class === 'fuel') return 'amenity';
  return null;
}

/**
 * Display name for the UI language. Requires a real name tag (name / name:lang / …);
 * never invents. Empty string → ignore the object.
 * Script filter: DE/EN need Latin letters (prefer name:en / name:de / transliteration);
 * AR needs Arabic letters. Mismatch → '' so banner+voice fall back to the street instruction.
 */
export function landmarkName(tags = {}, lang = 'en') {
  if (!tags) return '';
  const has = tags.name || tags['name:ar'] || tags['name:en'] || tags['name:de'] || tags['name:latin'] || tags.int_name || tags.brand;
  if (!has) return '';
  const chain = lang === 'ar'
    ? ['name:ar', 'name', 'name:en', 'brand']
    : lang === 'de'
      ? ['name:de', 'name:en', 'int_name', 'name:latin', 'name', 'brand']
      : ['name:en', 'int_name', 'name:latin', 'name', 'brand'];
  for (const k of chain) {
    const n = String(tags[k] || '').trim();
    if (!n) continue;
    // Mirror pickNameFor: for AR, plain `name` only if it is Arabic-script
    if (lang === 'ar' && k === 'name' && !AR_SCRIPT_RE.test(n)) continue;
    if (nameOkForLang(n, lang)) return n;
  }
  // Last resort: pickNameFor primary if it already matches the script
  const primary = (pickNameFor(tags, lang).primary || '').trim();
  return nameOkForLang(primary, lang) ? primary : '';
}

const AR_SCRIPT_RE = /[\u0600-\u06FF]/;
const LAT_SCRIPT_RE = /[A-Za-z\u00C0-\u024F]/
/** True when `name` has letters the UI language voice can read. */
export function nameOkForLang(name, lang = 'en') {
  if (!name) return false;
  const hasAr = AR_SCRIPT_RE.test(name);
  const hasLat = LAT_SCRIPT_RE.test(name);
  if (lang === 'ar') return hasAr;
  return hasLat; // en / de: need Latin (or transliterated) letters
}

/** German feminine landmark nouns → "der ", masculine/neuter → "dem ". Foreign/English → no article. */
const DE_DER_RE = /(Moschee|Kirche|Schule|Universit[aä]t|Synagoge|Kapelle|Anlage|Burg|Festung)\b/i;
const DE_DEM_RE = /(Platz|Park|Museum|Denkmal|Tor|Bahnhof|Krankenhaus|Dom|Palast|Schloss|Garten|Markt|Brunnen|Grab|Turm)\b/i;

/**
 * German article before the landmark name.
 * Only when the name clearly needs it (Omari-Moschee → "der "); never blind "der" on English/foreign names.
 */
export function deArticle(kind, name = '') {
  if (!name) return '';
  if (DE_DER_RE.test(name)) return 'der ';
  if (DE_DEM_RE.test(name)) return 'dem ';
  return '';
}

/** Strip a leading AR «بعد » so distance prompts do not emit «بعد … بعد …». */
export function stripNestedArAfter(instrText, lang) {
  if (lang !== 'ar' || !instrText) return instrText || '';
  return String(instrText).replace(/^بعد\s+/, '');
}

/**
 * Is the feature on the approach (before the turn)? "nach X" = after passing X.
 * approachBearing = travel direction toward the maneuver (degrees).
 */
export function isBeforeManeuver(maneuverLonLat, featureLonLat, approachBearing) {
  if (approachBearing == null || !Number.isFinite(approachBearing)) return true;
  const toM = bearing(featureLonLat, maneuverLonLat); // feature → maneuver
  let d = Math.abs(toM - approachBearing) % 360;
  if (d > 180) d = 360 - d;
  return d <= 90; // feature sits roughly upstream of the maneuver
}

function better(a, b) {
  // Prefer a landmark BEFORE the turn when possible ("nach X")
  if (a.before !== b.before) return a.before;
  // Prefer worship/square/historic over shop when distances are similar
  if (Math.abs(a.d - b.d) <= TIER_SLACK_M && a.tier !== b.tier) return a.tier < b.tier;
  if (a.d !== b.d) return a.d < b.d;
  return a.tier < b.tier;
}

/**
 * Pick at most one named landmark near a maneuver.
 * @param {[number,number]} loc maneuver [lon,lat]
 * @param {Array<{lon:number,lat:number,tags:object}>} features
 * @param {{lang?:string,radius?:number,approachBearing?:number}} [opts]
 * @returns {{name:string,kind:string,relation:'after'|'at',dist:number}|null}
 */
export function pickLandmark(loc, features, opts = {}) {
  if (!loc || !Number.isFinite(+loc[0]) || !Number.isFinite(+loc[1])) return null;
  const lang = opts.lang || 'en';
  const radius = opts.radius ?? LANDMARK_RADIUS_M;
  const approach = opts.approachBearing;
  let best = null;
  for (const f of features || []) {
    const tags = f.tags || {};
    const kind = classifyLandmark(tags);
    if (!kind) continue;
    const name = landmarkName(tags, lang);
    if (!name) continue; // unnamed ignored; never invent
    const lon = +f.lon, lat = +f.lat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const d = haversine(loc, [lon, lat]);
    if (d > radius) continue;
    const before = isBeforeManeuver(loc, [lon, lat], approach);
    const cand = { name, kind, d, tier: TIER[kind], before };
    if (!best || better(cand, best)) best = cand;
  }
  if (!best) return null;
  return { name: best.name, kind: best.kind, relation: best.before ? 'after' : 'at', dist: best.d };
}

/** Build "after/at landmark, <action>" from i18n templates ({art}{n}{a}). */
export function formatLandmarkInstr(lm, action, tpl) {
  if (!lm?.name || !action) return '';
  const art = tpl.art != null ? tpl.art : '';
  return String(tpl.text || '')
    .split('{art}').join(art)
    .split('{n}').join(lm.name)
    .split('{a}').join(action);
}

// ---------- in-memory index (loaded tiles / bundled POIs only – no network) ----------
let index = []; // { lon, lat, tags, bundled? }
/** Soft total hint; bundled Syria POIs are never evicted even if over this. */
export const INDEX_SOFT_MAX = 4000;
/** Max non-bundled (harvested) features kept; farthest from focus evicted first. */
export const HARVEST_MAX = 2000;
let focusLonLat = null; // [lon,lat] — current route/position for distance eviction

export function clearLandmarkIndex() { index = []; focusLonLat = null; }
export function getLandmarkIndex() { return index; }

/** Focus point for harvest eviction (route start, user position, or current maneuver). */
export function setLandmarkFocus(lonlat) {
  if (lonlat && Number.isFinite(+lonlat[0]) && Number.isFinite(+lonlat[1])) {
    focusLonLat = [+lonlat[0], +lonlat[1]];
  }
}
export function getLandmarkFocus() { return focusLonLat; }

function keyOf(f) {
  const n = f.tags?.name || f.tags?.['name:ar'] || f.tags?.['name:en'] || '';
  return `${f.lon.toFixed(5)}|${f.lat.toFixed(5)}|${n}`;
}

/** Keep every bundled/seeded POI; cap harvested by distance to focus (farthest dropped first). */
function trimLandmarkIndex() {
  const bundled = index.filter(f => f.bundled);
  let harvested = index.filter(f => !f.bundled);
  if (harvested.length <= HARVEST_MAX) {
    index = bundled.concat(harvested);
    return;
  }
  const origin = focusLonLat
    || (bundled[0] && [bundled[0].lon, bundled[0].lat])
    || (harvested[0] && [harvested[0].lon, harvested[0].lat]);
  if (origin) {
    harvested.sort((a, b) => haversine(origin, [a.lon, a.lat]) - haversine(origin, [b.lon, b.lat]));
    harvested = harvested.slice(0, HARVEST_MAX); // keep nearest
  } else {
    harvested = harvested.slice(-HARVEST_MAX);
  }
  index = bundled.concat(harvested);
}

/**
 * Replace or merge features into the index (dedupe by rounded lon/lat + name).
 * Bundled/seeded Syria POIs are flagged and never evicted. Harvested features are
 * capped by distance to the current focus (farthest first), never by insertion order.
 */
export function upsertLandmarks(features, { replace = false, bundled = false, focus } = {}) {
  if (focus) setLandmarkFocus(focus);
  if (replace) index = [];
  const seen = new Map(index.map(f => [keyOf(f), f]));
  for (const f of features || []) {
    const lon = +f.lon, lat = +f.lat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const tags = f.tags || {};
    if (!classifyLandmark(tags)) continue;
    if (!landmarkName(tags, 'en') && !landmarkName(tags, 'ar') && !landmarkName(tags, 'de')) continue;
    const k = keyOf({ lon, lat, tags });
    const isBundled = !!(bundled || f.bundled);
    const prev = seen.get(k);
    if (prev) {
      if (isBundled) prev.bundled = true; // upgrade harvested → bundled
      continue;
    }
    const entry = { lon, lat, tags, bundled: isBundled };
    seen.set(k, entry);
    index.push(entry);
  }
  trimLandmarkIndex();
  return index.length;
}

/** Seed from bundled Syria POI rows (js/poi.js P.all / toItem). Pure, offline. Never-evicted. */
export function seedFromSyriaPois(rows) {
  const out = [];
  for (const r of rows || []) {
    let tags;
    if (r.tags && (r.amenity || r.tourism || r.historic || r.shop || r.leisure || r.place || r.highway || r.tags.amenity)) {
      tags = { ...r.tags };
    } else if (r.c != null || r.osm) {
      try { tags = toItem(r).tags; } catch { tags = { ...(r.tags || {}) }; }
    } else {
      tags = { ...(r.tags || {}) };
      if (r.name) tags.name = r.name;
      if (r.ar) tags['name:ar'] = r.ar;
      if (r.en) tags['name:en'] = r.en;
    }
    if (!classifyLandmark(tags)) continue;
    out.push({ lon: r.lon, lat: r.lat, tags, bundled: true });
  }
  return upsertLandmarks(out, { bundled: true });
}

/**
 * Pull already-cached vector / GeoJSON features from the live map (no network).
 * Safe to call when map is missing or style not loaded.
 */
export function harvestFromMap(map) {
  if (!map || !map.getStyle) return 0;
  const found = [];
  // OpenMapTiles poi source (cached with basemap tiles)
  try {
    const fs = map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi' }) || [];
    for (const f of fs) {
      const c = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
      if (!c) continue;
      const tags = tileTags(f.properties || {});
      // also map place=square-like from class
      const p = f.properties || {};
      if (p.class === 'park') tags.leisure = tags.leisure || 'park';
      found.push({ lon: c[0], lat: c[1], tags });
    }
  } catch {}
  // place layer: squares / pedestrian plazas (named)
  try {
    const fs = map.querySourceFeatures('openmaptiles', { sourceLayer: 'place' }) || [];
    for (const f of fs) {
      const p = f.properties || {};
      if (p.class !== 'square' && p.subclass !== 'square') continue;
      const c = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
      if (!c) continue;
      const tags = tileTags(p);
      tags.place = 'square';
      found.push({ lon: c[0], lat: c[1], tags });
    }
  } catch {}
  // Rendered Syria / world POI layers
  try {
    const ids = LAYERS_RENDER.filter(id => map.getLayer(id));
    if (ids.length) {
      const fs = map.queryRenderedFeatures({ layers: ids }) || [];
      for (const f of fs) {
        const c = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
        if (!c) continue;
        const p = f.properties || {};
        let tags;
        if (p.class || p.subclass) tags = tileTags(p);
        else {
          tags = {};
          for (const k of ['name', 'name:ar', 'name:en', 'name:de', 'amenity', 'tourism', 'historic', 'shop', 'leisure', 'place', 'highway', 'brand', 'c']) {
            if (p[k] != null) tags[k === 'c' ? 'c' : k] = p[k];
          }
          // bundled layer stores category in `c`
          if (p.c && !classifyLandmark(tags)) {
            const fake = { c: p.c, name: p.name, ar: p['name:ar'], en: p['name:en'], lon: c[0], lat: c[1] };
            seedFromSyriaPois([fake]);
            continue;
          }
        }
        found.push({ lon: c[0], lat: c[1], tags });
      }
    }
  } catch {}
  return upsertLandmarks(found);
}

/** Approach bearing into a step from the previous step location (or bearing_after of previous). */
export function approachBearingFor(step, prev) {
  if (prev?.loc && step?.loc) return bearing(prev.loc, step.loc);
  if (prev && prev.bearing_after != null) return prev.bearing_after;
  return null;
}

/**
 * Attach `.landmark` onto each maneuver step (mutates). Uses the in-memory index only.
 * Depart/arrive keep no landmark. Max 1 per maneuver.
 */
/** Maneuver types where a landmark cue replaces the street-name instruction. */
const LM_TYPES = new Set([
  'turn', 'end of road', 'fork', 'continue', 'new name',
  'merge', 'on ramp', 'off ramp', 'notification',
]);

function landmarkEligible(s) {
  return !!(s && s.loc && LM_TYPES.has(s.type));
}

export function enrichStepsWithLandmarks(steps, lang = 'en', features = null) {
  const src = features || index;
  if (!steps?.length) return steps;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    delete s.landmark;
    // Skip depart/arrive/roundabout/rotary/ferry — landmark phrasing does not fit those cues
    if (!landmarkEligible(s)) continue;
    const prev = steps[i - 1];
    const lm = pickLandmark(s.loc, src, {
      lang,
      radius: LANDMARK_RADIUS_M,
      approachBearing: approachBearingFor(s, prev),
    });
    if (lm) s.landmark = lm;
  }
  return steps;
}

/** True when a step should prefer the landmark cue over the street-name instruction. */
export function stepUsesLandmark(s) {
  return !!(s && s.landmark && s.landmark.name && landmarkEligible(s));
}
