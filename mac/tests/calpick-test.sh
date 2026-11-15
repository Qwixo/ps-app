#!/bin/bash
# Unit tests for the Mac side of "which calendars PS works with" (Sources/CalPickCore.swift). Temp folder only, no window, no EventKit.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/calpick-test.swift" "$OUT/main.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/CalPickCore.swift" "$OUT/main.swift" -o "$OUT/calpick-test"
"$OUT/calpick-test" | tail -3
rm -rf "$OUT"
