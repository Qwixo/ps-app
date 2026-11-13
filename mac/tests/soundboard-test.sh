#!/bin/bash
# Unit tests for the Soundboard's pure rules on a Mac (Sources/SoundboardMath.swift, V1.47): kinds, ids, names, name
# clashes, the index merge, the safe move plan, byte ranges, and the next due time of a timed play across days and
# daylight saving. No window, no sound, nothing read or written: safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/soundboard-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/SoundboardMath.swift" "$OUT/main.swift" -o "$OUT/soundboard-test"
"$OUT/soundboard-test"
rm -rf "$OUT"
