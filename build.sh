#!/usr/bin/env bash
# Збирає zip для завантаження в Chrome Web Store.
# Використання: ./build.sh
set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/xo-pulse-runner-${VERSION}.zip"

# Перевірки, які дешевше зробити тут, ніж отримати відмову на рев'ю
node --check src/content.js
node --check src/character.js
node --check src/popup.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"

for f in icons/icon16.png icons/icon48.png icons/icon128.png; do
  [ -f "$f" ] || { echo "немає $f"; exit 1; }
done

mkdir -p dist
rm -f "$OUT"

# У пакет іде тільки те, що потрібно розширенню: без test/, dist/ і службових
zip -r -q "$OUT" \
  manifest.json \
  src/content.js \
  src/character.js \
  src/popup.html \
  src/popup.js \
  icons/icon16.png \
  icons/icon48.png \
  icons/icon128.png

echo "зібрано: $OUT ($(du -h "$OUT" | cut -f1))"
echo "вміст:"
unzip -Z1 "$OUT" | sed 's/^/  /'
