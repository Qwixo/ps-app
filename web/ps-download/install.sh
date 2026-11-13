#!/bin/bash
# Installs PS on a Mac:   curl -fsSL https://cincee.com/client/ps/install.sh | bash
#
# Files fetched by curl carry no quarantine flag, so macOS does not stop PS on its first open.
# In return this script checks PS the same way PS checks its own updates, before anything changes:
#   1. ps-update.json must carry a good Ed25519 signature from PS's update key (checked by
#      ps-verify.js, TweetNaCl run by macOS's own JavaScript; its SHA-256 is pinned below);
#   2. the app zip that note names must have exactly the size and SHA-256 written in it;
#   3. PS.app inside must pass codesign against PS's own signing certificate.
# A new install goes into /Applications with one rename, called "PS app" (V1.49; V1.36 called it "To Do List - by Cincee"), or what
# PS_INSTALL_NAME says:   curl -fsSL https://cincee.com/client/ps/install.sh | PS_INSTALL_NAME="My list" bash
# An existing PS (under any name) is never replaced here: it updates itself, which keeps you signed in.
# No sudo. Nothing is touched but the new app's folder in /Applications and a temporary folder.
set -euo pipefail

main() {
  local base="https://cincee.com/client/ps/"
  # V1.58: the developer's update key and certificate, and the G Squad ones (the G Squad build comes from GitHub with
  # its own keys; ps-mac Sources/UpdateCore.swift, UPDATE_GSQUAD_PUBLIC_KEY and PS_CERT_ROOT_GSQUAD).
  local pubs="Pc6Z49PnFmrf7frRS7d+W2RzpI/bR756v10J8b44/eU= caMPQq7AM4+Ol5Ynh9na7pO/BwTsutaFhLuCu9R3bWE="
  local req='identifier "com.cincee.ps" and (certificate root = H"c0e302f2ce304d062a50d6ebdaff97d5f7d4b6e6" or certificate root = H"c0e302f2ce304d062a50d6ebdaff97d5f7d4b6e6")'
  local verify_sha="b23b08a9e4876925c5d6e6827bd8c87b795b07e28c5a9c0914435c1243eb1582"
  apps="/Applications"   # global, like tmp: the exit trap cleans up after main returns
  local proto="=https" test="${PS_INSTALL_TEST:-}"
  # Tests only (ps-download/test-install.sh): a local channel, a fake Applications, a test key.
  if [ -n "$test" ]; then
    base="$PS_INSTALL_TEST_BASE"; apps="$test/Applications"; proto="=https,file"; pubs="${PS_INSTALL_TEST_PUB:-$pubs}"
  fi

  say() { printf '%s\n' "$*"; }
  fail() { printf '\nSTOPPED: %s\nNothing was installed.\n' "$*" >&2; exit 1; }
  get() { curl -fsS --proto "$proto" --retry 2 --connect-timeout 20 --max-time 900 -A "PS installer" "$base$1" -o "$2"; }
  build_of() { /usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$1/Contents/Info.plist" 2>/dev/null || echo 0; }
  # PS already in Applications under any name (people may rename it): found by its bundle id. Names that look
  # like 1Password or Signal are skipped before anything of theirs is read.
  installed_ps() {
    local a n
    for a in "$apps"/*.app; do
      [ -d "$a" ] || continue
      n="$(basename "$a" | tr '[:upper:]' '[:lower:]')"
      case "$n" in *1password*|*signal*|*agilebits*|*whispersystems*) continue ;; esac
      [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$a/Contents/Info.plist" 2>/dev/null)" = com.cincee.ps ] && { echo "$a"; return 0; }
    done
    return 0
  }
  # The name it goes in under, checked like PS checks a name (Sources/AppName.swift).
  appname="$(printf '%s' "${PS_INSTALL_NAME:-PS app}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/\.app$//')"
  [ -n "$appname" ] || fail "the name is empty"
  [ "${#appname}" -le 60 ] || fail "the name is too long (60 characters at most)"
  case "$appname" in */*|*:*) fail "a name cannot have / or : in it" ;; .*) fail "a name cannot start with a dot" ;; esac
  [ "$(printf '%s' "$appname" | tr -d '[:cntrl:]')" = "$appname" ] || fail "a name cannot have tabs, line breaks or hidden characters in it"
  dest="$apps/$appname.app"

  [ "$(uname -s)" = Darwin ] || fail "PS app is a Mac app"
  [ "$(sw_vers -productVersion | cut -d. -f1)" -ge 13 ] || fail "PS app needs macOS 13 or newer"
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ] || fail "PS app needs a Mac with Apple silicon"

  tmp="$(mktemp -d "${TMPDIR:-/tmp}/ps-install.XXXXXX")"
  trap 'rm -rf "$tmp" "$apps/.PS-installing.app"' EXIT

  say "PS app installer"
  say "1/4  Checking the signed release note"
  get ps-update.json "$tmp/note.json" && get ps-verify.js "$tmp/verify.js" || fail "could not reach cincee.com"
  [ "$(shasum -a 256 "$tmp/verify.js" | cut -d' ' -f1)" = "$verify_sha" ] || fail "the signature checker is not the expected one"
  local out build file size sha name pub good=""
  for pub in $pubs; do   # either trusted key; the note must be signed by one of them
    if out="$(osascript -l JavaScript "$tmp/verify.js" "$tmp/note.json" "$pub" 2>&1)"; then good=1; break; fi
  done
  [ -n "$good" ] || fail "the release note's signature is wrong ($(sed 's/.*Error: //; s/ (-[0-9]*)$//' <<<"$out"))"
  { read -r build; read -r file; read -r size; read -r sha; read -r name; } <<<"$out"
  say "     Signature good: ${name:-PS} (build $build)"

  local there; there="$(installed_ps)"
  if [ -n "$there" ]; then
    local have; have="$(build_of "$there")"
    if [ "$have" -ge "$build" ]; then say ""; say "PS app is already installed and up to date. Opening it."
    else say ""; say "PS app is already installed (an older build). Opening it: click PS app > Check for Updates to update and stay signed in."; fi
    [ -n "$test" ] && say "OPEN=$there" || open "$there"
    exit 0
  fi
  [ -e "$dest" ] && fail "there is already something called \"$appname\" in Applications"

  say "2/4  Downloading PS app ($(( size / 1000000 )) MB)"
  get "$file" "$tmp/PS.zip" || fail "the download did not finish"
  [ "$(stat -f %z "$tmp/PS.zip")" = "$size" ] || fail "the download is the wrong size"
  [ "$(shasum -a 256 "$tmp/PS.zip" | cut -d' ' -f1)" = "$sha" ] || fail "the download's SHA-256 does not match the signed note"
  say "     Size and SHA-256 match"

  say "3/4  Checking PS app's code signature"
  ditto -x -k "$tmp/PS.zip" "$tmp/x"
  codesign --verify --strict --deep -R="$req" "$tmp/x/PS.app" 2>/dev/null || fail "PS app is not signed with its own certificate"
  [ "$(build_of "$tmp/x/PS.app")" = "$build" ] || fail "the app is not the build the signed note names"
  say "     Signed and sealed"

  say "4/4  Putting PS app in Applications"
  [ -w "$apps" ] || fail "this Mac account cannot write to Applications (use an administrator account)"
  rm -rf "$apps/.PS-installing.app"
  ditto "$tmp/x/PS.app" "$apps/.PS-installing.app"
  codesign --verify --strict --deep -R="$req" "$apps/.PS-installing.app" 2>/dev/null || fail "the copy in Applications failed the signature check"
  [ -e "$dest" ] && fail "something called \"$appname\" appeared in Applications meanwhile; run this again"
  mv -n "$apps/.PS-installing.app" "$dest"
  [ -e "$apps/.PS-installing.app" ] && fail "something called \"$appname\" appeared in Applications meanwhile; run this again"
  say ""
  say "Done. \"$appname\" is in Applications and opening now."
  say "It asks once for Device Control and Data Access (System Settings > Privacy & Security): turn it on."
  [ -n "$test" ] && say "OPEN=$dest" || open "$dest"
}

main "$@"
