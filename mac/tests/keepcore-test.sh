#!/bin/bash
# Unit tests for Keep overlay off (Sources/KeepCore.swift, V1.57): leaving the Tab list's Edit mode keeps the list up.
# No window opens, nothing is sent. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/keepcore-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/KeepCore.swift" "$OUT/main.swift" -o "$OUT/keepcore-test"
"$OUT/keepcore-test" "$HERE/Sources/main.swift"
rm -rf "$OUT"
