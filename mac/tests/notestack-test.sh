#!/bin/bash
# Unit tests for stacked notifications (Sources/NoteStackCore.swift, PS 1.65), then the page's own model (notestack-test.mjs).
# Pure values only, no window opens, no sound plays. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/notestack-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/NoteStackCore.swift" "$OUT/main.swift" -o "$OUT/notestack-test"
"$OUT/notestack-test"
rm -rf "$OUT"
node "$HERE/tests/notestack-test.mjs" | tail -3
