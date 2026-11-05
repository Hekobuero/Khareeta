# Vendored libraries (unmodified, served locally – no CDN)
- `opening_hours.js` – opening_hours 3.15.0 (build/opening_hours.esm.mjs), https://github.com/opening-hours/opening_hours.js, **LGPL-3.0-only** (see opening_hours.LICENSE.txt; the GPL-3.0 text it references: https://www.gnu.org/licenses/gpl-3.0.txt). Only change: the `suncalc` import points to `./suncalc.js`. You may replace this file with any compatible version.
- `suncalc.js` – suncalc 2.1.1 (index.js), BSD-2-Clause (suncalc.LICENSE.txt).
Size: 1.18 MB raw / ~160 KB gzip. Loaded lazily via js/oh-lib.js only when the "Open now" filter is switched on or a place sheet has opening_hours our own parser (js/oh.js) cannot read.
