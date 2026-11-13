#!/bin/bash
# release/audit.py: a build is audited as strictly as ever, and --source (the open source tree) allows only what
# source code names on purpose. Offline, writes only into a temporary folder.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/tests" "$T/src"
printf 'grant select on t to service_role;\nconst k = "service_role";\person11@gmail.com\n' > "$T/src/a.ts"
printf 'x = [".drop-secret", "-----BEGIN PRIVATE KEY-----"]\n' > "$T/tests/b.ts"
printf 'mail person2@gmail.com\n' > "$T/src/c.ts"
pass=0; fail=0; ok() { if eval "$2"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $1"; fi; }
B="$(python3 -I "$HERE/release/audit.py" "$T" 2>&1)"; bs=$?
S="$(python3 -I "$HERE/release/audit.py" --source "$T" 2>&1)"; ss=$?
ok "build mode blocks"                         '[ $bs -eq 1 ]'
ok "build mode blocks a placeholder email"      'grep -q "email person3@gmail.com" <<<"$B"'
ok "build mode blocks the role name"            'grep -q "const k = \"\"" <<<"$B" || grep -q "service_role" <<<"$B"'
ok "build mode blocks shapes in tests"          'grep -q "tests/b.ts" <<<"$B"'
ok "source mode still blocks a real address"    '[ $ss -eq 1 ] && grep -q "email person2@gmail.com" <<<"$S"'
ok "source mode allows placeholders"            '! grep -q "person3@gmail.com" <<<"$S"'
ok "source mode allows shapes in tests"         '! grep -q "tests/b.ts" <<<"$S"'
printf 'k = "service_role": "eyJFAKEABCDEFGHIJKLMNOPQRSTUV.x.y"\n' > "$T/src/d.ts"
S2="$(python3 -I "$HERE/release/audit.py" --source "$T" 2>&1)"
ok "source mode blocks the role name with a key" 'grep -q "src/d.ts" <<<"$S2"'
echo "audit-source: $pass passed, $fail failed"; [ $fail -eq 0 ]
