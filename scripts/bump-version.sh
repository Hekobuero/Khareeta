#!/bin/sh
# Set VERSION in js/util.js and sw.js to the current Europe/Berlin time (YYYYMMDD-HHMM).
# Usage: scripts/bump-version.sh            -> uses the current Berlin time
#        scripts/bump-version.sh 20261102-0930  -> uses the given stamp
# No dependencies beyond POSIX sh, date (with tz data) and sed.
set -eu
cd "$(dirname "$0")/.."
V="${1:-$(TZ=Europe/Berlin date +%Y%m%d-%H%M)}"
case "$V" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]) ;;
  *) echo "invalid version '$V' (expected YYYYMMDD-HHMM)" >&2; exit 1 ;;
esac
for f in js/util.js sw.js; do
  grep -q "const VERSION = '[0-9-]*';" "$f" || { echo "VERSION line not found in $f" >&2; exit 1; }
  sed "s/const VERSION = '[0-9-]*';/const VERSION = '$V';/" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
# index.html: cache-busted i18n.js (import map + modulepreload) must carry the same VERSION
sed "s/js\/i18n\.js?v=[0-9-]*/js\/i18n.js?v=$V/g" index.html > index.html.tmp && mv index.html.tmp index.html
grep -H "const VERSION" js/util.js sw.js
grep -o "js/i18n.js?v=[0-9-]*" index.html
