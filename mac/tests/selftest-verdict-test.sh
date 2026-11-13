#!/bin/bash
# Checks the verdict of tests/selftest.sh without the real app: a fake "test copy" (a shell script in a scratch
# folder, never PS itself) prints log lines, and selftest.sh must call the run clean or not clean from them.
# An indented check line ("  card-has-update-button=FAIL", as some areas print them) must fail the run (4 Nov 2026).
#   bash tests/selftest-verdict-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0

run() {   # run <name> <want exit> <log lines...>
  local name="$1" want="$2"; shift 2
  local app="$TMP/$name/PS.app"
  mkdir -p "$app/Contents/MacOS"
  { echo '#!/bin/bash'; for l in "$@"; do printf 'echo %q\n' "$l"; done; } > "$app/Contents/MacOS/PS"
  chmod +x "$app/Contents/MacOS/PS"
  PS_APP_OUT="$app" SKIP_BUILD=1 bash "$HERE/tests/selftest.sh" "$TMP/$name/out" > "$TMP/$name.txt" 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then echo "ok $name"; else echo "FAILED $name: exit $got, want $want"; cat "$TMP/$name.txt"; fails=$((fails + 1)); fi
}

run clean 0 "SETTINGS CHECK:" "  card-has-update-button=ok" "SCREEN CHECK: ok" "NETWORK CHECK: ok sockets=0" "DONE"
run indented-fail 1 "SETTINGS CHECK:" "  card-has-update-button=FAIL" "SCREEN CHECK: ok" "NETWORK CHECK: ok sockets=0" "DONE"
run fail-on-check-line 1 "STACK CHECK: one-card=ok new-pill-goes-to-top=FAIL" "SCREEN CHECK: ok" "NETWORK CHECK: ok sockets=0" "DONE"
run whole-check-fail 1 "HIDDEN PAGE CHECK: FAIL nudges answered=15/15" "SCREEN CHECK: ok" "NETWORK CHECK: ok sockets=0" "DONE"
run no-done 1 "SCREEN CHECK: ok" "NETWORK CHECK: ok sockets=0"

if [ "$fails" = 0 ]; then echo "selftest verdict: 5 of 5 ok"; exit 0; fi
echo "selftest verdict: $fails failed"; exit 1
