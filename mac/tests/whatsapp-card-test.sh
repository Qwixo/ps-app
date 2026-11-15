#!/bin/bash
# Unit tests for a WhatsApp card's Reply on the Mac (Sources/WhatsAppCardCore.swift, V1.60). No window opens, nothing is sent.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/whatsapp-card-test.swift" "$OUT/main.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/WhatsAppCardCore.swift" "$OUT/main.swift" -o "$OUT/wa-card-test"
"$OUT/wa-card-test" "$HERE/Sources/main.swift" "$HERE/Sources/Toast.swift"
rm -rf "$OUT"
