#!/usr/bin/env bash
# CNAME check (CI and local): CNAME exists, is not empty and is identical to the base branch.
# Usage: scripts/ci/check-cname.sh [BASE_REF]   (default: origin/main; BASE_REF may also be set via env)
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="${1:-${BASE_REF:-origin/main}}"
[ -f CNAME ] || { echo "::error::CNAME is missing (custom domain would be lost)"; exit 1; }
C=$(tr -d '[:space:]' < CNAME)
[ -n "$C" ] || { echo "::error::CNAME is empty"; exit 1; }
git rev-parse --verify -q "$BASE^{commit}" >/dev/null || { echo "::error::base ref '$BASE' not found (git fetch origin main?)"; exit 1; }
B=$(git show "$BASE:CNAME" 2>/dev/null) || { echo "::error::no CNAME on $BASE to compare with"; exit 1; }
if [ "$(cat CNAME)" != "$B" ]; then
  echo "::error::CNAME differs from $BASE: '$(cat CNAME)' vs '$B'"; exit 1
fi
echo "OK: CNAME = $C (unchanged vs $BASE)"
