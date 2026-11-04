// Minimal iOS-WebKit-like environment for js/voice.js in Node (no browser). Models the iOS quirks we work around:
// - getVoices() is empty until speech was used once inside a user gesture, no "voiceschanged" event
// - speak() outside a gesture before unlock is silently ignored
// - speak() right after cancel() is dropped
// - utterances can be paused when the page is hidden
export function installIOS({ voices = [], voicesAfterUnlock = true, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } = {}) {
  const listeners = {}, docL = {};
  const store = new Map();
  const log = { spoken: [], dropped: [], cancels: 0, resumes: 0 };
  let gesture = false, unlocked = false, lastCancel = -1e9, list = voicesAfterUnlock ? [] : voices.slice();
  class U { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.volume = 1; this.rate = 1; this.pitch = 1; this._l = {}; }
    addEventListener(n, f) { (this._l[n] ||= []).push(f); } _fire(n) { (this._l[n] || []).forEach(f => f({})); this['on' + n]?.({}); } }
  const syn = {
    speaking: false, pending: false, paused: false, _cur: null,
    getVoices: () => list.slice(),
    speak(u) {
      if (!unlocked && !gesture) { log.dropped.push({ text: u.text, why: 'no-gesture' }); return; }
      if (Date.now() - lastCancel < 50) { log.dropped.push({ text: u.text, why: 'after-cancel' }); return; }
      unlocked = true; if (voicesAfterUnlock && !list.length) setTimeout(() => { list = voices.slice(); }, 10);
      log.spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.name || null, vol: u.volume });
      this._cur = u; this.speaking = true;
      setTimeout(() => { if (this._cur === u) { this._cur = null; this.speaking = false; u._fire('end'); } }, u.volume === 0 ? 5 : 40);
    },
    cancel() { log.cancels++; lastCancel = Date.now(); const c = this._cur; this._cur = null; this.speaking = false; c?._fire('error'); },
    pause() { this.paused = true; }, resume() { log.resumes++; this.paused = false; },
    addEventListener() {}, removeEventListener() {},
  };
  const document = { visibilityState: 'visible', addEventListener: (n, f) => (docL[n] ||= []).push(f), removeEventListener: (n, f) => { docL[n] = (docL[n] || []).filter(x => x !== f); },
    querySelector: () => ({ textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }), querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {} }),
    documentElement: { lang: 'en', dir: 'ltr', classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {} }, body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } } };
  Object.assign(globalThis, {
    window: globalThis, document, speechSynthesis: syn, SpeechSynthesisUtterance: U,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  });
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua, language: 'en-US', languages: ['en-US'], maxTouchPoints: 5 }, configurable: true });
  return {
    syn, log, store,
    tap(fn) { gesture = true; try { docL.pointerdown?.forEach(f => f({})); return fn?.(); } finally { gesture = false; } }, // a user gesture
    hide() { document.visibilityState = 'hidden'; syn.pause(); docL.visibilitychange?.forEach(f => f({})); },
    show() { document.visibilityState = 'visible'; docL.visibilitychange?.forEach(f => f({})); },
  };
}
export const wait = ms => new Promise(r => setTimeout(r, ms));
