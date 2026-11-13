#!/bin/bash
# Offline test of the restart helper's own repair (Sources/HelperRepairCore.swift, V1.51) and its pop up rules. Asks macOS nothing.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/ps-helper-repair"; mkdir -p "$OUT"
cp "$HERE/tests/helper-repair-test.swift" "$OUT/main.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/RebootHelperCore.swift" "$HERE/Sources/HelperAlertCore.swift" "$HERE/Sources/HelperRepairCore.swift" "$OUT/main.swift" -o "$OUT/test"
"$OUT/test" "$HERE"
