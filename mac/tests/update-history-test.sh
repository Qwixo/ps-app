#!/bin/bash
# Unit tests for the earlier versions' notes in the signed update note (Sources/UpdateCore.swift, V1.52).
# Offline, a temp folder only, no app launched, nothing installed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/update-history-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/UpdateCore.swift" "$HERE/Sources/UpdateLatest.swift" "$HERE/Sources/AppName.swift" "$HERE/Sources/Protected.swift" "$OUT/main.swift" -o "$OUT/update-history-test"
"$OUT/update-history-test"
