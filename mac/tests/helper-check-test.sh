#!/bin/bash
# Offline test of the fresh restart helper check before Sentry mode engages (Sources/HelperCheckCore.swift, V1.54), plus
# the wiring in AutoReboot.swift, main.swift and SleepSentry.swift read from the sources. Asks macOS nothing, opens no
# window, so it is safe while someone is using the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/ps-helper-check"; mkdir -p "$OUT"
cp "$HERE/tests/helper-check-test.swift" "$OUT/main.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/HelperCheckCore.swift" "$OUT/main.swift" -o "$OUT/test"
PS_MAC_DIR="$HERE" "$OUT/test"
