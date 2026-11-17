#!/bin/bash
# Unit tests for Low power mode's Mac rules (Sources/LowPowerCore.swift, PS 1.65). No window, no timer, no network.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/lowpower-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/LowPowerCore.swift" "$OUT/main.swift" -o "$OUT/lowpower-test"
"$OUT/lowpower-test"
