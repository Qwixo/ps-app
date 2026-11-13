#!/bin/bash
# Unit tests for AI Sentry mode from Sleep mode (V1.52): the pure rules (Sources/SleepSentryCore.swift) and, by reading
# the sources, the wiring in SleepScreen.swift, Sentry.swift and SleepSentry.swift. No window opens, nothing is locked,
# held, asked or engaged, so it is safe while someone is using the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/sleepsentry-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
# SentryCore.swift needs SentryLid.StopReason only: a stub with the same cases (copied from the real file).
{ echo "final class SentryLid {"; grep -m1 "enum StopReason" "$HERE/Sources/SentryLid.swift"; echo "}"; } > "$OUT/lid-stub.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/SentryCore.swift" "$HERE/Sources/SleepSentryCore.swift" "$OUT/lid-stub.swift" "$OUT/main.swift" -o "$OUT/sleepsentry-test"
PS_MAC_DIR="$HERE" "$OUT/sleepsentry-test"
rm -rf "$OUT"
