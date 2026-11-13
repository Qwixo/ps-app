#!/bin/bash
# Unit tests for the Sentry overlay trial's rules (tools/sentry-overlay-trial/TrialCore.swift) and, by reading the
# sources, its safety rules. Nothing locks, opens or is held, so it is safe while someone is using the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/sentry-overlay-trial-test.swift" "$OUT/main.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/tools/sentry-overlay-trial/TrialCore.swift" "$OUT/main.swift" -o "$OUT/trial-test"
PS_MAC_DIR="$HERE" "$OUT/trial-test"
rm -rf "$OUT"
