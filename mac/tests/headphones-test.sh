#!/bin/bash
# Unit tests for Headphones mode (Sources/Headphones.swift) on fake devices. No real output or microphone is
# read or changed: Toast, AutoRoute, Protected and psLog are small stand ins (tests/headphones-stubs.swift).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/headphones-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -g -target arm64-apple-macos13 "$HERE/Sources/Headphones.swift" "$HERE/tests/headphones-stubs.swift" "$OUT/main.swift" -o "$OUT/headphones-test"
"$OUT/headphones-test"
rm -rf "$OUT"
