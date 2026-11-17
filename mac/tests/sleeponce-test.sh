#!/bin/bash
# Unit tests for the "Just tomorrow" rules on the Sleep screen (Sources/SleepOnceCore.swift, PS 1.65): reading the
# plan's `once`, the JSON of every choice, the pick start across midnight, the Touch ID gate and the page's auth id.
# No window opens, nothing is asked, so it is safe while someone is using the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/sleeponce-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/SleepOnceCore.swift" "$OUT/main.swift" -o "$OUT/sleeponce-test"
"$OUT/sleeponce-test"
rm -rf "$OUT"
