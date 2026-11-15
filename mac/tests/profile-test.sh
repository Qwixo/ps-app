#!/bin/bash
# Offline test for Sources/Profile.swift and Sources/Features.swift (V1.58). No app is run.
# The G Squad profile comes from web core-root/profiles/gsquad.json (PS_GSQUAD_PROFILE to point elsewhere).
set -e
cd "$(dirname "$0")/.."
P="${PS_GSQUAD_PROFILE:-$HOME/Projects/ps/web/core-root/profiles/gsquad.json}"
mkdir -p build/profile
cp tests/profile-test.swift build/profile/main.swift
swiftc build/profile/main.swift Sources/BuildRules.swift Sources/Profile.swift Sources/Features.swift -o build/profile/test
# V1.61: the bundled registry a build made the old way gets (build.sh), from core's features.json next to the G Squad profile.
node tools/bundle-features.mjs "$(dirname "$(dirname "$P")")/.." build/profile/ps-build.json >/dev/null
PS_SELFTEST=1 build/profile/test "$P" build/profile/ps-build.json
# V1.61: the wiring the test above cannot run: main.swift hands the page's answers to Features.handle, and build.sh
# bundles the registry when there is no assembled ps-build.json.
grep -q 'if fromMain && Features.handle(type, msg) { return }' Sources/main.swift && echo "main-routes-features=ok" || { echo "main-routes-features=FAIL"; exit 1; }
grep -q 'node "$HERE/tools/bundle-features.mjs" "$WEB" "$APP/Contents/Resources/ps-build.json"' build.sh && echo "build-bundles-registry=ok" || { echo "build-bundles-registry=FAIL"; exit 1; }
