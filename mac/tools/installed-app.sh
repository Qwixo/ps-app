# Where PS is installed (V1.36: people may rename it, Sources/AppName.swift). Source this file, then
#   ps_installed_app [Applications folder]
# prints the PS found straight in that folder (default /Applications) by its bundle id com.cincee.ps, under any
# name; /Applications/PS.app first when it is PS (the developer's Macs), and <folder>/PS.app when there is none, as before.
# 1Password and Signal (and anything named like them) are skipped by name before anything of theirs is read.
# Used by build.sh, release/direct-install.sh, tests/reboot-signing-check.sh and web scripts/release.sh.
ps_installed_app() {
  local apps="${1:-/Applications}" a n
  _ps_is_ps() { [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist" 2>/dev/null)" = com.cincee.ps ]; }
  if [ -d "$apps/PS.app" ] && _ps_is_ps "$apps/PS.app"; then echo "$apps/PS.app"; return 0; fi
  for a in "$apps"/*.app; do
    [ -d "$a" ] || continue
    n="$(basename "$a" | tr '[:upper:]' '[:lower:]')"
    case "$n" in *1password*|*signal*|*agilebits*|*whispersystems*) continue ;; esac
    if _ps_is_ps "$a"; then echo "$a"; return 0; fi
  done
  echo "$apps/PS.app"
}
