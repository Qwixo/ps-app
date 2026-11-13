#!/bin/bash
# Builds PSTranslate (tools/translate/PSTranslate.cpp), the offline translator helper, to the path given.
# The libraries come from build-deps.sh (built once into a cache). The model is NOT part of the app:
# PS downloads it once into Application Support (Sources/Translate.swift).
#   bash tools/translate/build-helper.sh <out path>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?usage: build-helper.sh <out path>}"
# cmake and ninja: from PATH, or the pip copies in PS_TRANSLATE_TOOLS (a venv bin folder).
[ -n "${PS_TRANSLATE_TOOLS:-}" ] && export PATH="$PS_TRANSLATE_TOOLS:$PATH"
P="$(bash "$HERE/build-deps.sh" | tail -1)"
[ -f "$P/.done" ] || { echo "build-helper: the libraries did not build"; exit 1; }
rm -f "$OUT"
clang++ -std=c++17 -O2 -arch arm64 -mmacosx-version-min=13.0 -I"$P/include" "$HERE/PSTranslate.cpp" \
  "$P/lib/libctranslate2.a" "$P/lib/libsentencepiece.a" "$P"/lib/extra/*.a \
  -framework Accelerate -Wl,-dead_strip -w -o "$OUT" 2>&1 | grep -v "ignoring duplicate libraries" || true
[ -x "$OUT" ] || { echo "build-helper: no binary"; exit 1; }
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
