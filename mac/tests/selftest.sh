#!/bin/bash
# The PS self test, the one way to run it (ps-notes skill, "Testing"): builds the test copy (never installed),
# runs it with PS_SELFTEST=<out dir> and fictional data, ONE test copy at a time (the test copy takes
# /tmp/ps-selftest.lock itself; this waits while another one runs), zero network, every window off screen.
# Exits 0 only when it is clean: the run reached DONE, every SCREEN CHECK and NETWORK CHECK says ok (the
# Second Computer peer's too) and no check says FAIL. Used by the Second Computer selftest job on the
# secondary Mac and by web scripts/second.ts when it falls back to this Mac.
#   bash tests/selftest.sh <empty out dir> [area]        area: one PS_SELFTEST_ONLY area (eg dnd, second)
# Environment: PS_WEB_DIR / SKIP_WEB / PS_APP_OUT as build.sh; SKIP_BUILD=1 tests the existing copy;
# PS_SELFTEST_WEB=<dist-ps> loads other web files; PS_SELFTEST_WAIT (s, default 1800) for the lock;
# PS_SELFTEST_TIMEOUT (s, default 1800) for the run. Exit 0 clean, 1 not clean, 2 could not run, 3 the lock never came free.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:?usage: selftest.sh <empty out dir> [area]}"
AREA="${2:-}"
APP="${PS_APP_OUT:-$HERE/build/PS.app}"
case "$OUT" in /Applications*|"$HOME"|/) echo "SELFTEST.SH: not there: $OUT"; exit 2;; esac
[[ "$AREA" =~ ^[a-z0-9]{0,20}$ ]] || { echo "SELFTEST.SH: bad area"; exit 2; }
mkdir -p "$OUT" && OUT="$(cd "$OUT" && pwd)" || exit 2

if [ "${SKIP_BUILD:-}" != 1 ]; then
  echo "SELFTEST.SH: building the test copy at $APP"
  PS_APP_OUT="$APP" NO_INSTALL=1 bash "$HERE/build.sh" > "$OUT/build.log" 2>&1 || { echo "SELFTEST.SH: the build failed (see $OUT/build.log)"; tail -20 "$OUT/build.log"; exit 2; }
fi
EXE="$APP/Contents/MacOS/PS"
[ -x "$EXE" ] || { echo "SELFTEST.SH: no test copy at $APP"; exit 2; }
case "$APP" in /Applications/*) echo "SELFTEST.SH: never the installed PS"; exit 2;; esac

LOG="$OUT/selftest.log"
waited=0; limit="${PS_SELFTEST_WAIT:-1800}"; maxrun="${PS_SELFTEST_TIMEOUT:-1800}"
while :; do
  rm -rf "$OUT/run"; mkdir -p "$OUT/run"
  ( cd "$OUT/run" && exec env PS_SELFTEST="$OUT/run" ${AREA:+PS_SELFTEST_ONLY="$AREA"} "$EXE" ) > "$LOG" 2>&1 &
  pid=$!
  start=$SECONDS
  while kill -0 "$pid" 2>/dev/null; do
    if [ $((SECONDS - start)) -ge "$maxrun" ]; then
      echo "SELFTEST.SH: over ${maxrun} s, stopping the test copy (pid $pid, started here)"
      kill -TERM "$pid" 2>/dev/null; sleep 3; kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null
      break
    fi
    sleep 1
  done
  wait "$pid"; code=$?
  if [ "$code" = 3 ] && grep -q "another test copy is running" "$LOG"; then
    [ "$waited" -ge "$limit" ] && { echo "SELFTEST.SH: another test copy kept the lock for ${limit} s"; exit 3; }
    [ "$waited" = 0 ] && echo "SELFTEST.SH: another PS test copy is running, waiting"
    sleep 10; waited=$((waited + 10)); continue
  fi
  break
done

# Every check line, then the verdict.
grep -E "CHECK:|^SECOND PEER:|^DONE" "$LOG" | cut -c1-600
bad=0
grep -q "^DONE" "$LOG" || { echo "SELFTEST.SH: the run did not reach DONE (exit $code)"; bad=1; }
grep -qE "(^|[ ])SCREEN CHECK: ok" "$LOG" || { echo "SELFTEST.SH: no SCREEN CHECK ok"; bad=1; }
grep -qE "(^|[ ])NETWORK CHECK: ok" "$LOG" || { echo "SELFTEST.SH: no NETWORK CHECK ok"; bad=1; }
# No `grep -q` at the end of a pipe here: under pipefail the grep before it dies of SIGPIPE once -q has its match,
# the pipe counts as failed and every FAIL went unreported as "clean" (found 1 Nov 2026, 8 FAIL lines, "clean").
# Every "=FAIL" anywhere in the log counts, not only on "CHECK:" lines: some areas print their checks on indented lines
# under the heading ("  card-has-update-button=FAIL"), and those once passed as "clean" (found 4 Nov 2026).
fails="$(grep -oE "[^[:space:]=(]+=FAIL|[A-Z ]+CHECK: FAIL" "$LOG" | sort -u | tr '\n' ' ' || true)"
if [ -n "${fails// /}" ]; then echo "SELFTEST.SH: $fails"; bad=1; fi
if [ "$bad" = 0 ]; then echo "SELFTEST.SH: clean${AREA:+ ($AREA)}"; exit 0; fi
echo "SELFTEST.SH: NOT clean${AREA:+ ($AREA)}, full log: $LOG"
exit 1
