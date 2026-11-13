# PS GOS: building, releasing, signing

## Where things are

| What | Where |
| --- | --- |
| Native shell (Kotlin) | `~/Projects/ps/phone/app/src/main/java/com/cincee/ps/gos/` |
| Web code (shared with the website and PS on the Mac) | `~/Projects/ps/web/src`, phone layer in `src/gos/` |
| Web build for the phone | `vite build --mode gos` into `web/dist-gos`, copied into the APK by `scripts/build-web.sh` |
| Release signing key | `~/.ps-gos-signing/ps-gos-release.jks` and `keystore.properties` (passwords, certificate SHA-256). OUTSIDE git. |
| Release files | `~/Projects/ps/phone/release/` (gitignored), staged in `web/gos-release/` (gitignored) |
| Update path on the web | `https://cincee.com/client/gos/version.json` and `ps-gos-<version>.apk`: unlisted, `X-Robots-Tag: noindex`, in no sitemap, linked from nowhere |
| First install copy | Google Drive `YOUR_SYNC_FOLDER/PS App/GOS/ps-gos-<version>.apk` |
| Package names | release `com.cincee.ps.gos`, debug `com.cincee.ps.gos.debug` (they can sit side by side) |

## The signing key: BACK IT UP

Every update must be signed with the same key, or GrapheneOS refuses to install it over the app on
The developer's phone (and the app's own updater refuses it before that). If the key is lost, the only way
forward is to uninstall PS GOS and install a new one, which loses its Keystore keys (fingerprint
sign in) and its settings on the phone. The vault itself is safe either way (it lives in Supabase,
encrypted).

Back up the whole folder `~/.ps-gos-signing/` somewhere private and offline (an encrypted USB stick,
or your own password manager). Never in git, never on a public site. Certificate SHA-256:
`65d6c41608540dc3c03b9fdf776ae7df54a4c9a4c86d0f06a7b81d6639cb4093`.

## Commands

```bash
# debug build with fictional test data, for the emulator only
./scripts/build-web.sh --fake && ./gradlew assembleDebug

# a release (bumps the version, real web build, refuses test data, signs, checks the signer,
# writes version.json, stages it for the website and copies the APK to Google Drive)
./scripts/release.sh "What changed, in plain words"
```

`release.sh` deploys nothing. The next `npm run release` in `~/Projects/ps/web` (the
manager runs it) publishes `cincee.com/client/gos/` along with the website: `scripts/postbuild.mjs`
copies `gos-release/` into `dist/client/gos/` and adds noindex headers for that path.

## How an update reaches the phone

1. Once a day (from the background check) and whenever the developer taps Check in PS > Phone settings, PS
   reads `version.json` (on Netlify, so no Supabase egress).
2. Newer: a card "PS GOS x is ready" (and one quiet notification).
3. Download and install: download with live progress, then the SHA-256 must match `version.json`,
   the APK must be `com.cincee.ps.gos`, newer, and signed by exactly the certificate above (pinned
   in the app and equal to the installed app's). Anything else is thrown away with a plain message.
4. GrapheneOS shows one "Update this app?" tap. PS closes for a moment and comes back.

## Toolchain (installed 27 Oct 2026, Homebrew, no admin)

- `openjdk@21` (use `JAVA_HOME=/opt/homebrew/opt/openjdk@21`), `gradle` (wrapper 9.8.2 in the repo)
- `android-commandlinetools` cask, SDK root `/opt/homebrew/share/android-commandlinetools`:
  platform-tools, emulator, platforms android-36 and android-37.0, build-tools 36.1.0,
  system image android-36 default arm64 (plain AOSP, no Google APIs, closest to GrapheneOS)
- Emulator `ps-gos-pixel` (Pixel 9a profile: 1080 x 2424 at 420 dpi, the same screen as a 10a).
  Run it with no window, no audio and DNS pointed at localhost so it never reaches the internet:
  `emulator -avd ps-gos-pixel -no-window -no-audio -dns-server 127.0.0.1 -port 5580`
