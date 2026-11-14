#!/bin/bash
# Unit tests for the screen recorder's island side (Sources/ScreenRecIslandCore.swift, PS 1.60 pull request 12b). Pure values, fake
# capture, fake clocks, fake samplers: nothing records, no permission is asked, no window opens, no sound plays.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/screenrec-island-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/ScreenRecCore.swift" "$HERE/Sources/Protected.swift" "$HERE/Sources/ScreenRecIslandCore.swift" "$HERE/Sources/IslandQueueCore.swift" "$OUT/main.swift" -o "$OUT/screenrec-island-test"
"$OUT/screenrec-island-test"
rm -rf "$OUT"
