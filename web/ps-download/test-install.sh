#!/bin/bash
# Tests ps-download/install.sh in a folder of its own: never /Applications, never opens anything.
#   bash ps-download/test-install.sh <empty folder>
# Builds a local channel from the LIVE release (ps-update.json and the app zip it names on
# cincee.com/client/ps/) plus this folder's ps-verify.js, then runs install.sh against copies of it:
#   good         fresh install: "PS app.app" lands in the fake Applications, signed, the note's build
#   named        PS_INSTALL_NAME="My List - test": installed under that name (V1.36)
#   badname      PS_INSTALL_NAME="a/b"                            -> STOPPED, / or :
#   same         the same build already there: left alone, opened
#   older        an older build already there: left alone, pointed at Check for Updates
#   renamed      an older PS there under another name: found by its bundle id, left alone
#   badsig       the signed note with one byte changed            -> STOPPED, signature
#   otherkey     a note signed by a test key                      -> STOPPED, signature
#   badverifier  ps-verify.js changed                             -> STOPPED, checker
#   badzip       the app zip with one byte changed                -> STOPPED, SHA-256
#   badsize      the app zip with a byte added                    -> STOPPED, size
#   notpsapp     ad hoc signed app in a note the test key signed  -> STOPPED, certificate
#   readonly     Applications not writable                        -> STOPPED, administrator
# Every STOPPED case must leave the fake Applications without any app or a half copy.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:?usage: test-install.sh <empty folder>}"; mkdir -p "$ROOT"; ROOT="$(cd "$ROOT" && pwd)"
case "$ROOT" in /Applications*) echo "never in /Applications"; exit 1;; esac
PSTOOL="${PSTOOL:-$HOME/Projects/ps/mac/build/pstool}"
FAILED=0

CH="$ROOT/channel"; rm -rf "$CH"; mkdir -p "$CH/updates"
curl -fsS https://cincee.com/client/ps/ps-update.json -o "$CH/ps-update.json" || { echo "cannot reach cincee.com"; exit 1; }
FILE="$(node -e 'const o=require(process.argv[1]);console.log(JSON.parse(Buffer.from(o.signed,"base64")).app.file)' "$CH/ps-update.json")"
curl -fsS "https://cincee.com/client/ps/$FILE" -o "$CH/$FILE"
cp "$HERE/ps-verify.js" "$CH/ps-verify.js"
mk() { rm -rf "$1"; ditto "$CH" "$1"; }
"$PSTOOL" keygen "$ROOT/test.key" > "$ROOT/test.pub"
resign() {   # the note's payload (as it is now) signed with the test key
  node -e 'const o=require(process.argv[1]);process.stdout.write(Buffer.from(o.signed,"base64"))' "$1/ps-update.json" > "$1/p.json"
  "$PSTOOL" sign "$ROOT/test.key" "$1/p.json" "$1/ps-update.json"; rm -f "$1/p.json"
}

run() {   # run <case> <channel> <expect> [VAR=value ...]; expect: installed | left:<text> | STOPPED text
  local name="$1" ch="$2" want="$3"; shift 3
  local D="$ROOT/case-$name" A="${APPNAME:-PS app}.app" L="${LEFT:-PS.app}"
  env PS_INSTALL_TEST="$D" PS_INSTALL_TEST_BASE="file://$ch/" "$@" bash "$HERE/install.sh" > "$D/out.txt" 2>&1; local rc=$?
  chmod -R u+w "$D/Applications" 2>/dev/null
  local good=0 why=""
  case "$want" in
    installed)
      local b; b="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$D/Applications/$A/Contents/Info.plist" 2>/dev/null)"
      [ $rc = 0 ] && grep -qF "OPEN=$D/Applications/$A" "$D/out.txt" && [ "$b" = "$(echo "$FILE" | tr -cd 0-9)" ] \
        && codesign --verify --strict --deep "$D/Applications/$A" 2>/dev/null && [ ! -e "$D/Applications/.PS-installing.app" ] \
        && [ "$(ls "$D/Applications" | wc -l | tr -d ' ')" = 1 ] \
        && [ "$(xattr -r "$D/Applications/$A" 2>/dev/null | grep -c quarantine)" = 0 ] && good=1 ;;
    left:*)
      [ $rc = 0 ] && grep -q "${want#left:}" "$D/out.txt" && [ "$(cat "$D/Applications/$L/marker" 2>/dev/null)" = untouched ] \
        && [ "$(ls "$D/Applications" | wc -l | tr -d ' ')" = 1 ] && good=1 ;;
    *)
      [ $rc != 0 ] && grep -q "STOPPED: .*$want" "$D/out.txt" && [ -z "$(ls -A "$D/Applications")" ] && good=1 ;;
  esac
  if [ $good = 1 ]; then echo "PASS $name ($(grep -E 'STOPPED|already|Done' "$D/out.txt" | head -1 | cut -c1-90))"
  else echo "FAIL $name (rc=$rc)"; sed 's/^/    /' "$D/out.txt"; FAILED=1; fi
}
fresh() { rm -rf "$ROOT/case-$1"; mkdir -p "$ROOT/case-$1/Applications"; }
existing() {   # existing <case> <build> [name]: a stand-in PS of that build (PS's bundle id), marked
  local a="$ROOT/case-$1/Applications/${3:-PS}.app"
  fresh "$1"; mkdir -p "$a/Contents"
  /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $2" -c "Add :CFBundleIdentifier string com.cincee.ps" "$a/Contents/Info.plist" >/dev/null
  echo untouched > "$a/marker"
}

fresh good;  run good "$CH" installed
fresh named; APPNAME="My List - test" run named "$CH" installed PS_INSTALL_NAME="My List - test"
fresh badname; run badname "$CH" "cannot have / or :" PS_INSTALL_NAME="a/b"
existing same 9999999999;  run same "$CH" "left:already installed and up to date"
existing older 2601010000; run older "$CH" "left:Check for Updates"
existing renamed 2601010000 "Old List - test"; LEFT="Old List - test.app" run renamed "$CH" "left:Check for Updates"

mk "$ROOT/ch-badsig"
node -e 'const fs=require("fs"),f=process.argv[1],o=JSON.parse(fs.readFileSync(f));const b=Buffer.from(o.signed,"base64");const i=b.indexOf("\"size\":")+8;b[i]=b[i]===0x31?0x32:0x31;o.signed=b.toString("base64");fs.writeFileSync(f,JSON.stringify(o));' "$ROOT/ch-badsig/ps-update.json"
fresh badsig; run badsig "$ROOT/ch-badsig" "signature is wrong"

mk "$ROOT/ch-otherkey"; resign "$ROOT/ch-otherkey"
fresh otherkey; run otherkey "$ROOT/ch-otherkey" "signature is wrong"

mk "$ROOT/ch-badverifier"; sed -i '' 's/BAD SIGNATURE/OK SIGNATURE/' "$ROOT/ch-badverifier/ps-verify.js"
fresh badverifier; run badverifier "$ROOT/ch-badverifier" "checker is not the expected one"

mk "$ROOT/ch-badzip"; printf '\x00' | dd of="$ROOT/ch-badzip/$FILE" bs=1 seek=4000 conv=notrunc 2>/dev/null
fresh badzip; run badzip "$ROOT/ch-badzip" "SHA-256"

mk "$ROOT/ch-badsize"; printf 'x' >> "$ROOT/ch-badsize/$FILE"
fresh badsize; run badsize "$ROOT/ch-badsize" "wrong size"

NP="$ROOT/ch-notpsapp"; mk "$NP"; mkdir -p "$NP/x"; ditto -x -k "$NP/$FILE" "$NP/x"
codesign --force --deep --sign - "$NP/x/PS.app" 2>/dev/null
rm -f "$NP/$FILE"; ditto -c -k --norsrc --noextattr --noqtn --keepParent "$NP/x/PS.app" "$NP/$FILE"; rm -rf "$NP/x"
node -e 'const fs=require("fs"),c=require("crypto"),[n,z]=process.argv.slice(1),o=JSON.parse(fs.readFileSync(n));const p=JSON.parse(Buffer.from(o.signed,"base64"));const d=fs.readFileSync(z);p.app.size=d.length;p.app.sha256=c.createHash("sha256").update(d).digest("hex");o.signed=Buffer.from(JSON.stringify(p)).toString("base64");fs.writeFileSync(n,JSON.stringify(o));' "$NP/ps-update.json" "$NP/$FILE"
resign "$NP"
fresh notpsapp; run notpsapp "$NP" "not signed with PS's own certificate" PS_INSTALL_TEST_PUB="$(cat "$ROOT/test.pub")"

fresh readonly; chmod 555 "$ROOT/case-readonly/Applications"; run readonly "$CH" "administrator"

[ $FAILED = 0 ] && echo "ALL INSTALL.SH CASES PASSED" || echo "SOME INSTALL.SH CASES FAILED"
exit $FAILED
