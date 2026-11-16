#!/bin/bash
# Unit tests for outsourcing work to the other computer (Sources/OutsourceCore.swift, OutsourceRunner.swift, OutsourceStore.swift, the ps-outsource script).
# A shell script stands in for `claude` and `codex`; a temp git repo stands in for the code. Nothing touches the network, the
# Keychain (a temp file stands in), the person's own repositories or the real PS folder. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/outsource-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/OutsourceCore.swift" "$HERE/Sources/OutsourceRunner.swift" "$HERE/Sources/OutsourceStore.swift" "$HERE/Sources/KeychainQuiet.swift" "$OUT/main.swift" -o "$OUT/outsource-test" 2>&1 | grep -E "error" || true
"$OUT/outsource-test"
