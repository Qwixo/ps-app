#!/bin/bash
# Builds the shared web app for PS GOS (vite --mode gos in ~/Projects/ps/web) and copies it
# into the APK's assets. Same code as the website and PS on the Mac.
#   scripts/build-web.sh          the real app (release and normal debug builds)
#   scripts/build-web.sh --fake   emulator tests: fictional data only, never shipped (release.sh refuses it)
set -euo pipefail
FAKE=0; [ "${1:-}" = "--fake" ] && FAKE=1
cd "$(dirname "$0")/.."
WEB=${WEB_DIR:-../web}
if [ $FAKE = 1 ]; then
  ( cd "$WEB" && VITE_GOS_FAKE=1 NODE_ENV=development npx vite build --mode gos --logLevel warn )
else
  ( cd "$WEB" && npx tsc --noEmit -p . && npx vite build --mode gos --logLevel warn )
fi
rm -rf app/src/main/assets/client
mkdir -p app/src/main/assets/client
cp -R "$WEB/dist-gos/." app/src/main/assets/client/
# Not needed inside the app: the website's offline worker and install manifest.
rm -f app/src/main/assets/client/sw.js app/src/main/assets/client/manifest.webmanifest
[ $FAKE = 1 ] && echo fake > app/src/main/assets/client/FICTIONAL-TEST-DATA
echo "web: $(cat app/src/main/assets/client/version.json)$([ $FAKE = 1 ] && echo ' (fictional test data)')"
