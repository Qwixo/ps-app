#!/bin/bash
# Unit tests for the lid row of Sleep mode's AI Sentry mode pop up (V1.54, lid-notice-154: SleepSentryRules.lidPanel and
# the wiring in SleepSentry.swift). Nothing opens, engages or is held; safe while someone is using the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/sleepsentry-lid-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
{ echo "final class SentryLid {"; grep -m1 "enum StopReason" "$HERE/Sources/SentryLid.swift"; echo "}"; } > "$OUT/lid-stub.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/SentryCore.swift" "$HERE/Sources/SleepSentryCore.swift" "$OUT/lid-stub.swift" "$OUT/main.swift" -o "$OUT/sleepsentry-lid-test"
PS_MAC_DIR="$HERE" "$OUT/sleepsentry-lid-test"
