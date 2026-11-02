// Voice guidance – Web Speech API with ON-DEVICE voices only (no cloud TTS, no keys, works offline).
// - Voice choice: local voices only (localService !== false, no Edge "Online (Natural)", no remote "Google …" desktop voices),
//   male / best voices first by name list (Apple, Windows, Android/ChromeOS), Arabic region chain ar-SY → ar-SA → ar-001 → ar-*.
// - getVoices() is async: "voiceschanged" plus a short poll (iOS Safari never fires the event).
// - Spoken texts come from i18n (`vo`; Arabic: `vo` = Syrian, `voMsa` = Standard Arabic, see arVariant()).
// - Timing: one early prompt (car ≈ 13 s ahead = 300–700 m by speed; walk 30 m) plus "now"; close maneuvers chained ("…, then …").
// - Own queue: a running prompt is never cut by the next one (only "recalculating" and the test button interrupt); no repeats.
import { settings, saveSettings, toast } from './util.js';
import { t, getLang } from './i18n.js';

const SYN = () => ('speechSynthesis' in window ? window.speechSynthesis : null);
const UA = navigator.userAgent || '';
const OS = /Android/i.test(UA) ? 'android' : /CrOS/.test(UA) ? 'cros' : /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1) ? 'ios' : /Macintosh/.test(UA) ? 'mac' : /Windows/.test(UA) ? 'win' : 'other';
// region preference per app language (index = rank, earlier = better); anything else in that language comes last
const REGIONS = { ar: ['ar-sy', 'ar-sa', 'ar-001'], en: ['en-gb', 'en-us'], de: ['de-de'] };

// ---------- gender / quality heuristics (names from the Readium speech voice lists) ----------
const MALE = new Set('majed maged tarik naayf markus viktor yannick martin stefan michael karsten evan nathan tom alex aaron jamie oliver daniel arthur lee gordon rishi aman david mark george richard ravi sean james fred ralph junior albert eddy reed rocko grandpa'.split(' '));
const FEMALE = new Set('mariam laila hoda petra anna helena hedda katja samantha ava allison susan zoe kate serena stephanie martha karen matilda catherine moira tessa fiona zira hazel linda heera isha tara sangeeta veena victoria nicky joelle noelle kathy flo sandy shelley grandma'.split(' '));
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
const ANDROID_M = /-x-(ard|are|deb|deg|iom|iol|tpd|rjs|gbb|gbd|aub|aud|end|ene)(-|$)/i, ANDROID_F = /-x-(arc|arz|dea|nfh|tpc|iob|iog|tpf|sfg|gba|gbc|gbg|aua|auc|ena|enc)(-|$)/i;
const CROS_M = /(Deutsch [34]|US English [346]|UK English [135]|Australian English [245])\b/, CROS_F = /(Deutsch [12]|US English [12578]|UK English [2467]|Australian English [13])\b/;
const baseName = v => {
  const n = String(v.name || ''), a = n.match(/\b([a-z]{2,3}-[a-z]{2,3}-x-[a-z]{3})\b/i); // Android "… from Google ar-xa-x-ard-local"
  return a ? 'Google ' + a[1] : n.replace(/^(Microsoft|Apple|Google)\s+/i, '').replace(/\s*[-–(].*$/, '').trim();
};
export function gender(v) {
  const n = v.name || '', b = baseName(v).toLowerCase().split(/\s+/)[0];
  if (ANDROID_M.test(n) || CROS_M.test(n) || /\b(male|männlich)\b|ذكر/i.test(n)) return 'm';
  if (ANDROID_F.test(n) || CROS_F.test(n) || /\b(female|weiblich)\b|أنثى|انثوي/i.test(n)) return 'f';
  return MALE.has(b) ? 'm' : FEMALE.has(b) ? 'f' : '';
}
export function isCloud(v) {
  const n = v.name || '';
  if (v.localService === false) return true;
  if (/\bOnline\b/i.test(n) || /-network$/i.test(n)) return true; // Edge "… Online (Natural)", Android network variants
  if (/^Google\s/.test(n) && OS !== 'android' && OS !== 'cros') return true; // Chrome desktop "Google …" voices are server-side
  return false;
}
const normLang = v => String(v.lang || '').replace(/_/g, '-').toLowerCase();
const inLang = (v, lang) => { const l = normLang(v); return l === lang || l.startsWith(lang + '-') || (lang === 'ar' && l === 'ara'); };
function score(v, lang) {
  const l = normLang(v), reg = REGIONS[lang] || [], ri = reg.indexOf(l), rs = ri < 0 ? 0 : reg.length - ri;
  let s = (lang === 'ar' ? 300 : 15) * rs; // Arabic: region chain first (a Syrian voice beats everything), other languages: gender first
  const g = gender(v); if (g === 'm') s += 100; else if (!g) s += 40;
  if (/premium/i.test(v.name)) s += 12; else if (/enhanced|erweitert|محسّن/i.test(v.name)) s += 8; else if (/natural/i.test(v.name)) s += 6;
  if (NOVELTY.test(baseName(v))) s -= 150;
  if (v.default) s += 2;
  return s;
}

// ---------- voice list (async) ----------
let all = [], loaded = false;
const subs = new Set();
export function onVoices(cb) { subs.add(cb); return () => subs.delete(cb); }
function refresh() {
  const s = SYN(); if (!s) return;
  let vs = []; try { vs = s.getVoices() || []; } catch {}
  const changed = vs.length !== all.length || vs.some((v, i) => v !== all[i]);
  all = vs; if (vs.length) loaded = true;
  if (changed) subs.forEach(cb => { try { cb(); } catch {} });
}
function init() {
  const s = SYN(); if (!s) return;
  refresh();
  try { s.addEventListener ? s.addEventListener('voiceschanged', refresh) : (s.onvoiceschanged = refresh); } catch {}
  let n = 0; const poll = setInterval(() => { refresh(); if (loaded || ++n > 20) clearInterval(poll); }, 250); // iOS: no voiceschanged
  // iOS/Safari only speak after a user gesture: unlock with a silent utterance on the first tap
  // (only once a local voice is known – never an utterance without a known on-device voice)
  const unlock = () => {
    refresh(); const v = chosenVoice();
    if (!v || settings.voice === false) return; // try again on the next tap
    document.removeEventListener('pointerdown', unlock, true);
    try { if (!s.speaking && !cur) { const u = new SpeechSynthesisUtterance(' '); u.voice = v; u.lang = v.lang; u.volume = 0; s.speak(u); } } catch {}
  };
  document.addEventListener('pointerdown', unlock, true);
}
init();

/** Candidates for a language, best first. Cloud voices are never returned. */
export function voicesFor(lang = getLang()) {
  return all.filter(v => inLang(v, lang) && !isCloud(v)).map(v => ({ v, s: score(v, lang) })).sort((a, b) => b.s - a.s || String(a.v.name).localeCompare(b.v.name)).map(x => x.v);
}
/** 'ok' | 'none' (no voice in this language) | 'online' (only cloud voices) | 'unknown' (browser lists nothing) | 'unsupported' */
export function voiceState(lang = getLang()) {
  if (!SYN()) return 'unsupported';
  if (!all.length) return 'unknown';
  if (voicesFor(lang).length) return 'ok';
  return all.some(v => inLang(v, lang)) ? 'online' : 'none';
}
const vid = v => v.voiceURI || v.name;
export function pickedId(lang = getLang()) { return (settings.voicePick || {})[lang] || ''; }
export function setPicked(id, lang = getLang()) { settings.voicePick = Object.assign({}, settings.voicePick, { [lang]: id || '' }); saveSettings(); }
export function chosenVoice(lang = getLang()) {
  const c = voicesFor(lang), id = pickedId(lang);
  return (id && c.find(v => vid(v) === id)) || c[0] || null;
}

// ---------- text ----------
/** Arabic text variant: 'syr' (Shami) only when the voice itself is Levantine or the user chose it; MSA voices read MSA. */
export function arVariant() {
  const d = settings.voiceDialect || 'auto';
  if (d === 'syr' || d === 'msa') return d;
  const v = chosenVoice('ar');
  return v && /^ar-(sy|lb|jo|ps)\b/.test(normLang(v)) ? 'syr' : 'msa';
}
function V() { return getLang() === 'ar' && arVariant() === 'msa' ? t('voMsa') : t('vo'); }
const fill = (s, vars) => { for (const k in vars) s = s.split('{' + k + '}').join(vars[k]); return s; };
const cap = s => s.charAt(0).toLocaleUpperCase(getLang()) + s.slice(1);
const low = s => getLang() === 'en' ? s.charAt(0).toLowerCase() + s.slice(1) : s;
// display text → spoken: no road numbers in brackets ("Damascus Road (M5)"), no trailing punctuation
const strip = s => String(s || '').replace(/\s*[(（][^)）]*[)）]/g, '').replace(/\s{2,}/g, ' ').replace(/[.!…]+$/, '').trim();

/** Spoken distance, rounded (<100 m to 10 m, <1 km to 50 m, <10 km to 0.5 km, from 10 km to whole km). */
export function spokenDist(m) {
  const o = V(), lang = getLang();
  m = Math.max(10, m < 100 ? Math.round(m / 10) * 10 : m < 1000 ? Math.round(m / 50) * 50 : m < 9750 ? Math.round(m / 500) * 500 : Math.round(m / 1000) * 1000);
  if (m >= 1000) {
    const k = m / 1000;
    if (k === 1.5) return o.km15;
    if (lang === 'ar') {
      const w = Math.floor(k), h = k % 1 ? o.half : '';
      if (w <= 10) return o.kms[w] + h;
      // MSA number agreement: 11–99 → singular accusative (كيلومترًا), 3–10 → plural, 100/1000/… → singular genitive
      const r = k % 100, tpl = (r >= 11 && o.kmT) ? o.kmT : (r >= 3 && r <= 10 && o.kmP) ? o.kmP : o.km;
      return fill(tpl, { n: String(k) });
    }
    if (k === 1) return o.km1;
    return fill(o.km, { n: lang === 'de' ? String(k).replace('.', ',') : String(k) });
  }
  if (lang !== 'ar') return fill(o.m, { n: String(m) });
  if (m === 10) return o.m10;
  const h = Math.floor(m / 100), te = (m % 100) / 10;
  if (!te) return fill(o.mH, { n: o.hund[h] });
  return fill(o.mT, { n: (h ? o.hundW[h] + o.and : '') + o.tens[te] });
}
// street names are only spoken when their script fits the voice language (an English voice can't read Arabic script);
// road numbers (ref) are only spoken when the road has no name
function nameFor(s) {
  const n = strip(s.name) || (s.ref || '').split(';')[0].trim();
  if (!n) return '';
  const ar = /[\u0600-\u06FF]/.test(n);
  return getLang() === 'ar' ? (ar || /^[A-Z]{0,2}\d+$/.test(n) ? n : '') : (ar ? '' : n);
}
function maneuver(s, fallback) {
  const o = V(), m = s.modifier || 'straight', n = nameFor(s);
  const ord = x => o.ord[x - 1] || String(x);
  const withName = a => n ? fill(o.onto, { a, n }) : a;
  const own = (k, kOnto) => o[k] ? (n && o[kOnto] ? fill(o[kOnto], { n }) : o[k]) : null; // variant-specific text (Syrian) if defined
  switch (s.type) {
    case 'roundabout': case 'rotary': case 'roundabout turn': case 'exit roundabout': case 'exit rotary':
      return s.exit ? (n ? fill(o.rbtOnto, { x: ord(s.exit), n }) : fill(o.rbt, { x: ord(s.exit) })) : o.rbtEnter;
    case 'new name': case 'continue': case 'notification':
      if (m === 'straight' || !o.mods[m]) return n ? fill(o.contOn, { n }) : o.cont;
      return withName(o.mods[m]);
    case 'fork': return withName(o.mods[/left/.test(m) ? 'slight left' : 'slight right']);
    case 'turn': case 'end of road': return withName(o.mods[m] || o.mods.straight);
    case 'merge': return own('merge', 'mergeOnto') || (fallback ? low(strip(fallback(s))) : withName(o.mods.straight));
    case 'on ramp': return own('ramp', 'rampOnto') || (fallback ? low(strip(fallback(s))) : withName(o.mods[m] || o.mods.straight));
    case 'off ramp': return own('exitRamp', 'exitOnto') || (fallback ? low(strip(fallback(s))) : withName(o.mods[m] || o.mods.straight));
    case 'ferry': return own('ferry') || (fallback ? low(strip(fallback(s))) : o.cont);
    default: return fallback ? low(strip(fallback(s))) : withName(o.mods[m] || o.mods.straight); // depart etc.: display text
  }
}
function arriveFrag(s, key) { const o = V(); return s.modifier === 'left' ? o[key + 'L'] : s.modifier === 'right' ? o[key + 'R'] : o[key + 'Dest']; }
/** Text for one prompt. stage: 'pre' (with distance) or 'now'. next: a close following maneuver to chain ("…, then …").
 *  Returns '' when nothing should be said. */
export function announce(s, stage, dist, fallback, next = null) {
  const o = V();
  if (s.type === 'arrive') {
    if (!s.last) { // waypoint: say it once, at the stop
      if (stage !== 'now') return '';
      return o.wp ? cap(fill(o.wp, { n: String((s.leg || 0) + 1) })) + '.' : (fallback ? cap(strip(fallback(s))) + '.' : '');
    }
    if (stage === 'now') return ''; // final arrival is spoken by route.js (remaining < 25 m) via arriveText()
    return cap(fill(o.inDist, { d: spokenDist(dist), i: arriveFrag(s, 'soon') }));
  }
  let i = maneuver(s, fallback);
  if (next) i += next.type === 'arrive' && next.last ? arriveFrag(next, 'then') : fill(o.then, { b: maneuver(next, fallback) });
  return cap(stage === 'now' ? fill(o.now, { i }) : fill(o.inDist, { d: spokenDist(dist), i }));
}
export function arriveText(s) { return arriveFrag(s || {}, 'arrive'); }
export function reroutingText() { return V().rerouting; }
export function sampleText() { return announce({ type: 'turn', modifier: 'right' }, 'pre', 300); }
/** [early, now] trigger distances in metres. Car: early ≈ 13 s ahead (300–700 m), "now" ≈ 2.5 s (35–90 m).
 *  Final arrival on foot: early prompt at 60 m, so it is not cut by the arrival message at 25 m. */
export function thresholds(mode, speed, finalArrive = false) {
  if (mode === 'car') { const v = speed > 1 ? speed : 14; return [Math.min(700, Math.max(300, v * 13)), Math.min(90, Math.max(35, v * 2.5))]; }
  if (mode === 'bike') return [120, 30];
  return finalArrive ? [60, 12] : [30, 12]; // walking
}
// two maneuvers closer than this are announced together ("Now turn left, then turn right")
const THEN_GAP = { car: 150, bike: 60, foot: 40 };

// ---------- navigation prompts (called from route.js onPos) ----------
// `said` remembers prompts per maneuver location so a recalculated route does not repeat what was just announced.
const said = new Map(); // key → time
const SAID_TTL = 180000;
const mkey = (st, stage) => `${(+st.loc?.[0] || 0).toFixed(4)},${(+st.loc?.[1] || 0).toFixed(4)}|${st.type}|${st.modifier || ''}|${stage}`;
function wasSaid(st, stage) { const t0 = said.get(mkey(st, stage)); return t0 != null && Date.now() - t0 < SAID_TTL; }
function markSaid(st, stage) { said.set(mkey(st, stage), Date.now()); }
/**
 * One call per position fix. r = route, idx = index of the next maneuver, distTo = metres to it,
 * spoken = route.js N.spoken (reset per route), fallback = display text builder (instr).
 */
export function navPrompt(r, idx, distTo, mode, speed, fallback, spoken) {
  const steps = r.steps, step = steps[idx]; if (!step || idx <= 0) return;
  const along = r._stepAlong || [];
  const th = thresholds(mode, speed, step.type === 'arrive' && step.last);
  // start prompt: on the first fix of a route, if the first maneuver is still far away ("Follow the road. In 2 km, turn left.")
  if (!spoken.start) {
    spoken.start = 1;
    if (distTo > th[0] * 1.3 && !wasSaid(step, 'start') && !wasSaid(step, 'pre')) {
      const txt = announce(step, 'pre', distTo, fallback);
      if (txt) { markSaid(step, 'start'); speak(fill(V().start, { i: txt })); }
    }
  }
  for (let k = 1; k >= 0; k--) {
    if (distTo > th[k]) continue;
    const stage = k === 1 ? 'now' : 'pre';
    if (!spoken[idx + ':' + k]) {
      for (let j = 0; j <= k; j++) spoken[idx + ':' + j] = 1;
      if (wasSaid(step, stage)) break; // already announced before a recalculation
      for (let j = 0; j <= k; j++) markSaid(step, j ? 'now' : 'pre');
      const next = steps[idx + 1], gap = next && along[idx + 1] != null ? along[idx + 1] - along[idx] : Infinity;
      const chain = next && gap < (THEN_GAP[mode] || 60) && step.type !== 'arrive' && !(next.type === 'arrive' && !next.last) ? next : null;
      if (chain) { spoken[(idx + 1) + ':0'] = 1; markSaid(chain, 'pre'); } // the chained maneuver gets only its "now"
      speak(announce(step, stage, distTo, fallback, chain));
    }
    break;
  }
}

// ---------- speaking (own queue: a running prompt is never cut by the next one) ----------
let last = '', lastT = 0, warned = {}, cur = null, guard = null, queue = [];
const MAX_WAIT = 8000; // queued prompts older than this are dropped (stale distance)
function finish(u) { if (cur !== u) return; cur = null; clearTimeout(guard); const now = Date.now(); while (queue.length) { const q = queue.shift(); if (now - q.t < MAX_WAIT) { play(q.text); return; } } }
function play(text) {
  const s = SYN(), lang = getLang(), v = chosenVoice(lang);
  if (!s || !v) return false;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v; u.lang = v.lang; u.rate = 1; u.pitch = 1;
    u.onend = u.onerror = () => finish(u);
    cur = u; last = text; lastT = Date.now();
    clearTimeout(guard); guard = setTimeout(() => finish(u), Math.min(15000, 1500 + text.length * 110)); // engines that never fire onend
    s.speak(u);
    if (s.paused) s.resume();
    return true;
  } catch { cur = null; return false; }
}
/**
 * Speak with an on-device voice only. Never sets just u.lang (that could pick a cloud voice) – without a known
 * local voice nothing is spoken. Default: queue behind a running prompt. interrupt: cut the running prompt
 * (recalculating, test button). force: ignore the on/off switch (test button).
 */
export function speak(text, { force = false, interrupt = false } = {}) {
  const s = SYN(); text = String(text || '').trim();
  if (!s || !text || (!force && settings.voice === false)) return false;
  if (!force && ((text === last && Date.now() - lastT < 8000) || queue.some(q => q.text === text))) return false; // no duplicates
  refresh();
  const lang = getLang(), st = voiceState(lang);
  if (st !== 'ok') {
    if (st !== 'unsupported' && !warned[lang]) { warned[lang] = 1; toast(t('noVoice', { l: t('vLang') }), 4000); }
    return false; // never a cloud voice, a wrong-language voice or an unknown engine default
  }
  if (interrupt || force) { queue = []; const c = cur; cur = null; clearTimeout(guard); if (c || s.speaking || s.pending) try { s.cancel(); } catch {} return play(text); }
  if (cur) { queue.push({ text, t: Date.now() }); if (queue.length > 2) queue.shift(); return true; }
  return play(text);
}
/** Stop immediately (navigation ended / voice switched off): clears the queue, the repeat guard and the per-route memory. */
export function stopSpeaking() { queue = []; cur = null; clearTimeout(guard); last = ''; said.clear(); try { SYN()?.cancel(); } catch {} }

// ---------- settings rows (inside the drawer's Navigation group, DESIGN §4.9) ----------
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vLabel = v => { const g = gender(v); return `${baseName(v) || v.name} · ${v.lang}${g ? ' · ' + t(g === 'm' ? 'vMale' : 'vFemale') : ''}`; };
const tip = () => t({ ios: 'vTipIos', mac: 'vTipMac', android: 'vTipAndroid', cros: 'vTipAndroid', win: 'vTipWin' }[OS] || 'vTipOther', { l: t('vLang') });
export function voiceRowsHtml(icon) {
  if (settings.voice === false) return '';
  const lang = getLang(), st = voiceState(lang), list = voicesFor(lang), cur = pickedId(lang), best = list[0];
  let h = '';
  if (list.length) {
    h += `<label class="ditem vsel-row" for="dVoiceSel">${icon('volume')}<span class="vsel-l">${t('vVoice')}</span><select id="dVoiceSel" class="vsel" dir="auto">
      <option value="">${escH(t('vAutoPick', { n: baseName(best) || best.name }))}</option>
      ${list.map(v => `<option value="${escH(vid(v))}" ${vid(v) === cur ? 'selected' : ''}>${escH(vLabel(v))}</option>`).join('')}</select></label>`;
  }
  if (lang === 'ar' && st === 'ok') {
    const d = settings.voiceDialect || 'auto';
    h += `<div class="ditem vblock"><div class="vsub">${t('vDialect')}</div><div class="seg" id="dVoiceDial" role="radiogroup">${[['auto', t('vDialAuto')], ['syr', t('vDialSyr')], ['msa', t('vDialMsa')]].map(([k, n]) => `<button data-v="${k}" role="radio" aria-checked="${d === k}" class="${d === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      ${arVariant() === 'msa' && d === 'auto' ? `<div class="vhint">${t('vMsaHint')}</div>` : ''}</div>`;
  }
  if (st !== 'unsupported') h += `<button class="ditem" id="dVoiceTest" ${st !== 'ok' ? 'disabled aria-disabled="true"' : ''}>${icon('volume')}<span>${t('vTest')}<small class="vsample" dir="auto">${escH(sampleText())}</small></span></button>`;
  if (st === 'none' || st === 'online' || st === 'unknown' || st === 'unsupported') {
    const K = { online: 'vOnline', unknown: 'vList', unsupported: 'vNoTts' }[st] || 'vNone';
    h += `<div class="ditem vnote" id="dVoiceNote" data-state="${st}" role="status">${icon('info')}<div><b>${t(K + 'T', { l: t('vLang') })}</b><p>${t(K + 'B', { l: t('vLang') })}</p>${st === 'unsupported' ? '' : `<p class="vtip">${tip()}</p>`}</div></div>`;
  } else if (OS === 'android') h += `<div class="ditem vnote">${icon('info')}<div><p>${t('vAndroidHint')}</p></div></div>`;
  return h;
}
/** Wire the rows; rerender() redraws the drawer (also called when the voice list arrives late). */
let unsub = null;
export function bindVoiceRows(root, rerender) {
  unsub?.(); unsub = onVoices(() => { if (root.classList.contains('open')) rerender(); });
  const sel = root.querySelector('#dVoiceSel');
  if (sel) sel.onchange = () => { setPicked(sel.value); speak(sampleText(), { force: true }); rerender(); };
  const dial = root.querySelector('#dVoiceDial');
  if (dial) dial.onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; settings.voiceDialect = b.dataset.v; saveSettings(); rerender(); };
  const test = root.querySelector('#dVoiceTest');
  if (test) test.onclick = () => speak(sampleText(), { force: true }); // inside the tap → also unlocks speech on iOS (interrupts)
}
