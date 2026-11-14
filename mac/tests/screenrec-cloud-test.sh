#!/bin/bash
# Unit tests for the screen recorder's cloud and library side (Sources/ScreenRecCloudCore.swift and ScreenRecCloudProviders.swift, PS 1.60
# pull request 12c). Fake files in a temp folder and a fake cloud server in memory: nothing records, nothing reaches a real cloud, no Keychain.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/screenrec-cloud-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/ScreenRecCore.swift" "$HERE/Sources/ScreenRecIslandCore.swift" "$HERE/Sources/IslandQueueCore.swift" "$HERE/Sources/ScreenRecCloudCore.swift" "$HERE/Sources/ScreenRecCloudProviders.swift" "$OUT/main.swift" -o "$OUT/screenrec-cloud-test"
"$OUT/screenrec-cloud-test"
rm -rf "$OUT"
