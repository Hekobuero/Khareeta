// Read the shipped js/i18n.js strings per language (no DOM: document is stubbed for setLang → applyDir).
globalThis.document ??= { documentElement: {} };
const { t, setLang } = await import('../../js/i18n.js');
const KEYS = ['catLiveWait', 'catTileOnly', 'catLiveDown', 'tryAgain', 'emChip'];
const dict = l => { setLang(l); const o = {}; for (const k of KEYS) { const v = t(k); if (v !== k) o[k] = v; } return o; };
export const EN = dict('en'), AR = dict('ar'), DE = dict('de');
setLang('en');
