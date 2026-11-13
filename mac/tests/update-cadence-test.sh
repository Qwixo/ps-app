#!/bin/bash
# Unit test for the 5 minute update rhythm and its back off (Sources/UpdateLatest.swift, UpdateCadence). Offline, nothing launched.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/tests/update-cadence-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/UpdateCore.swift" "$HERE/Sources/UpdateLatest.swift" "$HERE/Sources/AppName.swift" "$HERE/Sources/Protected.swift" "$OUT/main.swift" -o "$OUT/update-cadence-test"
"$OUT/update-cadence-test"
# The updater really uses it: no fixed 30 minute repeat left, every look goes through the cadence, one shot timer re-armed after each look.
U="$HERE/Sources/Updater.swift"
! grep -q "repeating: 30 \* 60" "$U" || { echo "updater-no-30-minute-repeat=FAIL"; exit 1; }
grep -q "UpdateCadence.first" "$U" && grep -q "cadence.begin(manual: manual)" "$U" && grep -q "cadence.end(failed: failed)" "$U" && grep -q "now() + cadence.delay" "$U" || { echo "updater-uses-cadence=FAIL"; exit 1; }
echo "updater-uses-cadence=ok"
grep -q 'case "update:every" where fromOverlay' "$HERE/Sources/main.swift" && grep -q "func setEvery" "$U" && grep -q 'forKey: Updater.everyKey' "$U" || { echo "setting-reaches-the-updater=FAIL"; exit 1; }
echo "setting-reaches-the-updater=ok"
# Off: the timer and a wake go through autoLook, which looks only when not Off; the website hint is the developer's only.
grep -q "func autoLook" "$U" && grep -q "guard !cadence.isOff else { return }" "$U" && grep -q "self?.autoLook()" "$U" && grep -q "UpdateCadence.stored(UserDefaults.standard.object(forKey: Updater.everyKey))" "$U" || { echo "off-stops-automatic-looks=FAIL"; exit 1; }
grep -q "guard Owner.red, !Updater.shared.autoOff else" "$HERE/Sources/main.swift" || { echo "website-hint-developer-only=FAIL"; exit 1; }
echo "off-stops-automatic-looks=ok"
