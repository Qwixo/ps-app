#!/bin/bash
# Unit tests for AI chat finished cards (Sources/AiDoneCore.swift, V1.53). Temp folders only: the real ~/.claude,
# ~/.codex, ~/.gemini and ~/.cursor are never touched, no window opens, nothing is sent. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/aidone-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/AiDoneCore.swift" "$OUT/main.swift" -o "$OUT/aidone-test"
"$OUT/aidone-test"
rm -rf "$OUT"
# Open source build: no hook is written at launch, only a click on On does it (AiDone.handle), and Off still takes it out.
A="$HERE/Sources/AiDone.swift"
[ "$(grep -c 'installer.install(' "$A")" = "1" ] && grep -q 'on ? installer.install(t) : installer.uninstall(t)' "$A" && ! grep -q 'i.install(.claude)' "$A" || { echo "no-hook-at-launch=FAIL"; exit 1; }
echo "no-hook-at-launch=ok"
# V1.57: the card carries the prompt's turn so the page shows one card per prompt.
grep -q 'if !turn.isEmpty { item\["turn"\] = turn }' "$A" || { echo "turn-sent=FAIL"; exit 1; }
echo "turn-sent=ok"
