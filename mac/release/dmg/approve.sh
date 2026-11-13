#!/bin/bash
# The words in the PS.dmg picture ("Drag PS app to Applications", "or double-click PS app and click Install PS app")
# are public copy: make-dmg.sh uses the picture only when approved.json holds its exact SHA-256.
#   release/dmg/approve.sh show            the words and the picture's hash (show the developer first)
#   release/dmg/approve.sh approve <hash>  ONLY after the developer's yes to those words
#   release/dmg/approve.sh revoke          back to the plain PS.dmg
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SHA="$(shasum -a 256 "$HERE/background.tiff" | cut -d' ' -f1)"
case "${1:-}" in
  show) echo 'Words in the picture: "Drag PS app to Applications" / "or double-click PS app and click Install PS app"'
        echo "hash $SHA"; grep -q "\"$SHA\"" "$HERE/approved.json" 2>/dev/null && echo "approved: yes" || echo "approved: no" ;;
  approve) [ "${2:-}" = "$SHA" ] || { echo "That is not the current picture's hash: show it again."; exit 1; }
        printf '{ "sha256": "%s", "at": "%s" }\n' "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$HERE/approved.json"; echo "Approved: the next PS.dmg uses the picture." ;;
  revoke) rm -f "$HERE/approved.json"; echo "Not approved: plain PS.dmg." ;;
  *) echo "usage: approve.sh show | approve <hash> | revoke"; exit 1 ;;
esac
