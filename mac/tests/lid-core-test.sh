#!/bin/bash
# Unit tests for Sentry mode's lid closed keep awake in the helper (Helper/LidCore.swift). No root, no IOKit, nothing changed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/lid-core-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Helper/LidCore.swift" "$HERE/Helper/RebootCore.swift" "$OUT/main.swift" -o "$OUT/lid-core-test"
"$OUT/lid-core-test"
