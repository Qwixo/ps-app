#!/bin/bash
# Offline test of the restart helper state after an update (Sources/RebootHelperCore.swift, V1.45). Asks macOS nothing.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/ps-reboot-helper-state"; mkdir -p "$OUT"
cp "$HERE/tests/reboot-helper-state-test.swift" "$OUT/main.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/RebootHelperCore.swift" "$OUT/main.swift" -o "$OUT/test"
"$OUT/test"
