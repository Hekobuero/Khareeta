#!/usr/bin/env bash
# VERSION check (CI and local).
#  1. VERSION in js/util.js and sw.js is identical and has the format YYYYMMDD-HHMM.
#  2. If the branch changes app files compared with the base, VERSION must be greater than on the base.
#     Changes only to docs (*.md), tests/, .github/, scripts/, tools/ or supabase SQL need no bump.
# Usage: scripts/ci/check-version.sh [BASE_REF]   (default: origin/main; BASE_REF may also be set via env)
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="${1:-${BASE_REF:-origin/main}}"
RE='^[0-9]{8}-[0-9]{4}$'
ver() { sed -n "s/.*const VERSION = '\([^']*\)';.*/\1/p" | head -n1; }

U=$(ver < js/util.js); S=$(ver < sw.js)
echo "js/util.js VERSION: ${U:-<missing>}"
echo "sw.js      VERSION: ${S:-<missing>}"
[ -n "$U" ] && [ -n "$S" ] || { echo "::error::VERSION line not found in js/util.js or sw.js"; exit 1; }
[ "$U" = "$S" ] || { echo "::error::VERSION differs: js/util.js=$U, sw.js=$S (run scripts/bump-version.sh)"; exit 1; }
[[ "$U" =~ $RE ]] || { echo "::error::VERSION '$U' is not in the format YYYYMMDD-HHMM"; exit 1; }

git rev-parse --verify -q "$BASE^{commit}" >/dev/null || { echo "::error::base ref '$BASE' not found (git fetch origin main?)"; exit 1; }
MB=$(git merge-base "$BASE" HEAD)
# files changed on this branch since it left the base (+ uncommitted changes when run locally)
CHANGED=$( { git diff --name-only "$MB" HEAD; git diff --name-only HEAD; } | sort -u)
APP=$(printf '%s\n' "$CHANGED" | grep -Ev '^$|\.md$|^tests/|^\.github/|^scripts/|^tools/|^supabase/|^supabase\.sql$|^LICENSE|^\.gitignore$' || true)
if [ -z "$APP" ]; then
  echo "OK: VERSION $U consistent; no app files changed vs $BASE → no bump required."
  exit 0
fi
echo "App files changed vs $BASE:"; printf '  %s\n' $APP
B=$(git show "$BASE:js/util.js" 2>/dev/null | ver || true)
echo "base VERSION ($BASE): ${B:-<none>}"
if [ -n "$B" ] && ! [[ "$U" > "$B" ]]; then
  echo "::error::VERSION $U is not greater than $B on $BASE although app files changed – run scripts/bump-version.sh before the last commit"
  exit 1
fi
echo "OK: VERSION $U consistent and greater than ${B:-<none>} on $BASE."
