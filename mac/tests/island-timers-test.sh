#!/bin/bash
# Unit tests for the island's timers (Sources/IslandTimersCore.swift, V1.58): Pomodoro breaks, Stand-up reminders and the
# next meeting bubble. Pure numbers only, no window opens, no sound plays. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/island-timers-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/IslandTimersCore.swift" "$OUT/main.swift" -o "$OUT/island-timers-test"
"$OUT/island-timers-test"
rm -rf "$OUT"
