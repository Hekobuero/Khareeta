// Locale-aware formatting (DESIGN §6.4). Every distance, duration and time goes through here.
import { t, getLang } from './i18n.js';
import { settings } from './util.js';

export function locale() {
  const l = getLang();
  if (l === 'ar') return settings.arabicDigits ? 'ar-SY-u-nu-arab' : 'ar-SY-u-nu-latn';
  return l === 'de' ? 'de-DE' : 'en-GB';
}
const cache = new Map();
function F(opts = {}) { const k = locale() + JSON.stringify(opts); if (!cache.has(k)) { try { cache.set(k, new Intl.NumberFormat(locale(), opts)); } catch { cache.set(k, new Intl.NumberFormat('en-GB', opts)); } } return cache.get(k); }
export function nf(n, opts) { return F(opts).format(n); }
export function digits(s) { return getLang() === 'ar' && settings.arabicDigits ? String(s).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[d]) : String(s); }
export function fmtDist(m) {
  if (m == null || isNaN(m)) return '';
  if (m < 950) return nf(m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10) + '\u00a0' + t('m');
  return nf(m < 10000 ? Math.round(m / 100) / 10 : Math.round(m / 1000), { maximumFractionDigits: 1 }) + '\u00a0' + t('km');
}
export function fmtDur(s) {
  const mins = Math.max(1, Math.round(s / 60));
  if (mins < 60) return nf(mins) + '\u00a0' + t('min');
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h >= 24) { const d = Math.floor(h / 24); return nf(d) + '\u00a0' + t('d') + ' ' + nf(h % 24) + '\u00a0' + t('h'); }
  return nf(h) + '\u00a0' + t('h') + (m ? ' ' + nf(m) + '\u00a0' + t('min') : '');
}
export function fmtTime(date) {
  try { return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(date); } catch { return date.toTimeString().slice(0, 5); }
}
export function fmtBytes(b) { if (b < 1048576) return nf(Math.round(b / 1024)) + '\u00a0KB'; return nf(Math.round(b / 1048576 * 10) / 10) + '\u00a0MB'; }
