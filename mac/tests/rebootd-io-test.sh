#!/bin/bash
# rebootd's file, clock and console code, run as the developer (no root, schedules and restarts nothing).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
swiftc -O -parse-as-library -D REBOOTD_TEST "$HERE/Helper/rebootd.swift" "$HERE/Helper/RebootCore.swift" "$HERE/Helper/RebootXPC.swift" "$HERE/Helper/LidCore.swift" "$HERE/tests/rebootd-io-test.swift" -o "$OUT/rebootd-io-test"
"$OUT/rebootd-io-test"
