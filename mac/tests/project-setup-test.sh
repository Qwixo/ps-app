#!/bin/bash
# Offline test of "Connect your own Supabase" (Sources/Project.swift, SupabaseAPI.swift, ProjectEngine.swift):
# a mock Supabase inside the test process, no socket, no account, nothing on screen. Needs web
# next to ps-mac (or PS_WEB_DIR) for the kit (scripts/ps-kit.mjs).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$(cd "${PS_WEB_DIR:-$HERE/../web}" && pwd)"
OUT="$HERE/build/project-setup"
rm -rf "$OUT"; mkdir -p "$OUT"
node "$WEB/scripts/ps-kit.mjs" "$OUT/kit" >/dev/null
cp "$HERE/tests/project-setup-test.swift" "$OUT/main.swift"
swiftc -Onone -g -target arm64-apple-macos13 "$OUT/main.swift" "$HERE/Sources/Project.swift" "$HERE/Sources/SupabaseAPI.swift" "$HERE/Sources/SetupGuideCore.swift" "$HERE/Sources/ProjectEngine.swift" -o "$OUT/test" 2>&1 | grep -E "error" || true
PS_PROJECT_TEST=1 PS_PROJECT_FILE="$OUT/project.json" "$OUT/test" "$OUT/kit" "$OUT/project.json"
