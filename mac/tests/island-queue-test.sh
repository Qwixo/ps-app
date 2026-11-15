#!/bin/bash
# Unit tests for the shared island card queue and the island moment timings (Sources/IslandQueueCore.swift,
# IslandMotionCore.swift, PS 1.60). Pure values only, no window opens, no sound plays. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/island-queue-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/IslandQueueCore.swift" "$HERE/Sources/IslandMotionCore.swift" "$OUT/main.swift" -o "$OUT/island-queue-test"
"$OUT/island-queue-test"
rm -rf "$OUT"
