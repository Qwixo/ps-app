#!/bin/bash
# Unit tests for Auto approve (Sources/AutoApproveCore.swift). Temp folders only: the real ~/.claude and ~/.codex are
# never touched, no window is read, no key is pressed. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/autoapprove-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/AutoApproveCore.swift" "$OUT/main.swift" -o "$OUT/autoapprove-test"
"$OUT/autoapprove-test"
rm -rf "$OUT"
