#!/bin/bash
# Unit tests for the Mac part of the feature intros (Sources/IslandIntroCore.swift, PS 1.60). Pure values only, no window opens, no sound plays.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/island-intro-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/IslandQueueCore.swift" "$HERE/Sources/IslandMotionCore.swift" "$HERE/Sources/IslandIntroCore.swift" "$OUT/main.swift" -o "$OUT/island-intro-test"
"$OUT/island-intro-test"
rm -rf "$OUT"
