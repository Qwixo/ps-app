#!/bin/bash
# Unit tests for the AI task API's checks on the Mac (Sources/TaskApiCore.swift): parsing, the browser, Host and key
# checks, the rate limit, the answer, and Sentry mode start only (no page message that stops it exists). No socket
# opens, no Keychain is touched, nothing is sent. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/taskapi-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/TaskApiCore.swift" "$OUT/main.swift" -o "$OUT/taskapi-test"
cat "$HERE"/Sources/*.swift > "$OUT/all-sources.txt"   # the Sentry check reads every source file
"$OUT/taskapi-test" "$OUT/all-sources.txt"
rm -rf "$OUT"
