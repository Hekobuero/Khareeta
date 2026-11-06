// Live category search timing (pure, no DOM, no network – tested in tests/poi/live-fallback.test.mjs).
// P0 (Hidro, Bad Godesberg, 2026-11-06): with every Overpass mirror down the chip sheet stayed on skeleton bars while
// Overpass timed out. Now Nominatim starts in parallel after a short head start, the first non-empty OSM answer wins,
// tile POIs are shown at once (core flow in js/search.js) and a hard deadline ends in honesty copy + "Try again".
export const LIVE_OP_TIMEOUT = 6000;   // per Overpass mirror request (was 9 s × 2 mirrors in series/hedged)
export const LIVE_OP_HEDGE = 1500;     // second mirror after 1.5 s without answer
export const LIVE_NOM_DELAY = 1200;    // Nominatim joins after 1.2 s if Overpass has not answered yet
export const LIVE_DEADLINE = 12000;    // whole live search (all radii) – then tile hits or honesty + retry
const delay = ms => new Promise(r => setTimeout(r, ms));

/** One search box: Overpass vs. Nominatim. Overpass answer (even empty) is authoritative; a non-empty Nominatim answer
 *  wins if it is first. Rejects only when both failed. Resolves { elements, src, opDown }. */
export function raceBox(runOp, runNom, { nomDelay = LIVE_NOM_DELAY, opDown = false, wait = delay } = {}) {
  return new Promise((resolve, reject) => {
    let done = false, opErr = opDown ? new Error('overpass down') : null, nomErr = null, opRes = null, nomRes = null, nomStarted = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const check = () => {
      if (done) return;
      if (opRes) return fin({ elements: opRes.elements || [], src: 'overpass', opDown: false });
      if (nomRes && nomRes.length) return fin({ elements: nomRes, src: 'nominatim', opDown: !!opErr });
      if (opErr && nomRes) return fin({ elements: nomRes, src: 'nominatim', opDown: true });
      if (opErr && nomErr) { done = true; reject(nomErr); }
    };
    const startNom = () => {
      if (nomStarted || done) return; nomStarted = true;
      Promise.resolve().then(runNom).then(r => { nomRes = (r && r.elements) || []; check(); }, e => { nomErr = e || new Error('nominatim'); check(); });
    };
    if (!opDown) Promise.resolve().then(runOp).then(j => { opRes = j || { elements: [] }; check(); }, e => { opErr = e || new Error('overpass'); startNom(); check(); });
    if (opDown) startNom(); else wait(nomDelay).then(startNom);
  });
}

/** Walk the radii (2.5/5/10 km) until a box has results, under one deadline. Overpass failing once skips it for the
 *  wider boxes. Resolves { elements, src } (elements may be empty) or rejects (all failed / deadline / stale). */
export function liveCategory(boxes, runOp, runNom, { deadline = LIVE_DEADLINE, nomDelay = LIVE_NOM_DELAY, wait = delay, isStale = () => false } = {}) {
  const walk = (async () => {
    let opDown = false, last = { elements: [], src: 'none' };
    for (const b of boxes) {
      const r = await raceBox(() => runOp(b), () => runNom(b), { nomDelay, opDown, wait });
      if (isStale()) throw Object.assign(new Error('stale'), { stale: true });
      opDown = opDown || r.opDown; last = r;
      if (r.elements.length) return r;
    }
    return last;
  })();
  return Promise.race([walk, wait(deadline).then(() => { throw Object.assign(new Error('deadline'), { deadline: true }); })]);
}

/** Which state the category sheet shows after a live attempt (pure decision, for tests and js/search.js). */
export function liveOutcome({ live = null, failed = false, tiles = 0 }) {
  if (live && live.length) return 'live';
  if (tiles) return failed ? 'tiles-down' : 'tiles';
  return failed ? 'down' : 'empty';
}
