#!/bin/bash
# Unit test for the macOS version line (Sources/MacOSWatchCore.swift, V1.47). No window, nothing read or written:
# safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/macos-watch-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/MacOSWatchCore.swift" "$OUT/main.swift" -o "$OUT/macos-watch-test"
"$OUT/macos-watch-test"
rm -rf "$OUT"
