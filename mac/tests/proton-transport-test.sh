#!/bin/bash
# The real loopback connection (Sources/ProtonLoopback.swift) against a FAKE mail server of our own on 127.0.0.1 with a throwaway
# self signed certificate (tests/proton-fake-server.py). Never a real mail server, never a real account.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cleanup() { if [ -n "${PIDS:-}" ]; then kill $PIDS 2>/dev/null || true; wait $PIDS 2>/dev/null || true; fi; rm -rf "$OUT"; }
trap cleanup EXIT
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$OUT/k.pem" -out "$OUT/c.pem" -subj "/CN=127.0.0.1" -days 1 >/dev/null 2>&1
cp "$HERE/tests/proton-transport-test.swift" "$OUT/main.swift"
swiftc -Onone -target arm64-apple-macos13 "$HERE/Sources/ProtonBridgeCore.swift" "$HERE/Sources/ProtonLoopback.swift" "$OUT/main.swift" -o "$OUT/t" 2>&1 | grep -E "error" || true
# a port nothing listens on
DEAD=$(python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()")
PIDS=""
for mode in imap smtp; do
  python3 "$HERE/tests/proton-fake-server.py" $mode "$OUT/c.pem" "$OUT/k.pem" "$OUT/$mode.port" & PIDS="$PIDS $!"
  for i in $(seq 1 50); do [ -s "$OUT/$mode.port" ] && break; sleep 0.1; done
  timeout 60 "$OUT/t" $mode "$(cat "$OUT/$mode.port")" "$DEAD"
done
