#!/bin/bash
# Offline test for Sources/Profile.swift and Sources/Features.swift (V1.58). No app is run.
# The G Squad profile comes from web core-root/profiles/gsquad.json (PS_GSQUAD_PROFILE to point elsewhere).
set -e
cd "$(dirname "$0")/.."
P="${PS_GSQUAD_PROFILE:-$HOME/Projects/ps/web/core-root/profiles/gsquad.json}"
mkdir -p build/profile
cp tests/profile-test.swift build/profile/main.swift
swiftc build/profile/main.swift Sources/BuildRules.swift Sources/Profile.swift Sources/Features.swift -o build/profile/test
build/profile/test "$P"
