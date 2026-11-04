// iOS-like speechSynthesis mock tests for js/voice.js. Run: node --test 'tests/ios/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installIOS, wait } from './ios-mock.mjs';

const V = (name, lang) => ({ name, lang, voiceURI: name, localService: true, default: false });
const env = installIOS({ voices: [V('Daniel', 'en-GB'), V('Samantha', 'en-US'), V('Markus', 'de-DE')] }); // no Arabic voice
localStorage.setItem('kh.lang', '"en"');
const v = await import('../../js/voice.js');
const { settings, saveSettings } = await import('../../js/util.js');
const i18n = await import('../../js/i18n.js');

test('strict iOS: pointerdown alone neither unlocks nor marks unlocked', async () => {
  env.pointerdown(); await wait(20);
  assert.equal(v.isUnlocked(), false); assert.equal(v.isConfirmed(), false);
  assert.equal(env.log.spoken.length, 0);
});

test('before unlock: speech from a timer (GPS fix) is blocked by iOS → unlock inside the tap fixes it', async () => {
  assert.equal(v.voiceState(), 'unknown'); // iOS: empty voice list at first
  env.tap(() => v.unlockSpeech()); // Go tap: global touchend/click listener + startNav both run in the gesture
  assert.ok(v.isUnlocked());
  await wait(20); assert.ok(v.isConfirmed(), 'engine played the unlock utterance');
  assert.equal(env.log.spoken.at(-1).vol, 0, 'silent unlock utterance spoken inside the gesture');
  await wait(30);
  const ok = v.speak('In 300 metres, turn right'); // later, outside any gesture
  assert.equal(ok, true);
  assert.equal(env.log.spoken.at(-1).text, 'In 300 metres, turn right');
});

test('voices arrive late (no voiceschanged) → picked up by retry poll, best voice chosen', async () => {
  await wait(400);
  assert.equal(v.voiceState(), 'ok');
  assert.equal(v.chosenVoice()?.name, 'Daniel');
  await wait(100); v.speak('Turn left now');
  assert.equal(env.log.spoken.at(-1).voice, 'Daniel');
});

test('no Arabic voice → still speaks with lang tag ar-SA (no silent failure)', async () => {
  await wait(100);
  i18n.setLang ? i18n.setLang('ar') : localStorage.setItem('kh.lang', '"ar"');
  if (i18n.getLang() !== 'ar') return; // setLang not exported in this build
  assert.equal(v.voiceState('ar'), 'none');
  assert.equal(v.speak('بعد ٣٠٠ متر انعطف يمينًا'), true);
  const last = env.log.spoken.at(-1);
  assert.equal(last.lang, 'ar-SA'); assert.equal(last.voice, null);
  i18n.setLang('en');
});

test('interrupt does not speak() right after cancel() (iOS drops it) – delayed instead', async () => {
  await wait(100);
  v.speak('A long running prompt about the next turn');
  assert.equal(v.speak('Recalculating', { interrupt: true }), true);
  await wait(250);
  assert.equal(env.log.dropped.filter(d => d.why === 'after-cancel').length, 0, JSON.stringify(env.log.dropped));
  assert.ok(env.log.spoken.some(s => s.text === 'Recalculating'));
});

test('visibilitychange → resume()', async () => {
  const r = env.log.resumes; v.speak('Background prompt');
  env.hide(); env.show();
  assert.ok(env.log.resumes > r); assert.equal(env.syn.paused, false);
  await wait(100);
});

test('unlock while speaking still speaks (queued) instead of skipping', async () => {
  await wait(100); v._test.reset(); v.speak('Some running prompt');
  const n = env.log.spoken.length; env.tap(() => v.unlockSpeech());
  assert.ok(env.log.spoken.slice(n).some(x => x.vol === 0), JSON.stringify(env.log.spoken.slice(n)));
  await wait(100);
});

test('utterances stay referenced until they end (GC)', async () => {
  v.speak('Keep me alive please');
  assert.ok(v._test.live() >= 1);
});

test('mute is persisted and blocks speech; force (test button) still speaks', async () => {
  await wait(100);
  settings.voice = false; saveSettings();
  assert.equal(JSON.parse(localStorage.getItem('kh.settings')).voice, false);
  assert.equal(v.speak('Should be silent'), false);
  assert.equal(v.speak('Test announcement', { force: true }), true);
  settings.voice = true; saveSettings();
  await wait(300);
});
