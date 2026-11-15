#!/bin/bash
# Unit tests for G Squad messages on the island (Sources/SquadIslandCore.swift, PS 1.63). Pure values only: no window opens, no
# sound plays, nothing is sent. Safe while someone uses the Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/squad-island-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/SquadIslandCore.swift" "$OUT/main.swift" -o "$OUT/squad-island-test"
"$OUT/squad-island-test"
rm -rf "$OUT"
# The hooks are there: Toast offers the card first (after Do Not Disturb), hideCard retracts, the page's answer comes in, the island follows.
T="$HERE/Sources/Toast.swift"; M="$HERE/Sources/main.swift"; I="$HERE/Sources/Island.swift"
grep -q 'SquadIsland.shared.take(c)' "$T" || { echo "take-hook=FAIL"; exit 1; }
grep -q 'SquadIsland.shared.retract(id)' "$T" || { echo "retract-hook=FAIL"; exit 1; }
grep -q 'SquadIsland.shared.privacy = on' "$T" || { echo "privacy-hook=FAIL"; exit 1; }
grep -q 'case "sqresult"' "$M" && grep -q 'SquadIsland.shared.result' "$M" || { echo "result-hook=FAIL"; exit 1; }
grep -q 'SquadIsland.shared.follow()' "$I" && grep -q 'SquadIsland.shared.protectedChanged()' "$I" || { echo "island-hooks=FAIL"; exit 1; }
# Do Not Disturb holds first, then the island may take it.
awk '/if hold\(c, meet: true\)/{h=NR} /SquadIsland.shared.take\(c\)/{t=NR} END{exit !(h && t && h<t)}' "$T" || { echo "order=FAIL (hold must come before take)"; exit 1; }
echo "hooks=ok"
