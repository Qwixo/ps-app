#!/bin/bash
# Unit tests for the G Squad message card (Sources/SquadMessageCore.swift and the card page's script in SquadMessageCard.swift,
# PS 1.60). No window opens, nothing is sent. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/squad-message-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/SquadMessageCore.swift" "$OUT/main.swift" -o "$OUT/squad-message-test"
"$OUT/squad-message-test"
rm -rf "$OUT"
node "$HERE/tests/squad-message-card-test.mjs"
# The hooks in Toast.swift and main.swift are there: the tone, the typing keyboard, the reply route, Open, and the Sentry rule.
T="$HERE/Sources/Toast.swift"; M="$HERE/Sources/main.swift"
grep -q 'SquadMessageCore.held(sentry: Sentry.shared.isUp, sleep: SleepScreen.shared.isUp)' "$T" || { echo "held-hook=FAIL"; exit 1; }
grep -q 'SquadMsg.focus()' "$T" && grep -q 'SquadMsg.esc()' "$T" && grep -q 'case "sqreply"' "$T" || { echo "keyboard-hooks=FAIL"; exit 1; }
grep -q 'if(SquadMsg.hold(c))return;' "$T" || { echo "hold-hook=FAIL (Toast remove() must ask SquadMsg.hold first)"; exit 1; }
grep -q 'Toast.shared.onSquadReply' "$M" && grep -q 'SquadMessageCore.opensChat' "$M" || { echo "main-hooks=FAIL"; exit 1; }
echo "hooks=ok"
