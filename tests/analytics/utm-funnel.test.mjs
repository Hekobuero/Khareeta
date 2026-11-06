// UTM / channel_language / first-touch / appinstalled / funnel flags.
// fetch is ALWAYS mocked – nothing reaches the production Supabase project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mem = () => {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  };
};

globalThis.fetch = () => { throw new Error('network access in tests is forbidden'); };
Object.assign(globalThis, {
  localStorage: mem(),
  sessionStorage: mem(),
  location: { protocol: 'https:', hostname: 'khareeta.app', search: '', href: 'https://khareeta.app/', pathname: '/' },
  screen: { width: 390, height: 844 },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  document: { referrer: '', visibilityState: 'visible', addEventListener() {}, documentElement: {} },
});
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'iPhone', language: 'en', languages: ['en'], maxTouchPoints: 5, onLine: true, standalone: false },
  configurable: true,
});

const A = await import('../../js/analytics.js');

function seedAtt(a) {
  sessionStorage.setItem('kh.att', JSON.stringify(a));
}

function clearFunnel() {
  sessionStorage.removeItem('kh.fun');
  sessionStorage.removeItem('kh.visit');
  sessionStorage.removeItem('kh.visitH');
  sessionStorage.removeItem('kh.bip');
  sessionStorage.removeItem('kh.inst');
  localStorage.removeItem('kh.inst');
  A._resetPrivacy(); // also clears in-memory queue + kh.aq
}

/** Enable mock timers FIRST, then run body so hold() timeouts are mocked. */
function withTimers(t, start, body) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: start });
  clearFunnel();
  try { return body({ go: ms => t.mock.timers.tick(ms), now: () => Date.now() }); }
  finally { t.mock.timers.reset(); A._resetPrivacy(); }
}

test('buildAttribution: full UTM → channel_language facebook_ar / instagram_de / direct_en', () => {
  const fb = A.buildAttribution({
    search: '?utm_source=facebook&utm_medium=social&utm_campaign=launch&utm_content=post1_ar&utm_term=maps',
    lang: 'en',
  });
  assert.equal(fb.utm_source, 'facebook');
  assert.equal(fb.utm_medium, 'social');
  assert.equal(fb.utm_campaign, 'launch');
  assert.equal(fb.utm_content, 'post1_ar');
  assert.equal(fb.utm_term, 'maps');
  assert.equal(fb.ch, 'facebook');
  assert.equal(fb.chl, 'facebook_ar');

  const ig = A.buildAttribution({
    search: '?utm_source=instagram&utm_medium=story&utm_content=story_de',
    lang: 'en',
  });
  assert.equal(ig.chl, 'instagram_de');

  const direct = A.buildAttribution({ search: '', lang: 'en' });
  assert.equal(direct.chl, 'direct_en');
  assert.equal(direct.utm_source, null);

  const ch = A.buildAttribution({ search: '?ch=whatsapp_en', lang: 'ar' });
  assert.equal(ch.chl, 'whatsapp_en');
  assert.equal(ch.utm_source, 'whatsapp');

  const badCh = A.buildAttribution({ search: '?ch=myblog_ar', lang: 'de' });
  assert.equal(badCh.chl, 'direct_de'); // unknown channel ignored

  const ref = A.buildAttribution({ search: '', referrer: 'https://t.me/somechannel', lang: 'ar' });
  assert.equal(ref.chl, 'telegram_ar');

  const organic = A.buildAttribution({ search: '', referrer: 'https://www.google.com/search?q=khareeta', lang: 'de' });
  assert.equal(organic.chl, 'organic_de');

  const slug = A.buildAttribution({ search: '?utm_source=Syria Forum&lang=ar', lang: 'en' });
  assert.equal(slug.chl, 'syriaforum_ar');
});

test('normChannel / deriveChannel / parseCh / langHint helpers', () => {
  assert.equal(A.normChannel('fb_ads'), 'facebook');
  assert.equal(A.normChannel('l.instagram.com'), 'instagram');
  assert.equal(A.deriveChannel(null, null), 'direct');
  assert.equal(A.deriveChannel(null, 'news.example.com'), 'referral');
  assert.deepEqual(A.parseCh('facebook_ar'), { ch: 'facebook', l: 'ar' });
  assert.equal(A.parseCh('myblog_ar'), null);
  assert.equal(A.langHint('post3_ar', 'launch'), 'ar');
  assert.equal(A.langHint('de-story'), 'de');
});

test('first-touch: attribution() keeps the first landing across a later URL change', () => {
  sessionStorage.clear();
  location.search = '?utm_source=facebook&utm_content=post_ar&utm_medium=social&utm_campaign=launch';
  document.referrer = '';
  const first = A.attribution();
  assert.equal(first.chl, 'facebook_ar');
  assert.equal(JSON.parse(sessionStorage.getItem('kh.att')).chl, 'facebook_ar');

  // later deep link / reload without campaign params must not overwrite first touch
  location.search = '?q=Aleppo';
  const again = A.attribution();
  assert.equal(again.chl, 'facebook_ar');
  assert.equal(again.utm_campaign, 'launch');
  assert.equal(again.utm_medium, 'social');
});

test('funnel: visit / search / place_view / route / nav_start / install get props.f once; channel_language + UTM on funnel steps', (t) => {
  const start = Date.parse('2026-11-06T06:00:00Z');
  withTimers(t, start, ({ go }) => {
    seedAtt({
      utm_source: 'facebook', utm_medium: 'social', utm_campaign: 'launch',
      utm_content: 'post1_ar', utm_term: 'maps', referrer: null, ch: 'facebook', chl: 'facebook_ar',
    });
    A.track('visit', {});
    A.track('search', { kind: 'full', n: 3 });
    A.track('place_view', { cat: 'cafe' });
    A.track('place_view', { cat: 'cafe' }); // second place: no second f
    A.track('route', { mode: 'car' });
    A.track('nav_start', { mode: 'car' });
    A.onAppInstalled();
    go(61_000); // past HOLD_MS → hold timeouts enqueue
    A._onHide(Date.now()); // no-op if already drained by timeouts
    const q = A._queue();
    const first = type => q.find(e => e.type === type);
    for (const step of ['visit', 'search', 'place_view', 'route', 'nav_start', 'install']) {
      assert.ok(first(step), `missing ${step} in ${q.map(e => e.type)}`);
      assert.equal(first(step).props.ch, 'facebook_ar', step);
      assert.equal(first(step).utm_source, 'facebook', step);
      assert.equal(first(step).props.f, 1, step + ' funnel flag');
    }
    assert.equal(first('install').props.stage, 'installed');
    assert.equal(first('visit').props.utm_medium, 'social');
    assert.equal(first('visit').props.utm_campaign, 'launch');
    assert.equal(first('visit').props.utm_content, 'post1_ar');
    assert.equal(first('visit').props.utm_term, 'maps');
    const places = q.filter(e => e.type === 'place_view');
    assert.equal(places.length, 2);
    assert.equal(places.filter(e => e.props.f === 1).length, 1);
  });
});

test('appinstalled: once per session and once per device; available stage never gets f', (t) => {
  const start = Date.parse('2026-11-06T07:00:00Z');
  withTimers(t, start, ({ go }) => {
    seedAtt({ utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, referrer: null, ch: 'direct', chl: 'direct_en' });
    A.onBeforeInstallPrompt();
    A.onBeforeInstallPrompt(); // deduped
    A.onAppInstalled();
    A.onAppInstalled(); // deduped (session + device)
    go(61_000);
    A._onHide(Date.now());
    const installs = A._queue().filter(e => e.type === 'install');
    assert.equal(installs.length, 2, JSON.stringify(installs.map(e => e.props)));
    const stages = installs.map(e => e.props.stage).sort();
    assert.deepEqual(stages, ['available', 'installed']);
    const installed = installs.find(e => e.props.stage === 'installed');
    const available = installs.find(e => e.props.stage === 'available');
    assert.equal(installed.props.f, 1);
    assert.equal(available.props.f, undefined);
    assert.equal(installed.props.ch, 'direct_en');
  });
});

test('no new map_ready event type (would 400-drop batches until kh_type_ok is migrated)', () => {
  assert.equal(A.track('map_ready', {}), false);
});

test('optional migration file documents place_view funnel step and is not applied by the app', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261108_funnel_place_view.sql', import.meta.url), 'utf8');
  assert.match(sql, /DO NOT run automatically/);
  assert.match(sql, /place_view/);
  assert.match(sql, /kh_tracking/);
  assert.doesNotMatch(sql, /map_ready/); // deliberately not introducing a new type
});
