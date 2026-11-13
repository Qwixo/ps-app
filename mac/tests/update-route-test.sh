#!/bin/bash
# Unit tests for which update channel a build follows (V1.58, multiple developers), the keys it trusts and the "by" line.
# Offline, a temp folder only, no app launched, nothing installed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/update-route-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/UpdateCore.swift" "$HERE/Sources/UpdateLatest.swift" "$HERE/Sources/AppName.swift" "$HERE/Sources/Protected.swift" "$OUT/main.swift" -o "$OUT/update-route-test"
"$OUT/update-route-test"
