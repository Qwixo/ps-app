#!/bin/bash
# Unit tests for Reply from PS (Sources/MailSendCore.swift) with fake Gmail and Instantly clients. Never sends anything.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/mailsend-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/MailSendCore.swift" "$OUT/main.swift" -o "$OUT/mailsend-test"
"$OUT/mailsend-test"
rm -rf "$OUT"
