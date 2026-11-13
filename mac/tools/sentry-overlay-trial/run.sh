#!/bin/bash
# Builds and runs the Sentry overlay trial (sentry-real-lock; NOT part of PS.app, see main.swift). The developer runs it himself:
#   bash tools/sentry-overlay-trial/run.sh             windows made after the lock
#   bash tools/sentry-overlay-trial/run.sh --prepare   windows made (invisible, click through) just before the lock
#   bash tools/sentry-overlay-trial/run.sh --build-only   compile only, lock nothing
# It locks the Mac. Touch ID or the password unlocks it as always, and that also ends the trial.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if pgrep -f 'swift-build|swiftc|xcodebuild' >/dev/null; then echo "Another Swift build is running. Try again in a minute."; exit 1; fi
OUT="${TMPDIR:-/tmp}/ps-sentry-overlay-trial"
mkdir -p "$OUT"
swiftc -O -target arm64-apple-macos13 "$HERE/TrialCore.swift" "$HERE/main.swift" -o "$OUT/sentry-overlay-trial"
if [ "${1:-}" = "--build-only" ]; then echo "Built $OUT/sentry-overlay-trial (nothing run)."; exit 0; fi
echo "Built. Your Mac locks in 3 seconds. Unlock with Touch ID or your password to end the trial."
sleep 3
exec "$OUT/sentry-overlay-trial" "$@"
