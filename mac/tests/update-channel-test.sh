#!/bin/bash
# Unit tests for where PS asks for updates (V1.57: the public PS repo's GitHub releases, not cincee.com) and that the
# signature check did not change. Offline, a temp folder only, no app launched, nothing installed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/update-channel-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/UpdateCore.swift" "$HERE/Sources/UpdateLatest.swift" "$HERE/Sources/AppName.swift" "$HERE/Sources/Protected.swift" "$OUT/main.swift" -o "$OUT/update-channel-test"
"$OUT/update-channel-test"
# No code (comments aside) asks cincee.com/client/ps/ for updates any more.
if grep -n 'cincee\.com/client/ps' "$HERE"/Sources/*.swift | grep -v '^[^:]*:[0-9]*: *//' ; then echo "cincee-channel-in-code=FAIL"; exit 1; fi
echo "cincee-channel-in-code=ok"
