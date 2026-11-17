#!/bin/bash
# Unit tests for Sleep mode's screen rules (Sources/SleepScreen.swift): clock words and size, the stopwatch, the
# pointer, the look from the page, Wake up's answers. No window opens, nothing is asked or held (stubs in
# tests/sleepscreen-stubs.swift), so it is safe while someone is using the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/sleepscreen-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/SleepScreen.swift" "$HERE/Sources/SleepWake.swift" "$HERE/Sources/SleepSound.swift" "$HERE/Sources/AlarmList.swift" "$HERE/Sources/SleepOnceCore.swift" "$HERE/tests/sleepscreen-stubs.swift" "$OUT/main.swift" -o "$OUT/sleepscreen-test"
"$OUT/sleepscreen-test"
rm -rf "$OUT"
