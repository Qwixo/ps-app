#!/bin/bash
# Unit tests for "one update always installs the newest release" (Sources/UpdateLatest.swift, UpdateChannel.sync fresh).
# Offline, a temp folder only, no app launched, nothing installed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/update-latest-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/UpdateCore.swift" "$HERE/Sources/UpdateLatest.swift" "$HERE/Sources/AppName.swift" "$HERE/Sources/Protected.swift" "$OUT/main.swift" -o "$OUT/update-latest-test"
"$OUT/update-latest-test"
