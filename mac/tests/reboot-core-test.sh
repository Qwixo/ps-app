#!/bin/bash
# Unit tests for the auto reboot timer's logic (Helper/RebootCore.swift). No root, no IOKit, no restart.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/reboot-core-test.swift" "$OUT/main.swift"   # top level code must be in main.swift
swiftc -O -D REBOOT_TEST_ACTIVE "$HERE/Helper/RebootCore.swift" "$OUT/main.swift" -o "$OUT/reboot-core-test"
"$OUT/reboot-core-test"
# The shipped build as compiled into rebootd (no -D flags): Active restarts, Watch only never does.
cp "$HERE/tests/reboot-shipped-test.swift" "$OUT/shipped/main.swift" 2>/dev/null || { mkdir -p "$OUT/shipped"; cp "$HERE/tests/reboot-shipped-test.swift" "$OUT/shipped/main.swift"; }
swiftc -O "$HERE/Helper/RebootCore.swift" "$OUT/shipped/main.swift" -o "$OUT/reboot-shipped-test"
"$OUT/reboot-shipped-test"
