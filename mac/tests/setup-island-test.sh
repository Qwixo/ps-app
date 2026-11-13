#!/bin/bash
# Unit tests for the setup island's rules (Sources/SetupIslandCore.swift). Nothing on screen, no sound, no network.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/setup-island-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/SetupIslandCore.swift" "$OUT/main.swift" -o "$OUT/setup-island-test"
"$OUT/setup-island-test"
