#!/bin/bash
# Unit tests for Add Telegram Bot (Sources/TelegramBotCore.swift). Never touches the network or the Keychain.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/tgbot-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/TelegramBotCore.swift" "$OUT/main.swift" -o "$OUT/tgbot-test"
"$OUT/tgbot-test"
rm -rf "$OUT"
