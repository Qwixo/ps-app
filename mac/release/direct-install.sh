#!/bin/bash
# One-time install of a built PS.app straight into /Applications, around the running PS's own
# updater. Why (27 Oct 2026): build 2610270059's update helper took the new build's call too late,
# so every update from it rolled back. A build with the fix updates normally from then on.
# What it does: checks the new app's signature (the developer's certificate, PS, hardened runtime), quits PS
# cleanly (and any update helper, so nothing can roll this back), moves the old app to the Trash,
# puts the new one in place without the quarantine flag, checks it again and opens it.
# The developer then signs in once and clicks Allow once in Little Snitch (a new build; same as before).
#   bash release/direct-install.sh [PS.app]       (default: ps-mac/build/PS.app)
# build.sh uses it when PS_DIRECT_INSTALL=1, so: PS_DIRECT_INSTALL=1 npm run release -- --app
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$(cd "${1:-$HERE/build/PS.app}" && pwd)"
# PS_DIRECT_DEST / PS_DIRECT_SUPPORT / PS_DIRECT_TRASH: a test folder instead (it is then not opened).
# Without one: the PS installed in /Applications under whatever name it has (V1.36), else /Applications/PS.app.
. "$HERE/tools/installed-app.sh"
DEST="${PS_DIRECT_DEST:-$(ps_installed_app)}"
REQ='identifier "com.cincee.ps" and certificate root = H"c0e302f2ce304d062a50d6ebdaff97d5f7d4b6e6"'
SUPPORT="${PS_DIRECT_SUPPORT:-$HOME/Library/Application Support/PS/update}"
TRASH="${PS_DIRECT_TRASH:-$HOME/.Trash}"
DIR="$(dirname "$DEST")"

check() {   # check <app>: the developer's certificate, PS, hardened runtime, nothing changed after signing
  codesign --verify --strict --deep -R="$REQ" "$1"
  local info; info="$(codesign -dv "$1" 2>&1)"
  grep -q 'flags=.*(runtime)' <<<"$info" || { echo "$1 is not signed with the hardened runtime"; exit 1; }
}
# Signals only a pid above 1, not this script, whose executable is exactly the expected path,
# checked right before (27 Oct 2026: never pkill, never anything matched by name, never kill -1).
safe_signal() {   # safe_signal <TERM|KILL> <pid> <expected executable>
  local pid="$2" exe want
  [[ "$pid" =~ ^[0-9]+$ ]] && [ "$pid" -gt 1 ] && [ "$pid" != "$$" ] || return 1
  exe="$(ps -p "$pid" -o comm= 2>/dev/null)" || return 1
  exe="$(realpath "$exe" 2>/dev/null)" || return 1; want="$(realpath "$3" 2>/dev/null)" || return 1
  [ -n "$exe" ] && [ "$exe" = "$want" ] || return 1
  kill "-$1" "$pid"
}
# The pids running exactly <executable> (full path, never a name).
pids_running() {  # pids_running exact <executable>
  ps -axo pid=,comm= | while read -r pid exe; do [ "$exe" = "$2" ] && echo "$pid"; done
}
check "$APP"
BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist")"

# 1. Nothing may roll this back: stop any update helper first, then quit PS cleanly.
#    An update helper runs a previous PS build from the update folders.
#    Each is checked again (same pid, same executable) right before the signal.
for dir in "$SUPPORT/previous" "$(dirname "$DEST")/.PS-update/previous"; do
  ps -axo pid=,comm= | while read -r pid exe; do
    case "$exe" in "$dir"/*/Contents/MacOS/PS) safe_signal TERM "$pid" "$exe" && echo "stopped an update helper (pid $pid)" ;; esac
  done
done
EXE="$DEST/Contents/MacOS/PS"
if [ -n "$(pids_running exact "$EXE")" ]; then
  osascript -e 'tell application id "com.cincee.ps" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 100); do [ -z "$(pids_running exact "$EXE")" ] && break; sleep 0.2; done
  if [ -n "$(pids_running exact "$EXE")" ]; then
    echo "PS did not quit in 20 s, asking it to stop"
    for pid in $(pids_running exact "$EXE"); do safe_signal TERM "$pid" "$EXE" || true; done; sleep 3
  fi
  if [ -n "$(pids_running exact "$EXE")" ]; then echo "PS is still running: stopped here, nothing changed"; exit 1; fi
fi
# An unfinished update note would make the new build think it is mid update: keep it, out of the way.
[ -f "$SUPPORT/journal.json" ] && mv -f "$SUPPORT/journal.json" "$SUPPORT/journal-before-direct-install.json"

# 2. The swap: the new app is copied next to the old one first, so the switch itself is two renames.
NEWCOPY="$DIR/.PS-new.app"
rm -rf "$NEWCOPY"
ditto --noqtn "$APP" "$NEWCOPY"
xattr -dr com.apple.quarantine "$NEWCOPY" 2>/dev/null || true
check "$NEWCOPY"
if [ -d "$DEST" ]; then
  OLD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$DEST/Contents/Info.plist" 2>/dev/null || echo old)"
  mv "$DEST" "$TRASH/PS-$OLD-$(date +%Y%m%d-%H%M%S).app"
fi
mv "$NEWCOPY" "$DEST"
check "$DEST"

# 3. Open it and make sure it runs.
if [ -n "${PS_DIRECT_DEST:-}" ]; then echo "PS build $BUILD installed in $DEST (test, not opened)"; exit 0; fi
open "$DEST"
for _ in $(seq 1 50); do [ -n "$(pids_running exact "$EXE")" ] && break; sleep 0.2; done
[ -n "$(pids_running exact "$EXE")" ] && echo "PS build $BUILD installed directly and running (the old app is in the Trash)" \
  || { echo "WARNING: PS build $BUILD is installed but did not start; open it from Applications"; exit 1; }
