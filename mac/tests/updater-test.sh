#!/bin/bash
# Self tests for the installer and updater (Sources/UpdaterSelfTest.swift), run on test copies only.
# channel     the same app update through the channel code (a file:// folder, offline).
# Needs a built test copy first:
#   (cd ~/Projects/ps/web && npm run build:ps) && NO_INSTALL=1 SKIP_WEB=1 bash build.sh
#   bash tests/updater-test.sh <empty folder> [areas]      areas: upanim update rollback webupdate install release
#                                                           settingsui settingsupdate (the gear menu, 31 Oct 2026)
#                                                           nohandover oldtonew oldbug (the last two need PS_TEST_OLDAPP)
#                                                           rename installover (V1.36, the app's name)
#                                                           signedoutupdate (V1.37, the card when signed out)
#                                                           updatepopup (V1.40, the pop-up signed in; PS_SELFTEST_RED=0 or 1)
# nohandover  a healthy new build that never takes the sign in is kept (never rolled back).
# lockedupdate  a PS locked with Touch ID updates and stays locked.
# pidminus1 macOS reporting pid -1 is "not known yet": nothing is ever signalled (stay, and roll back).
# lslaunch  the new build started through macOS (NSWorkspace) with real launch timing, nothing remembered.
# signals   the stop path with pids -1, 0, 1, itself and a non-PS process: no signal (send stubbed, no app launched).
# hang      a new build that never gets healthy is stopped before the old one comes back (one PS at a time).  touchid  Lock and Touch ID unlock (fake).
# PS_TEST_OLDAPP=<PS.app built from commit cb94b5c> (the build the developer had on 27 Oct, 2610270059):
#   oldtonew  that build installed updates to this one (its own helper, this build answers);
#   oldbug    this build's helper, started the way a real launch reports back, with the cb94b5c
#             build as the NEW side: must show the 27 Oct failure ("the helper sent nothing"), proving the
#             test reproduces it.
# Everything happens in <folder>: a fake Applications folder, a fake Drive folder, a TEST signing key,
# FICTIONAL sign in data. Never /Applications, never the developer's Drive, never the Keychain items of PS.
# Each test copy takes the shared lock /tmp/ps-selftest.lock itself; this waits while another runs.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${1:?usage: updater-test.sh <empty folder> [areas]}"; shift
AREAS="${*:-upanim update rollback webupdate install move release}"
OLDAPP="${PS_TEST_OLDAPP:-}"
APP="${PS_TEST_APP:-$HERE/build/PS.app}"   # PS_TEST_APP: a test copy built elsewhere (PS_APP_OUT)
WEB="${PS_TEST_WEB:-$HERE/../web/dist-ps}"
SIGN="${PS_SIGNING_DIR:-$HERE/signing}"   # a worktree reads the main checkout's signing folder where it is (never a copy)
# V1.36, the app's name (Sources/AppName.swift). PS_TEST_NAME: what the installed copy in the fake Applications
# folder is called (default PS). With a name, update, webupdate and rename run the INSTALLED copy itself, as on a
# real Mac, so the update has to follow the folder it really runs from and keep its name.
INAME="${PS_TEST_NAME:-PS}"
RENAME_TO="${PS_TEST_RENAME_TO:-My Tasks}"
mkdir -p "$HERE/build"
KC="$SIGN/ps-signing.keychain-db"; ID=C0E302F2CE304D062A50D6EBDAFF97D5F7D4B6E6
TOOL="$HERE/build/pstool"
[ -x "$APP/Contents/MacOS/PS" ] || { echo "build the test copy first (NO_INSTALL=1 bash build.sh)"; exit 1; }
[ -f "$APP/Contents/Resources/update.html" ] || { echo "the test copy has no update.html: rebuild it"; exit 1; }
mkdir -p "$ROOT"; ROOT="$(cd "$ROOT" && pwd)"
case "$ROOT" in /Applications*) echo "never in /Applications"; exit 1;; esac
swiftc -O "$HERE/tools/pstool.swift" -o "$TOOL" 2>/dev/null
security unlock-keychain -p "$(cat "$SIGN/.keychain-pass")" "$KC"
NEW="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist")"
OLD=2601010000
NEWWEB="$(node -e 'process.stdout.write(require(process.argv[1]).built)' "$WEB/version.json")"
NEWSRC="$(node -e 'process.stdout.write(require(process.argv[1]).src)' "$WEB/version.json")"

resign() { codesign --force --deep --options runtime --entitlements "$HERE/ps.entitlements" --keychain "$KC" --sign "$ID" --identifier com.cincee.ps "$1" 2>/dev/null; }
qtn() { xattr -w com.apple.quarantine "0083;00000000;Chrome;" "$1"; }

# note <key> <out> <kind> <app json> <web built> <web src> <web file> <drive>
note() {
  local f="$8/$7"
  node -e '
    const [kind, app, src, built, file, size, sha] = process.argv.slice(1);
    const p = { format: 1, kind, made: new Date().toISOString(), app: JSON.parse(app), web: { src, built, file, size: Number(size), sha256: sha } };
    if (!p.app) delete p.app; p.name = "V1.08"; p.keyword = "Abundance"; p.notes = ["Fictional note one.", "Fictional note two."]; process.stdout.write(JSON.stringify(p));' "$3" "$4" "$6" "$5" "$7" "$(stat -f %z "$f")" "$("$TOOL" sha256 "$f")" > "$2.payload"
  "$TOOL" sign "$1" "$2.payload" "$2"; rm -f "$2.payload"
}

prep() {   # prep <dir> <kind> [installed app] [update app]: everything one area needs
  local D="$1" INST="${3:-$APP}" UPD="${4:-$APP}"
  rm -rf "$D"; mkdir -p "$D/Applications" "$D/drive/updates" "$D/bad/tampered/updates" "$D/support"
  "$TOOL" keygen "$D/test.key" > "$D/test.pub"
  # The installed "old" build: the same code, build number OLD, signed again with the developer's certificate.
  ditto "$INST" "$D/Applications/$INAME.app"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $OLD" "$D/Applications/$INAME.app/Contents/Info.plist"
  resign "$D/Applications/$INAME.app"
  # The old web files (a different version, and a marker in index.html).
  ditto "$WEB" "$D/web"
  printf '{"src":"0000000000000000","built":"2026-01-01T00:00:00.000Z"}' > "$D/web/version.json"; printf '{"version":"1.00","keyword":"Beginnings"}\n' > "$D/web/ps-version.json"
  printf '\n<!-- old test build -->\n' >> "$D/web/index.html"
  # The update files, as Drive would hold them (the zip itself carries a quarantine flag, and one
  # file inside it too).
  local SRCAPP="$D/src/PS.app"; mkdir -p "$D/src"; ditto "$UPD" "$SRCAPP"
  if [ "$UPD" != "$APP" ]; then /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $NEW" "$SRCAPP/Contents/Info.plist"; resign "$SRCAPP"; fi
  qtn "$SRCAPP/Contents/Resources/ip-country.bin"
  (cd "$D/src" && ditto -c -k --keepParent PS.app "$D/drive/updates/PS-app-$NEW.zip")
  # The web files carry the version the developer sees (ps-version.json), as release.sh writes it.
  ditto "$WEB" "$D/webnew"; printf '{"version":"1.08","name":"V1.08","keyword":"Abundance"}\n' > "$D/webnew/ps-version.json"
  (cd "$D/webnew" && ditto -c -k --norsrc --noextattr . "$D/drive/updates/PS-web-1.zip")
  qtn "$D/drive/updates/PS-app-$NEW.zip"
  local APPJSON="{\"build\":$NEW,\"file\":\"updates/PS-app-$NEW.zip\",\"size\":$(stat -f %z "$D/drive/updates/PS-app-$NEW.zip"),\"sha256\":\"$("$TOOL" sha256 "$D/drive/updates/PS-app-$NEW.zip")\"}"
  if [ "$2" = web ]; then APPJSON="{\"build\":$OLD,\"file\":\"updates/PS-app-$NEW.zip\",\"size\":$(stat -f %z "$D/drive/updates/PS-app-$NEW.zip"),\"sha256\":\"$("$TOOL" sha256 "$D/drive/updates/PS-app-$NEW.zip")\"}"; fi
  note "$D/test.key" "$D/drive/ps-update.json" "$2" "$APPJSON" "$NEWWEB" "$NEWSRC" "updates/PS-web-1.zip" "$D/drive"
  # Things PS must refuse.
  "$TOOL" keygen "$D/other.key" >/dev/null
  note "$D/other.key" "$D/bad/bad-sig.json" app "$APPJSON" "$NEWWEB" "$NEWSRC" "updates/PS-web-1.zip" "$D/drive"
  note "$D/test.key" "$D/bad/older.json" app "{\"build\":$((OLD - 100)),\"file\":\"updates/PS-app-$NEW.zip\",\"size\":1,\"sha256\":\"$(printf '0%.0s' {1..64})\"}" "2025-01-01T00:00:00.000Z" "older" "updates/PS-web-1.zip" "$D/drive"
  cp "$D/drive/updates/PS-app-$NEW.zip" "$D/bad/tampered/updates/"
  node -e 'const fs=require("fs");const f=process.argv[1];const b=fs.readFileSync(f);b[Math.floor(b.length/2)]^=0xff;fs.writeFileSync(f,b)' "$D/bad/tampered/updates/PS-app-$NEW.zip"
  mkdir -p "$D/bad/adhoc" "$D/bad/modified"
  ditto "$APP" "$D/bad/adhoc/PS.app"; codesign --force --deep --sign - --identifier com.cincee.ps "$D/bad/adhoc/PS.app" 2>/dev/null
  ditto "$APP" "$D/bad/modified/PS.app"; printf 'x' >> "$D/bad/modified/PS.app/Contents/Resources/ip-country.bin"
  # FICTIONAL sign in data for the hand over (never a real Keychain item).
  # Second Computer's items go over too (2 Nov 2026): a FICTIONAL device key, id and pairing list.
  node -e 'const c=require("crypto"),b=(x)=>Buffer.from(x).toString("base64");process.stdout.write(JSON.stringify({remember:b("FICTIONAL remember me "+c.randomUUID()),netmon:c.randomBytes(32).toString("base64"),second:{key:c.randomBytes(32).toString("base64"),device:b(c.randomUUID()),trust:b(JSON.stringify([{device:"fictional-m4",name:"Fictional M4",pub:"P",role:"primary",at:1}]))}}))' > "$D/handoff.json"
}

PSLOG="$HOME/Library/Logs/PS/ps.log"
run() {   # run <dir> <area> <binary> [VAR=value ...]
  local D="$1" AREA="$2" BIN="$3"; shift 3
  local logStart; logStart=$(( $(wc -l < "$PSLOG" 2>/dev/null || echo 0) + 1 ))
  for try in $(seq 1 60); do
    env PS_SELFTEST="$D" PS_SELFTEST_ONLY="$AREA" PS_SELFTEST_WEB="$D/web" "$@" "$BIN" > "$D/out.log" 2>&1
    local rc=$?
    if [ $rc -eq 3 ] && grep -q "another test copy is running" "$D/out.log"; then echo "  (another test copy is running, waiting)"; sleep 20; continue; fi
    break
  done
  grep -E "CHECK:|REFUSALS:|ANIMATIONS:|=ok|=FAIL|frame pacing|TOTAL|SCREEN CHECK|NETWORK CHECK|CHILD:|helper:" "$D/out.log" | grep -v "^BRIDGE" | sed 's/^/  /'
  grep -q "UPDATER TOTAL: 0 FAIL" "$D/out.log" && echo "  -> $AREA passed" || { echo "  -> $AREA FAILED (log: $D/out.log)"; FAILED=1; }
  # Every signal a test copy sent or refused in this area (SafeSignal logs each one).
  { tail -n +"$logStart" "$PSLOG" 2>/dev/null; cat "$D/out.log"; } | grep -a "PS signal:" | sort -u | sed 's/^/  SIGNAL LOG: /'
}

# The binary an area runs: the test copy, or (PS_TEST_NAME set) the installed copy in the fake Applications folder.
bin() { if [ -n "${PS_TEST_NAME:-}" ]; then echo "$1/Applications/$INAME.app/Contents/MacOS/PS"; else echo "$APP/Contents/MacOS/PS"; fi; }

FAILED=0
for AREA in $AREAS; do
  D="$ROOT/$AREA"; echo "== $AREA"
  case "$AREA" in
    upanim) rm -rf "$D"; mkdir -p "$D"; run "$D" upanim "$APP/Contents/MacOS/PS" ;;
    update|rollback)
      prep "$D" app
      extra=(); [ "$AREA" = rollback ] && extra=(PS_SELFTEST_CHILD_FAIL=1)
      # The update area starts the new build the way a real launch reports back (SYNCLAUNCH).
      [ "$AREA" = update ] && extra=(PS_SELFTEST_SYNCLAUNCH=1)
      run "$D" "$AREA" "$(bin "$D")" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_DRIVE="$D/drive" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_BAD="$D/bad" PS_SELFTEST_NEWWEB="$NEWWEB" \
        PS_SELFTEST_DRIVEWAIT=1.6 PS_SELFTEST_SLOWREAD=2500000 PS_SELFTEST_EXPECT_INSTALLED="$INAME.app" ${extra[@]+"${extra[@]}"} ;;
    channel)
      # The cincee.com channel (27 Oct 2026, public PS): the same app update, but PS downloads the
      # signed note and the files from a channel (here a file:// folder, a test copy never goes
      # online) into its own mirror first, then installs from there.
      prep "$D" app
      run "$D" update "$APP/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_CHANNEL="file://$D/drive/" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_BAD="$D/bad" PS_SELFTEST_NEWWEB="$NEWWEB" PS_SELFTEST_SYNCLAUNCH=1 \
        PS_SELFTEST_SLOWREAD=2500000
      [ -f "$D/support/update/channel/ps-update.json" ] && echo "  -> the note came through the channel mirror" || { echo "  -> no channel mirror: FAILED"; FAILED=1; } ;;
    settingsui)
      # Every state of the update row in the Tab list's gear menu (FICTIONAL versions), real clicks, pictures.
      rm -rf "$D"; mkdir -p "$D"; ditto "$WEB" "$D/web"
      run "$D" settingsui "$APP/Contents/MacOS/PS" ;;
    settingsupdate)
      # A real update through the gear menu: an older build in a fake Applications folder takes this
      # one from the channel code (a file:// folder, offline), waits for "Relaunch to finish", then swaps.
      prep "$D" app
      run "$D" settingsupdate "$APP/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_CHANNEL="file://$D/drive/" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_BAD="$D/bad" PS_SELFTEST_NEWWEB="$NEWWEB" PS_SELFTEST_SYNCLAUNCH=1 \
        PS_SELFTEST_SLOWREAD=2500000
      [ -f "$D/support/update/channel/ps-update.json" ] && echo "  -> the note came through the channel mirror" || { echo "  -> no channel mirror: FAILED"; FAILED=1; } ;;
    signedoutupdate)
      # Someone else's PS, never signed in: the card offers the update (no gear to see), and it moves to the
      # gear once the vault opens (7 Nov 2026).
      prep "$D" app
      run "$D" settingsupdate "$APP/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_CHANNEL="file://$D/drive/" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_BAD="$D/bad" PS_SELFTEST_NEWWEB="$NEWWEB" PS_SELFTEST_SYNCLAUNCH=1 \
        PS_SELFTEST_RED=0 PS_SELFTEST_SIGNEDOUT=1 ;;
    updatepopup)
      # V1.40, signed in: the update pops up by itself once (version, notes, Update now, Later), waits for Do Not
      # Disturb, steps aside for 1Password or Signal, Later is a day then once more, then the setup offer after an
      # update. PS_SELFTEST_RED=1 (default) is the developer's PS, =0 someone else's.
      prep "$D" app
      run "$D" updatepopup "$APP/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_CHANNEL="file://$D/drive/" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_NEWWEB="$NEWWEB" PS_SELFTEST_RED="${PS_SELFTEST_RED:-1}" ;;
    pidminus1)
      # macOS reports pid -1 for a build that is not shown (27 Oct 2026 incident): it must count as
      # "not known yet", never as a pid. A: a good new build stays (no signal at all). B: a new build
      # that quits at once is rolled back with nothing signalled.
      prep "$D" app
      node -e 'const c=require("crypto");process.stdout.write(JSON.stringify({netmon:c.randomBytes(32).toString("base64")}))' > "$D/handoff.json"
      run "$D" update "$APP/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_DRIVE="$D/drive" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_NEWWEB="$NEWWEB" PS_SELFTEST_LSLAUNCH=1 PS_SELFTEST_CHECKIN_DELAY=2 \
        PS_SELFTEST_DRIVEWAIT=1.6 PS_SELFTEST_SLOWREAD=2500000
      grep -aq "macOS reported pid -1\|macOS reported pid 0" "$D/out.log" && echo "  -> A: macOS reported pid -1, treated as not known" || echo "  -> A: (macOS gave a real pid this time)"
      grep -aq "PS signal: sent" "$D/out.log" && { echo "  -> A: A SIGNAL WAS SENT"; FAILED=1; } || echo "  -> A: no signal sent"
      [ ! -e "$D/child-restored.txt" ] && [ ! -e "$D/child-new-refused" ] && echo "  -> A: one PS, no roll back" || { echo "  -> A: roll back or second PS"; FAILED=1; }
      D2="$D-b"; prep "$D2" app
      run "$D2" rollback "$APP/Contents/MacOS/PS" PS_SELFTEST_APPS="$D2/Applications" PS_SELFTEST_DRIVE="$D2/drive" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D2/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D2/handoff.json" PS_SELFTEST_NEWWEB="$NEWWEB" PS_SELFTEST_LSLAUNCH=1 PS_SELFTEST_CHILD_FAIL=1 \
        PS_SELFTEST_DRIVEWAIT=1.6 PS_SELFTEST_SLOWREAD=2500000
      grep -aq "PS signal: sent" "$D2/out.log" && { echo "  -> B: A SIGNAL WAS SENT"; FAILED=1; } || echo "  -> B: rolled back, no signal sent" ;;
    lslaunch)
      # The developer's real timing: the new build started through macOS (NSWorkspace, like the developer's PS), which
      # reports it only after it finished launching (2 s here), while the hand over is done at once.
      # And the developer's state on 27 Oct: nothing remembered (remember=0). Must stay, never roll back.
      prep "$D" app
      node -e 'const c=require("crypto");process.stdout.write(JSON.stringify({netmon:c.randomBytes(32).toString("base64")}))' > "$D/handoff.json"
      run "$D" update "$APP/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_DRIVE="$D/drive" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_NEWWEB="$NEWWEB" PS_SELFTEST_LSLAUNCH=1 PS_SELFTEST_CHECKIN_DELAY=2 \
        PS_SELFTEST_DRIVEWAIT=1.6 PS_SELFTEST_SLOWREAD=2500000
      [ ! -e "$D/child-new-refused" ] && [ ! -e "$D/child-restored.txt" ] && echo "  -> one PS, no roll back" || { echo "  -> a second PS or a roll back"; FAILED=1; } ;;
    hang)
      # A new build that starts but never gets healthy: it must be stopped BEFORE the old one comes
      # back (never two PS at once), through macOS's launch like the developer's.
      prep "$D" app
      run "$D" rollback "$APP/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_DRIVE="$D/drive" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_NEWWEB="$NEWWEB" PS_SELFTEST_LSLAUNCH=1 \
        PS_SELFTEST_CHILD_HANG=1 PS_SELFTEST_HEALTHWAIT=3 PS_SELFTEST_DRIVEWAIT=1.6 PS_SELFTEST_SLOWREAD=2500000
      if [ -e "$D/child-two-at-once" ] || [ -e "$D/child-restored-refused" ]; then echo "  -> TWO PS AT ONCE"; FAILED=1
      elif [ -e "$D/child-restored.txt" ]; then echo "  -> the hung build was stopped before the old one came back"; else echo "  -> the old build did not come back"; FAILED=1; fi
      # Still running? Only that pid, only if it runs the test copy's own executable (never anything else).
      p="$(cat "$D/child-new.pid" 2>/dev/null)"; want="$(realpath "$D/Applications/$INAME.app/Contents/MacOS/PS" 2>/dev/null)"
      if [[ "$p" =~ ^[0-9]+$ ]] && [ "$p" -gt 1 ] && [ "$(realpath "$(ps -p "$p" -o comm= 2>/dev/null)" 2>/dev/null)" = "$want" ]; then
        echo "  -> the hung build is still running"; kill -TERM "$p"; FAILED=1
      fi ;;
    lockedupdate)
      # PS locked with Touch ID updates: the locked item goes over (and stays locked), never the silent one.
      prep "$D" app
      node -e 'const c=require("crypto");process.stdout.write(JSON.stringify({locked:Buffer.from("FICTIONAL locked "+c.randomUUID()).toString("base64"),netmon:c.randomBytes(32).toString("base64")}))' > "$D/handoff.json"
      run "$D" update "$APP/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_DRIVE="$D/drive" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_NEWWEB="$NEWWEB" PS_SELFTEST_SYNCLAUNCH=1 \
        PS_SELFTEST_DRIVEWAIT=1.6 PS_SELFTEST_SLOWREAD=2500000 ;;
    touchid) rm -rf "$D"; mkdir -p "$D"; ditto "$WEB" "$D/web"; run "$D" touchid "$APP/Contents/MacOS/PS" ;;
    signals) rm -rf "$D"; mkdir -p "$D"; ditto "$WEB" "$D/web"; run "$D" signals "$APP/Contents/MacOS/PS" ;;
    nohandover)
      # A healthy new build that never takes the sign in: must stay, never be rolled back.
      prep "$D" app
      run "$D" update "$APP/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_DRIVE="$D/drive" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_NEWWEB="$NEWWEB" PS_SELFTEST_CHILD_NOHANDOVER=1 PS_SELFTEST_SYNCLAUNCH=1 \
        PS_SELFTEST_DRIVEWAIT=1.6 PS_SELFTEST_SLOWREAD=2500000 ;;
    oldtonew)
      # The build the developer had (commit cb94b5c) installed, running and updating: its own updater and helper.
      [ -x "$OLDAPP/Contents/MacOS/PS" ] || { echo "  PS_TEST_OLDAPP not set"; FAILED=1; continue; }
      prep "$D" app "$OLDAPP"
      run "$D" update "$D/Applications/$INAME.app/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_DRIVE="$D/drive" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_BAD="$D/bad" PS_SELFTEST_NEWWEB="$NEWWEB" \
        PS_SELFTEST_DRIVEWAIT=1.6 PS_SELFTEST_SLOWREAD=2500000
      grep -q "CHILD: new build $NEW" "$D/out.log" && grep -q "sign in handed over from build $OLD" "$D/out.log" \
        && echo "  -> the new build took the old build's hand over" || { echo "  -> no hand over from the old build"; FAILED=1; } ;;
    oldbug)
      [ -x "$OLDAPP/Contents/MacOS/PS" ] || { echo "  PS_TEST_OLDAPP not set"; FAILED=1; continue; }
      prep "$D" app "$APP" "$OLDAPP"
      saved=$FAILED
      run "$D" update "$APP/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_DRIVE="$D/drive" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_NEWWEB="$NEWWEB" PS_SELFTEST_SYNCLAUNCH=1 >/dev/null
      FAILED=$saved
      # Live, the old build's new PS keeps running, so the helper then refuses the dead call ("no peer
      # token") and rolls back; a test child exits instead. The cause is the same line on both:
      grep -q "PS update: the helper sent nothing" "$D/out.log" \
        && echo "  -> reproduced the 27 Oct failure with the old build answering (the helper sent nothing)" || { echo "  -> did not reproduce the 27 Oct failure"; grep -E "helper|hand over" "$D/out.log" | sed 's/^/     /'; FAILED=1; } ;;
    release)
      # The real release script and the real update key, into a fake Drive folder: PS (with its
      # built in public key, no test key) must take the update from it.
      prep "$D" app
      rm -rf "$D/drive"; mkdir -p "$D/drive"
      # The web files as release.sh leaves them (its ps-version.json), with the test version.
      ditto "$WEB" "$D/relweb"; printf '{"version":"1.08","name":"V1.08","keyword":"Abundance"}\n' > "$D/relweb/ps-version.json"
      PS_RELEASE_DRIVE="$D/drive" bash "$HERE/release/publish.sh" app "$D/relweb" "$APP" | sed 's/^/  /'
      run "$D" update "$APP/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_DRIVE="$D/drive" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_HANDOFF="$D/handoff.json" PS_SELFTEST_NEWWEB="$NEWWEB" PS_SELFTEST_DRIVEWAIT=1.6 PS_SELFTEST_SLOWREAD=2500000 ;;
    webupdate)
      prep "$D" web
      run "$D" webupdate "$(bin "$D")" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_DRIVE="$D/drive" PS_SELFTEST_UPDATE_PUBKEY="$(cat "$D/test.pub")" \
        PS_SELFTEST_MYBUILD=$OLD PS_SELFTEST_BAD="$D/bad" PS_SELFTEST_NEWWEB="$NEWWEB"
      [ -d "$D/Applications/$INAME.app" ] && echo "  -> the app kept its name ($INAME)" || { echo "  -> the app lost its name"; FAILED=1; } ;;
    install)
      rm -rf "$D"; mkdir -p "$D/stage/.ps-payload/backgrounds" "$D/Applications" "$D/web"
      ditto "$APP" "$D/stage/PS.app"; qtn "$D/stage/PS.app/Contents/Resources/ip-country.bin"
      head -c 2000000 /dev/urandom > "$D/stage/.ps-payload/backgrounds/test-clip.mp4"
      printf '{"id":"test-clip","name":"Test clip","source":"Test clip.mp4","size":1,"mtime":1}' > "$D/stage/.ps-payload/backgrounds/test-clip.json"
      hdiutil create -quiet -volname PS-test -srcfolder "$D/stage" -fs HFS+ -format UDZO -ov "$D/PS-test.dmg"
      mkdir -p "$D/vol"; hdiutil attach -quiet -nobrowse -readonly -noautoopen -mountpoint "$D/vol" "$D/PS-test.dmg"
      # V1.36: the name field. "Taken" is a plain folder that is not PS (must be refused); the name typed has spaces and a hyphen.
      mkdir -p "$D/Applications/Taken.app"
      run "$D" install "$D/vol/PS.app/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_WEB="$D/web" PS_SELFTEST_BGCOUNT=1 \
        PS_SELFTEST_INSTALL_NAME="${PS_TEST_INSTALL_NAME:-My Tasks - test}"
      hdiutil detach -quiet "$D/vol" || hdiutil detach -quiet -force "$D/vol" ;;
    installover)
      # V1.36: a PS already installed under another name ("Old List - test"). The field starts with that name; a new
      # name is typed, the new copy goes in under it and the old one leaves Applications: one PS there afterwards.
      rm -rf "$D"; mkdir -p "$D/stage/.ps-payload/backgrounds" "$D/Applications/Taken.app" "$D/web"
      ditto "$APP" "$D/Applications/Old List - test.app"
      /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $OLD" "$D/Applications/Old List - test.app/Contents/Info.plist"; resign "$D/Applications/Old List - test.app"
      ditto "$APP" "$D/stage/PS.app"
      hdiutil create -quiet -volname PS-test -srcfolder "$D/stage" -fs HFS+ -format UDZO -ov "$D/PS-test.dmg"
      mkdir -p "$D/vol"; hdiutil attach -quiet -nobrowse -readonly -noautoopen -mountpoint "$D/vol" "$D/PS-test.dmg"
      run "$D" install "$D/vol/PS.app/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_WEB="$D/web" PS_SELFTEST_BGCOUNT=0 \
        PS_SELFTEST_EXPECT_PREFILL="Old List - test" PS_SELFTEST_INSTALL_NAME="New List - test"
      hdiutil detach -quiet "$D/vol" || hdiutil detach -quiet -force "$D/vol"
      ls "$D/support/update/previous" 2>/dev/null | grep -q '^PS-renamed-before-' && echo "  -> the old copy was kept in the update folder" || { echo "  -> the old copy was not kept"; FAILED=1; } ;;
    move)
      # (area move) PS opened from a plain folder (Downloads): "Move PS to Applications", the old copy to the test's trash.
      rm -rf "$D"; mkdir -p "$D/Downloads" "$D/Applications" "$D/web"
      ditto "$APP" "$D/Downloads/PS.app"
      run "$D" move "$D/Downloads/PS.app/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_WEB="$D/web" PS_SELFTEST_BGCOUNT=0 ;;
    rename)
      # V1.36: Settings > Mac settings > App name, on the INSTALLED copy in a fake Applications folder ($INAME.app,
      # default PS) renamed to $RENAME_TO with real clicks. "Taken" is a plain folder that is not PS (refused).
      rm -rf "$D"; mkdir -p "$D/Applications/Taken.app"; ditto "$WEB" "$D/web"
      ditto "$APP" "$D/Applications/$INAME.app"
      run "$D" rename "$D/Applications/$INAME.app/Contents/MacOS/PS" PS_SELFTEST_APPS="$D/Applications" PS_SELFTEST_RENAME_TO="$RENAME_TO"
      ls "$D/Applications" | sed 's/^/  now in Applications: /' ;;
  esac
done
[ "$FAILED" = 0 ] && echo "ALL UPDATER AREAS PASSED" || echo "SOME UPDATER AREAS FAILED"
exit "$FAILED"
