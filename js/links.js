// Pure helpers for contact data from OSM tags (no DOM) – phone, website, social links. Also used by tests/placeinfo.
// OSM data is untrusted: every URL is rebuilt from a validated handle/number or checked to be http(s) on the expected
// host; callers still escape everything they put into HTML.
const CC = '963'; // Syria

// One phone value → { tel: '+963112345678', display: '+963 11 234 5678' } or null.
export function normPhone(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).trim();
  s = s.replace(/^tel:/i, '').replace(/\s*(?:ext\.?|x|#).*$/i, '');
  if (!/^[+\d\s().\-\/]{4,30}$/.test(s)) return null;
  const plus = s.startsWith('+');
  let d = s.replace(/\D/g, '');
  if (!plus && d.startsWith('00')) d = d.slice(2);
  else if (!plus && d.startsWith('0')) d = CC + d.slice(1); // national format 0xx …
  else if (!plus && d.length === 9 && d[0] === '9') d = CC + d; // mobile without trunk 0
  else if (!plus && !d.startsWith(CC) && d.length >= 6 && d.length <= 8) return { tel: d, display: d }; // short/local number
  if (d.startsWith(CC + '0')) d = CC + d.slice(4); // +963 (0)11 …
  if (d.length < 8 || d.length > 15) return null;
  return { tel: '+' + d, display: fmtIntl(d) };
}
function fmtIntl(d) {
  if (!d.startsWith(CC)) return '+' + d;
  const n = d.slice(3);
  if (n[0] === '9' && n.length === 9) return `+${CC} ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`; // mobile 9xx xxx xxx
  if (n.length === 9) return `+${CC} ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`; // 11 xxx xxxx
  if (n.length === 8) return `+${CC} ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`; // 11 xxx xxx
  return n.length > 4 && n[0] !== '9' ? `+${CC} ${n.slice(0, 2)} ${n.slice(2)}` : `+${CC} ${n}`;
}
// All phone numbers of a feature (phone, contact:phone, mobile; several separated by ";" or ","), de-duplicated.
export function phones(tags = {}) {
  const raw = ['phone', 'contact:phone', 'phone:mobile', 'contact:mobile', 'mobile'].map(k => tags[k]).filter(Boolean).join(';');
  const out = [], seen = new Set();
  for (const p of raw.split(/\s*[;,]\s*/)) { const n = normPhone(p); if (n && !seen.has(n.tel)) { seen.add(n.tel); out.push(n); } }
  return out.slice(0, 6);
}

// Safe absolute http(s) URL or null. Adds https:// when the scheme is missing.
export function safeUrl(v) {
  if (v == null) return null;
  let s = String(v).trim().split(/\s*;\s*/)[0];
  if (!s || /\s/.test(s) || s.length > 500) return null;
  if (/^\/\//.test(s)) s = 'https:' + s;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  let u; try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) && !/^xn--/.test(u.hostname)) return null;
  if (u.username || u.password) return null;
  return u;
}
export const domainOf = u => u.hostname.replace(/^www\.|^m\./i, '').toLowerCase();

const SOC = {
  facebook: { hosts: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i, handle: /^[A-Za-z0-9.\-]{2,80}$/, base: 'https://www.facebook.com/' },
  instagram: { hosts: /(^|\.)(instagram\.com|instagr\.am)$/i, handle: /^[A-Za-z0-9._]{1,30}$/, base: 'https://www.instagram.com/' },
  telegram: { hosts: /(^|\.)(t\.me|telegram\.me|telegram\.dog)$/i, handle: /^[A-Za-z0-9_]{4,32}$/, base: 'https://t.me/' },
  whatsapp: { hosts: /(^|\.)(wa\.me|whatsapp\.com)$/i },
};
// Build a social link from a handle or a URL. Returns { href, label } or null when the value is not usable.
export function socialLink(kind, v) {
  const c = SOC[kind]; if (!c || v == null) return null;
  let s = String(v).trim().split(/\s*;\s*/)[0];
  if (!s) return null;
  if (kind === 'whatsapp') {
    let digits = null;
    if (/^(https?:)?\/\/|^(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|www\.whatsapp\.com)\//i.test(s)) {
      const u = safeUrl(s); if (!u || !c.hosts.test(u.hostname)) return null;
      if (/^chat\./i.test(u.hostname)) return null; // group invites are not a contact
      digits = (domainOf(u) === 'wa.me' ? u.pathname.slice(1) : u.searchParams.get('phone') || '').replace(/^\+/, '');
      if (!/^\d{8,15}$/.test(digits)) return null;
    } else { const n = normPhone(s); if (!n || !n.tel.startsWith('+')) return null; digits = n.tel.slice(1); }
    return { href: 'https://wa.me/' + digits, label: fmtIntl(digits) };
  }
  let h = null;
  if (/^(https?:)?\/\//i.test(s) || /^[a-z0-9.-]+\.(com|me|am|dog)\//i.test(s)) {
    const u = safeUrl(s); if (!u || !c.hosts.test(u.hostname)) return null;
    const segs = u.pathname.split('/').filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch { return x; } });
    if (kind === 'facebook') {
      if (segs[0] === 'profile.php') { const id = u.searchParams.get('id'); return /^\d{5,20}$/.test(id || '') ? { href: c.base + 'profile.php?id=' + id, label: 'Facebook' } : null; }
      if (/^(pages|pg|p|people)$/i.test(segs[0] || '')) { // /pages/<name>/<id>, /p/<name-id>
        const last = segs[segs.length - 1] || '', id = (last.match(/(\d{8,20})$/) || [])[1];
        const nm = segs.length > 2 ? segs[1] : last.replace(/-?\d{8,20}$/, '');
        return id ? { href: c.base + id, label: nm.replace(/-/g, ' ').slice(0, 40) || 'Facebook' } : null;
      }
    }
    h = segs[0] || null;
    if (h && /^(share|sharer|home\.php|login|groups|watch|reel|p|stories|explore|joinchat|s)$/i.test(h)) return null;
  } else h = s.replace(/^@/, '');
  if (!h) return null;
  if (!c.handle.test(h)) return null;
  return { href: c.base + encodeURIComponent(h) + (kind === 'instagram' ? '/' : ''), label: (kind === 'facebook' ? '' : '@') + h };
}

// All usable social links in display order. Also picks up a website that is really a social profile.
export function socials(tags = {}) {
  const out = [];
  const pick = (kind, keys) => { for (const k of keys) { const l = socialLink(kind, tags[k]); if (l) return out.push({ kind, ...l }); } };
  pick('whatsapp', ['contact:whatsapp', 'whatsapp', 'contact:WhatsApp']);
  pick('telegram', ['contact:telegram', 'telegram']);
  pick('facebook', ['contact:facebook', 'facebook']);
  pick('instagram', ['contact:instagram', 'instagram']);
  const w = website(tags, true);
  if (w) for (const kind of ['facebook', 'instagram', 'telegram']) if (SOC[kind].hosts.test(w.url.hostname) && !out.some(o => o.kind === kind)) { const l = socialLink(kind, w.url.href); if (l) out.push({ kind, ...l }); }
  return out;
}

// Website (website / contact:website / url) → { href, domain } or null. Social-profile URLs are not a "website".
export function website(tags = {}, raw = false) {
  for (const k of ['website', 'contact:website', 'url']) {
    const u = safeUrl(tags[k]); if (!u) continue;
    if (raw) return { url: u };
    if (Object.values(SOC).some(c => c.hosts.test(u.hostname))) continue;
    return { href: u.href, domain: domainOf(u) };
  }
  return null;
}
