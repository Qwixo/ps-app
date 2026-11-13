#!/bin/bash
# Unit tests for private mode on the Mac (V1.57): the pure Swift part, then the card page's pill and the wiring
# (tests/privatepill-test.mjs). Temp folder only, no window, nothing on screen.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/private-test.swift" "$OUT/main.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/PrivateCore.swift" "$OUT/main.swift" -o "$OUT/private-test"
"$OUT/private-test"
rm -rf "$OUT"
node "$HERE/tests/privatepill-test.mjs" | tail -1
