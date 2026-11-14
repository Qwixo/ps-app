#!/bin/bash
# Unit tests for PS 1.60's meeting blob and the taller stand-up island (Sources/IslandBlobCore.swift).
# Pure numbers and NSFont measuring only: no window opens, no sound plays. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/island-blob-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/IslandTimersCore.swift" "$HERE/Sources/IslandBubbleCore.swift" "$HERE/Sources/IslandBlobCore.swift" "$OUT/main.swift" -o "$OUT/island-blob-test"
"$OUT/island-blob-test"
rm -rf "$OUT"
