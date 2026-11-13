#!/bin/bash
# Unit tests for Sentry mode's pure rules (Sources/SentryCore.swift, V1.48). No window opens, nothing is locked, held or
# dimmed, so it is safe while someone is using the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/sentry-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
# SentryLid.swift (the real helper client since V1.48) needs the rest of PS; the rules only need its StopReason, so a
# stub with the same cases (copied from the real file, so they cannot drift) stands in.
{ echo "final class SentryLid {"; grep -m1 "enum StopReason" "$HERE/Sources/SentryLid.swift"; echo "}"; } > "$OUT/lid-stub.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/SentryCore.swift" "$OUT/lid-stub.swift" "$OUT/main.swift" -o "$OUT/sentry-test"
PS_MAC_DIR="$HERE" "$OUT/sentry-test"
rm -rf "$OUT"
