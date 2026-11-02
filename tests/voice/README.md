# Voice guidance tests

End-to-end checks for `js/voice.js` and the navigation prompts in `js/route.js`.
They use Playwright with Chromium, and `speechSynthesis` is mocked. The site itself has no build step, and this folder doesn't change that: it is not loaded by the app and is not in the service-worker precache.

```sh
cd tests/voice
npm ci                            # exact versions from package-lock.json
npx playwright install chromium   # once
npm test                          # ≈ 8 min, exit code 0 = all passed
```

- The script starts two small static servers itself, for the repo root (`/`) and a subpath (`/sub/khareeta/`). Their ports are `PORT` and `PORT+1`, with a default of 8765 and 8766. It stops both servers when it's done.
- Set `CHROME=/path/to/chrome` to use a different Chromium.
- Results go to `out/results.json` and screenshots to `out/shots/`. Both are git-ignored.

What the mock does: it provides voice lists for iOS, Windows/Edge and Android, plus profiles with no Arabic voice, online-only voices, an empty list, and no TTS at all. Speech takes about 70 ms per character and goes through a real engine queue. The mock logs every `cancel()` that cuts off a running prompt, every overlapping `speak()`, and every prompt that finishes.

What the tests cover:
- voice selection, notes and the test button;
- persistence, offline use and the subpath;
- simulated car and foot navigation in EN/DE/AR (MSA and Syrian): exactly one start prompt, distances, nothing cut off;
- combined close maneuvers (with or without a separate "now");
- empty voice list → 0 `speak()` calls;
- recalculation without repeated prompts;
- switching voice off in the settings or the HUD;
- language change, and a failing prompt in the queue;
- text rules (km agreement, no bracketed road numbers, Syrian texts).

CI: `.github/workflows/pr-checks.yml` runs this suite on every pull request to `main` (job `voice-tests`), together with `scripts/ci/check-version.sh` (`version`) and `scripts/ci/check-cname.sh` (`cname`). Both scripts also run locally, e.g. `scripts/ci/check-version.sh origin/main`.
