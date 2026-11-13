# PS downloads (31 Oct 2026)

Served from cincee.com/client/ps/ by scripts/postbuild.mjs: unlisted, noindex, linked from no public page.

- `install.sh`: `curl -fsSL https://cincee.com/client/ps/install.sh | bash`. Curl leaves no quarantine
  flag, so macOS never stops PS. It checks the signed ps-update.json (Ed25519, the updater's key), the
  app zip's size and SHA-256, and codesign against PS's certificate, then puts PS in /Applications
  with one rename. An existing PS is left alone (it updates itself). No sudo.
- `ps-verify.js`: the Ed25519 check (TweetNaCl 1.0.3, public domain) run by `osascript -l JavaScript`.
  install.sh pins its SHA-256: after any edit, put the new hash in install.sh (tests/psdownload.test.ts fails until you do).
- `download/`: the page cincee.com/client/ps/download/ (Download button, the Terminal line, the Open
  Anyway steps drawn for macOS 27.2, optional PS Middle Clicker once `MIDDLE` in download.js is set).
  Its words are public copy: the developer approves the exact text before it is released.

GATE (default OFF): postbuild.mjs deploys install.sh, ps-verify.js and download/ only when
ps-download/approved.json holds the SHA-256 of exactly these files. `node scripts/ps-download.mjs show`
prints the files and hash (show the developer the words), `approve <hash>` only after his yes, `revoke` to undo.
Any edit after approval switches it off again. install.sh prints words in Terminal, so it is gated too.

Tests: `node --experimental-strip-types tests/psdownload.test.ts` and `bash ps-download/test-install.sh <empty folder>`
(the live release in a local channel, ten cases including every tamper case, fake Applications, opens nothing).
