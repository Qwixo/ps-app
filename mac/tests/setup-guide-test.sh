#!/bin/bash
# Unit tests for the token guide's rules (Sources/SetupGuideCore.swift). Nothing on screen, no clipboard, no network.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/setup-guide-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/SetupGuideCore.swift" "$OUT/main.swift" -o "$OUT/setup-guide-test"
"$OUT/setup-guide-test"
