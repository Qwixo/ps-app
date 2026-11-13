#!/bin/bash
# Unit tests for SafePeek's rules (Sources/SafePeekCore.swift) and the per account rules (Sources/BuildRules.swift,
# V1.58): Tab over 1Password and Signal for everyone except the developer, never for the developer, and the island the same way.
# No window opens, no hotkey is registered, no key is sent. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/safepeek-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/SafePeekCore.swift" "$HERE/Sources/BuildRules.swift" "$OUT/main.swift" -o "$OUT/safepeek-test"
cd "$HERE" && "$OUT/safepeek-test"
rm -rf "$OUT"
