#!/bin/bash
# Unit tests for Sentry mode's lid keep awake, PS's half (Sources/SentryLid.swift), against a fake helper.
# Never connects to the real helper, never reads or changes any power setting.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/sentrylid-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/SentryLid.swift" "$HERE/Helper/RebootXPC.swift" "$HERE/Helper/LidCore.swift" "$HERE/Helper/RebootCore.swift" \
  "$HERE/tests/sentrylid-stubs.swift" "$OUT/main.swift" -o "$OUT/sentrylid-test"
"$OUT/sentrylid-test"
