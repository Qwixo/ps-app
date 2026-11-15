#!/bin/bash
# Unit tests for PS 1.60's workout-summary rules (Sources/WorkoutSummaryCore.swift, IslandMotionCore.swift).
# Pure values only, no window opens, no sound plays. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/workout-summary-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/WelcomeBackCore.swift" "$HERE/Sources/WorkoutSummaryCore.swift" "$HERE/Sources/IslandMotionCore.swift" "$OUT/main.swift" -o "$OUT/workout-summary-test"
"$OUT/workout-summary-test"
rm -rf "$OUT"
