#!/bin/bash
# Unit tests for the screen recorder rules (Sources/ScreenRecCore.swift, PS 1.60 pull request 12a). Pure values, fake capture,
# fake permissions and fake folders: nothing records, no permission is asked, no window opens. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/screenrec-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/ScreenRecCore.swift" "$OUT/main.swift" -o "$OUT/screenrec-test"
"$OUT/screenrec-test"
rm -rf "$OUT"
