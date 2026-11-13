#!/bin/bash
# Run on a BUILT PS.app (the release build, signed with PS Local Signing): proves the XPC checks in
# Helper/RebootXPC.swift match how PS and its helper are really signed, both ways, and that the
# helper is where SMAppService expects it. Usage: tests/reboot-signing-check.sh [/path/to/PS.app]
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
. "$HERE/tools/installed-app.sh"
APP="${1:-$(ps_installed_app)}"   # the installed PS under whatever name it has (V1.36)
CERT=$(sed -n 's/.*static let cert = "\([0-9a-f]*\)".*/\1/p' "$HERE/Helper/RebootXPC.swift")
PSR="identifier \"com.cincee.ps\" and certificate root = H\"$CERT\""
HR="identifier \"com.cincee.ps.rebootd\" and certificate root = H\"$CERT\""
H="$APP/Contents/Resources/rebootd"; P="$APP/Contents/Library/LaunchDaemons/com.cincee.ps.rebootd.plist"
fails=0
t() { if eval "$2" >/dev/null 2>&1; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }
t "PS satisfies the requirement rebootd checks" "codesign -v -R='$PSR' '$APP'"
t "rebootd satisfies the requirement PS checks" "codesign -v -R='$HR' '$H'"
t "PS does not pass as the helper" "! codesign -v -R='$HR' '$APP'"
t "the helper does not pass as PS" "! codesign -v -R='$PSR' '$H'"
t "the helper has the hardened runtime" "[[ \"\$(codesign -dv '$H' 2>&1)\" == *'(runtime)'* ]]"
t "the whole app verifies strictly" "codesign --verify --deep --strict '$APP'"
t "the daemon plist is valid" "plutil -lint '$P'"
t "the plist runs the helper from Contents/Resources" "[ \"\$(plutil -extract BundleProgram raw '$P')\" = Contents/Resources/rebootd ]"
t "the plist's mach service is the one PS calls" "[[ \"\$(plutil -extract MachServices xml1 -o - '$P')\" == *'<key>com.cincee.ps.rebootd</key>'* ]]"
# V1.45: the helper is the pinned one (tools/helper-pin.sh), so a Mac that switched it on keeps it after this update.
t "the helper is the pinned one (same cdhash as Helper/pinned)" "[ \"\$(codesign -dvvv '$H' 2>&1 | sed -n 's/^CDHash=//p')\" = \"\$(sed -n 's/^cdhash=//p' '$HERE/Helper/pinned/rebootd.pin')\" ]"
echo "REBOOT SIGNING: $((10 - fails)) of 10 ok"
[ $fails -eq 0 ]
