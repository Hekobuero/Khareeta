#!/bin/sh
# Renders tools/og/og-image.html into icons/og-image.png (1200×630) with headless Chrome/Chromium.
# Usage: sh tools/og/render.sh   (set CHROME=/path/to/chrome if it is not on PATH)
set -eu
cd "$(dirname "$0")/../.."
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}"
[ -n "$CHROME" ] || { echo "Chrome/Chromium not found (set CHROME=...)" >&2; exit 1; }
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --allow-file-access-from-files --virtual-time-budget=3000 --window-size=1200,630 \
  --screenshot="$PWD/icons/og-image.png" "file://$PWD/tools/og/og-image.html" 2>/dev/null
echo "wrote icons/og-image.png"
