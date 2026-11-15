#!/bin/bash
# Unit tests for PS 1.61's Dock icon refresh after an update (Sources/DockIconCore.swift). Pure rules: nothing is run,
# the Dock is never touched. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/dock-icon-test.swift" "$OUT/main.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/DockIconCore.swift" "$OUT/main.swift" -o "$OUT/dock-icon-test"
"$OUT/dock-icon-test" "$HERE"
rm -rf "$OUT"
