// Unit tests for the place-detail helpers (no dependencies): node --test tests/placeinfo/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOH, ohState, ohWeek, weekOrder, damascusNow, hhmm } from '../../js/oh.js';
import { normPhone, phones, safeUrl, website, socialLink, socials } from '../../js/links.js';

// Damascus = UTC+3. 2026-11-03 is a Tuesday.
const at = (iso) => new Date(iso + '+03:00');
const week = s => parseOH(s).week;

test('parseOH: common rules', () => {
  assert.ok(parseOH('24/7').always);
  assert.deepEqual(week('Mo-Fr 08:00-17:00; Sa,Su off')[1], [[480, 1020]]);
  assert.deepEqual(week('Mo-Fr 08:00-17:00; Sa,Su off')[6], []);
  assert.deepEqual(week('Mo-Fr 08:00-17:00, Sa 09:00-12:00')[6], [[540, 720]]);
  assert.deepEqual(week('Sa-Th 08:00-22:00; Fr off')[5], []);
  assert.deepEqual(week('Sa-Th 08:00-22:00; Fr off')[4], [[480, 1320]]);
  assert.deepEqual(week('Mo-Sa 09:00-13:00,16:00-21:00')[2], [[540, 780], [960, 1260]]);
  assert.deepEqual(week('Fr-Mo 10:00-12:00')[0], [[600, 720]]); // wrapping day range
  assert.deepEqual(week('Fr-Mo 10:00-12:00')[3], []);
  assert.deepEqual(week('18:00-02:00')[3], [[1080, 1560]]); // past midnight
  assert.deepEqual(week('Sa-Th 10:00-25:00; Fr 11:00-25:00')[5], [[660, 1500]]);
  assert.deepEqual(week('Mo-Su 10:00+')[1], [[600, 1440]]);
});
test('parseOH: tolerant forms', () => {
  assert.deepEqual(week('Sat-Thu 09:00-21:00')[6], [[540, 1260]]);
  assert.ok(parseOH('24/24').always);
  assert.deepEqual(week('PH,Mo-Su 08:00-23:00')[0], [[480, 1380]]);
  assert.deepEqual(week('Mo-Fr ٠٨:٠٠-١٧:٠٠')[1], [[480, 1020]]); // Arabic-Indic digits
  assert.deepEqual(week('Sa-Th 10:00-17:00 open "للنساء فقط", Sa-Fr 17:00-24:00 open "للرجال فقط"')[6], [[600, 1020], [1020, 1440]]);
});
test('parseOH: unsupported → null, never throws', () => {
  for (const s of ['sunrise-sunset', 'Jan-Mar Mo 10:00-12:00', 'Morning-1AM', '', null, undefined, 42, '<img src=x onerror=alert(1)>', 'Mo 25:99-26:00x'])
    assert.equal(parseOH(s), null, String(s));
});
test('Damascus time is independent of the device time zone', () => {
  assert.deepEqual(damascusNow(new Date('2026-11-03T08:30:00Z')), { dow: 2, min: 690 }); // 11:30 Tue
  assert.deepEqual(damascusNow(new Date('2026-11-03T22:30:00Z')), { dow: 3, min: 90 }); // already Wed 01:30 in Damascus
});
test('ohState: open / closing soon / closed / opens later', () => {
  const oh = 'Mo-Fr 08:00-17:00; Sa,Su off';
  let s = ohState(oh, at('2026-11-03T11:30:00'));
  assert.equal(s.open, true); assert.equal(s.soon, false); assert.equal(hhmm(s.closes.min), '17:00');
  s = ohState(oh, at('2026-11-03T16:15:00')); assert.equal(s.soon, true);
  s = ohState(oh, at('2026-11-03T07:00:00')); assert.equal(s.open, false); assert.equal(s.opens.inDays, 0); assert.equal(hhmm(s.opens.min), '08:00');
  s = ohState(oh, at('2026-11-03T18:00:00')); assert.equal(s.opens.inDays, 1);
  s = ohState(oh, at('2026-11-06T18:00:00')); assert.equal(s.opens.inDays, 3); assert.equal(s.opens.dow, 1); // Fri evening → Monday
  s = ohState('18:00-02:00', at('2026-11-04T01:00:00')); assert.equal(s.open, true); assert.equal(hhmm(s.closes.min), '02:00');
  assert.equal(ohState('closed', at('2026-11-03T12:00:00')).open, false);
  assert.ok(ohState('Mo-Su 00:00-24:00', at('2026-11-03T12:00:00')).always);
  assert.equal(ohState('garbage', new Date()), null);
});
test('week view: locale order + today', () => {
  assert.deepEqual(weekOrder('ar'), [6, 0, 1, 2, 3, 4, 5]);
  assert.deepEqual(weekOrder('de'), [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(weekOrder('en'), [1, 2, 3, 4, 5, 6, 0]);
  const w = ohWeek('Sa-Th 09:00-18:00', 'ar', at('2026-11-03T12:00:00'));
  assert.equal(w[0].dow, 6); assert.equal(w.find(r => r.today).dow, 2); assert.equal(w.find(r => r.dow === 5).closed, true);
  assert.equal(ohWeek('nope', 'en'), null);
});

test('phone normalisation to +963', () => {
  assert.deepEqual(normPhone('0944 123 456'), { tel: '+963944123456', display: '+963 944 123 456' });
  assert.deepEqual(normPhone('944123456'), { tel: '+963944123456', display: '+963 944 123 456' });
  assert.deepEqual(normPhone('011 2345678'), { tel: '+963112345678', display: '+963 11 234 5678' });
  assert.deepEqual(normPhone('00963 11 2345678'), { tel: '+963112345678', display: '+963 11 234 5678' });
  assert.deepEqual(normPhone('+963 (0)11 2345678'), { tel: '+963112345678', display: '+963 11 234 5678' });
  assert.deepEqual(normPhone('٠٩٤٤١٢٣٤٥٦'), { tel: '+963944123456', display: '+963 944 123 456' });
  assert.equal(normPhone('+49 30 1234567').tel, '+49301234567');
  assert.equal(normPhone('javascript:alert(1)'), null);
  assert.equal(normPhone('"><script>'), null);
  assert.equal(normPhone('12'), null);
});
test('phones(): phone + contact:phone, ";" separated, de-duplicated', () => {
  const p = phones({ phone: '+963 11 5414042;+963 933999561', 'contact:phone': '0933 999 561' });
  assert.deepEqual(p.map(x => x.tel), ['+963115414042', '+963933999561']);
  assert.deepEqual(phones({}), []);
});
test('website: http(s) only, domain shown, social URLs are not a website', () => {
  assert.deepEqual(website({ website: 'https://www.katgates.com' }), { href: 'https://www.katgates.com/', domain: 'katgates.com' });
  assert.equal(website({ 'contact:website': 'example.org/ar' }).href, 'https://example.org/ar');
  assert.equal(website({ website: 'javascript:alert(1)' }), null);
  assert.equal(website({ website: 'data:text/html,<script>alert(1)</script>' }), null);
  assert.equal(website({ website: 'https://user:pw@evil.com' }), null);
  assert.equal(website({ website: 'https://www.facebook.com/WinnereCafeOfficial/' }), null);
  assert.equal(safeUrl('ftp://x.com'), null);
});
test('social links from handle or URL', () => {
  const L = (k, v) => socialLink(k, v)?.href ?? null;
  assert.equal(L('facebook', 'Alkatranji'), 'https://www.facebook.com/Alkatranji');
  assert.equal(L('facebook', 'https://m.facebook.com/HamamAlBakri/'), 'https://www.facebook.com/HamamAlBakri');
  assert.equal(L('facebook', 'https://www.facebook.com/profile.php?id=100057401591546'), 'https://www.facebook.com/profile.php?id=100057401591546');
  assert.equal(L('facebook', 'https://www.facebook.com/pages/Name/219307224769336?ref=hl'), 'https://www.facebook.com/219307224769336');
  assert.equal(L('facebook', 'https://evil.com/facebook.com'), null);
  assert.equal(L('facebook', 'https://facebook.com.evil.com/x'), null);
  assert.equal(L('instagram', '@katranji_electronic'), 'https://www.instagram.com/katranji_electronic/');
  assert.equal(L('instagram', 'https://www.instagram.com/alsultanelectricalsas/'), 'https://www.instagram.com/alsultanelectricalsas/');
  assert.equal(L('instagram', "uaeembassydamascus's profile picture uaeembassydamascus"), null);
  assert.equal(L('instagram', '"><img src=x onerror=alert(1)>'), null);
  assert.equal(L('whatsapp', '0944 123 456'), 'https://wa.me/963944123456');
  assert.equal(L('whatsapp', '+963 944-123-456'), 'https://wa.me/963944123456');
  assert.equal(L('whatsapp', 'https://wa.me/963944123456'), 'https://wa.me/963944123456');
  assert.equal(L('whatsapp', 'https://api.whatsapp.com/send?phone=963944123456'), 'https://wa.me/963944123456');
  assert.equal(L('whatsapp', 'https://chat.whatsapp.com/AbCdEf'), null);
  assert.equal(L('telegram', '@damascus_cafe'), 'https://t.me/damascus_cafe');
  assert.equal(L('telegram', 'https://t.me/somechannel'), 'https://t.me/somechannel');
  assert.equal(L('telegram', 'javascript:alert(1)'), null);
});
test('socials(): contact:* and short keys, only valid ones, website that is a profile', () => {
  const s = socials({ 'contact:facebook': 'Alkatranji', instagram: 'katranji_electronic', 'contact:whatsapp': '0944123456', 'contact:telegram': 'x' });
  assert.deepEqual(s.map(x => x.kind), ['whatsapp', 'facebook', 'instagram']);
  assert.deepEqual(socials({ website: 'https://www.facebook.com/WinnereCafeOfficial/' }).map(x => x.href), ['https://www.facebook.com/WinnereCafeOfficial']);
  assert.deepEqual(socials({ name: 'x' }), []);
  for (const x of s) assert.match(x.href, /^https:\/\/(www\.facebook\.com|www\.instagram\.com|wa\.me|t\.me)\/[A-Za-z0-9._\-\/?=%]+$/);
});
