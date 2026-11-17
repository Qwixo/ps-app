#!/bin/bash
# Unit tests for voice capture's rules (Sources/VoiceCaptureCore.swift): permissions, when it may listen, the level meter, the
# session (stop, the limit, 1Password or Signal coming to the front) and the split asked of the model.
# A fake recogniser, a fake clock and a fake model only: no microphone, no speech framework, no window, no sound.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/voice-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/VoiceCaptureCore.swift" "$HERE/Sources/AssistCore.swift" "$OUT/main.swift" -o "$OUT/voice-test"
"$OUT/voice-test"
