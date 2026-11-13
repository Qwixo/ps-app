#!/bin/bash
# Builds the two C++ libraries the offline translator helper (PSTranslate) links in, once, into a cache
# outside the repo: CTranslate2 (MIT, CPU only: Apple Accelerate for float, Google Ruy for int8, no OpenMP)
# and SentencePiece (Apache 2.0). Sources are pinned tags; nothing here is downloaded at run time by PS.
# Usage: bash tools/translate/build-deps.sh   (prints the prefix it installed to)
# PS_BUILD_CACHE overrides the cache (default ~/Library/Caches/ps-build).
set -euo pipefail
CACHE="${PS_BUILD_CACHE:-$HOME/Library/Caches/ps-build}"
CT2_TAG=v4.8.5; SP_TAG=v0.2.1
PREFIX="$CACHE/translate-deps-$CT2_TAG-$SP_TAG"
if [ -f "$PREFIX/.done" ]; then echo "$PREFIX"; exit 0; fi
mkdir -p "$CACHE"; cd "$CACHE"
# cmake and ninja: the ones on PATH, else pip copies in a small venv inside the cache (made once).
if ! command -v cmake >/dev/null || ! command -v ninja >/dev/null; then
  [ -x "$CACHE/tools-venv/bin/cmake" ] || { python3 -m venv "$CACHE/tools-venv" && "$CACHE/tools-venv/bin/pip" install -q cmake ninja; }
  export PATH="$CACHE/tools-venv/bin:$PATH"
fi
if [ ! -d ct2-src ]; then
  git clone -q --depth 1 --branch "$CT2_TAG" https://github.com/OpenNMT/CTranslate2 ct2-src
  git -C ct2-src submodule update --init --depth 1 third_party/spdlog third_party/ruy third_party/cpu_features
  git -C ct2-src/third_party/ruy submodule update --init --depth 1 third_party/cpuinfo
fi
[ -d sp-src ] || git clone -q --depth 1 --branch "$SP_TAG" https://github.com/google/sentencepiece sp-src
COMMON=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 -DCMAKE_INSTALL_PREFIX="$PREFIX" -DBUILD_SHARED_LIBS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5)
cmake -S ct2-src -B ct2-build "${COMMON[@]}" -DWITH_MKL=OFF -DWITH_ACCELERATE=ON -DWITH_RUY=ON -DOPENMP_RUNTIME=NONE -DBUILD_CLI=OFF -DENABLE_CPU_DISPATCH=OFF
cmake --build ct2-build
cmake --install ct2-build
cmake -S sp-src -B sp-build "${COMMON[@]}" -DSPM_ENABLE_SHARED=OFF -DSPM_ENABLE_TCMALLOC=OFF
cmake --build sp-build
cmake --install sp-build
# ruy and cpuinfo static archives are not installed by CTranslate2: keep them next to it.
mkdir -p "$PREFIX/lib/extra"
find ct2-build -name '*.a' ! -name 'libctranslate2.a' -exec cp {} "$PREFIX/lib/extra/" \;
touch "$PREFIX/.done"
echo "$PREFIX"
