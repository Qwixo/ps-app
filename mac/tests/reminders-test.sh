#!/bin/bash
# Unit tests for the Annoying 15 min reminders' rules on a Mac (Sources/RemMath.swift): the schedule across days,
# midnight and time zones, done and snooze, the plan from the page, the old daily reminder. The same numbers as
# web tests/remind.test.ts. No window, no sound, nothing read or written: safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/reminders-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/RemMath.swift" "$OUT/main.swift" -o "$OUT/reminders-test"
"$OUT/reminders-test"
rm -rf "$OUT"
