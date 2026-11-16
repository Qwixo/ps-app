#!/bin/bash
# Unit tests for the Settings assistant's rules (Sources/AssistCore.swift, AssistProvidersCore.swift, AssistIslandCore.swift).
# Fake providers and canned model output only: no real model, no API, no Keychain, no program, no window, no sound.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/assist-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/AssistCore.swift" "$HERE/Sources/AssistProvidersCore.swift" "$HERE/Sources/AssistIslandCore.swift" "$OUT/main.swift" -o "$OUT/assist-test"
"$OUT/assist-test"
