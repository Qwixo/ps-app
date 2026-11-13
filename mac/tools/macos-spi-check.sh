#!/bin/bash
# V1.47: after a macOS update, checks the private macOS pieces PS uses still exist (tools/macos-spi-check.swift).
# Looks names up only. No window, nothing changed. Safe while the developer uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
swiftc -Onone -target arm64-apple-macos13 "$HERE/tools/macos-spi-check.swift" -o "$OUT/macos-spi-check" 2>/dev/null
"$OUT/macos-spi-check"; rc=$?
rm -rf "$OUT"
exit $rc
