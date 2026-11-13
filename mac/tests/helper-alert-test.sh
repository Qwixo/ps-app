#!/bin/bash
# Offline test of the restart helper pop up's rules and words (Sources/HelperAlertCore.swift, V1.49). Asks macOS nothing.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/ps-helper-alert"; mkdir -p "$OUT"
cp "$HERE/tests/helper-alert-test.swift" "$OUT/main.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/RebootHelperCore.swift" "$HERE/Sources/HelperAlertCore.swift" "$HERE/Sources/HelperRepairCore.swift" "$OUT/main.swift" -o "$OUT/test"
"$OUT/test" "$HERE"
