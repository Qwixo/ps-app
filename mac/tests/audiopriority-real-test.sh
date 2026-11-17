#!/bin/bash
# Audio priority on THIS Mac's real devices (Sources/AudioPriority.swift CoreAudioAP).
# Part 1 only reads: lists every real speaker and microphone, the two defaults, and checks the ids are usable.
# Part 2 (skipped with AP_READ_ONLY=1): sets the default output to another connected device and back, then checks the
# output AND the alerts output are exactly what they were. Skipped when there is only one usable output, or while an
# app is using the microphone (a call). Never touches the microphone, AirPlay devices or a phone.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/audiopriority-real-test.swift" "$OUT/main.swift"
swiftc -Onone -g -target arm64-apple-macos13 "$HERE/Sources/AudioPriorityCore.swift" "$HERE/Sources/AudioPriority.swift" "$HERE/Sources/Headphones.swift" \
  "$HERE/tests/audiopriority-stubs.swift" "$OUT/main.swift" -o "$OUT/audiopriority-real-test"
"$OUT/audiopriority-real-test"
