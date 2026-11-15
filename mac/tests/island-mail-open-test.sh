#!/bin/bash
# Unit tests for PS 1.61's island counts that open the email panel (Sources/IslandMailOpen.swift). No window, no network.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/island-mail-open-test.swift" "$OUT/main.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/IslandMailOpen.swift" "$OUT/main.swift" -o "$OUT/island-mail-open-test"
"$OUT/island-mail-open-test" "$HERE/Sources/Island.swift"
rm -rf "$OUT"
