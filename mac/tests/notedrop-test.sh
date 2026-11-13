#!/bin/bash
# Unit tests for notifications out of the Dynamic Island (Sources/NoteDropCore.swift, V1.55): pure numbers only, no
# window opens, nothing on screen. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/notedrop-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/NoteDropCore.swift" "$OUT/main.swift" -o "$OUT/notedrop-test"
"$OUT/notedrop-test" "$HERE"
rm -rf "$OUT"
