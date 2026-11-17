#!/bin/bash
# Unit tests for the Activity monitor's pure rules (Sources/ActivityCore.swift, PS 1.65). Pure values only: no process is read,
# nothing is ended, no window opens.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/activity-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/Protected.swift" "$HERE/Sources/ActivityCore.swift" "$OUT/main.swift" -o "$OUT/activity-test"
"$OUT/activity-test"
rm -rf "$OUT"
