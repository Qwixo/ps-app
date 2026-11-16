#!/bin/bash
# Unit tests for Proton Mail through Bridge (Sources/ProtonBridgeCore.swift, PS 1.65): the loopback guard, the pinned
# certificate, IMAP answers, the SMTP reply, the Done list. A scripted fake connection answers; no socket is ever made.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/proton-bridge-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/ProtonBridgeCore.swift" "$OUT/main.swift" -o "$OUT/proton-test"
"$OUT/proton-test"
rm -rf "$OUT"
