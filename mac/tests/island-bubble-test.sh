#!/bin/bash
# Unit tests for V1.59's island bubble width and the first stand-up's question (Sources/IslandBubbleCore.swift).
# Pure numbers and NSFont measuring only: no window opens, no sound plays. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/island-bubble-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/IslandTimersCore.swift" "$HERE/Sources/IslandBubbleCore.swift" "$OUT/main.swift" -o "$OUT/island-bubble-test"
"$OUT/island-bubble-test"
rm -rf "$OUT"
