#!/bin/bash
# Unit tests for Audio priority (Sources/AudioPriorityCore.swift, AudioPriority.swift) on a FAKE Mac. No real output or
# microphone is read or changed: Protected, Features and psLog are small stand ins (tests/audiopriority-stubs.swift).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/audiopriority-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -g -target arm64-apple-macos13 "$HERE/Sources/AudioPriorityCore.swift" "$HERE/Sources/AudioPriority.swift" "$HERE/Sources/Headphones.swift" \
  "$HERE/tests/audiopriority-stubs.swift" "$OUT/main.swift" -o "$OUT/audiopriority-test"
"$OUT/audiopriority-test"
