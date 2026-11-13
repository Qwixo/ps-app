# PS on macOS 27.2: short report (27 Oct 2026)

Both of the developer's Macs (M4 and M1) run macOS 27.2 on Apple Silicon. Full notes with every file and
line: side session notes, `macos27-audit.md`. This is the short version, then what was fixed.

## What we found

1. **Compiling.** PS is already built against the macOS 27 SDK, so every new AppKit and WebKit
   behaviour already applies. The 15 warnings are old Keychain calls (no replacement that keeps
   prompts off) and test code. Raising the target from 13 gains nothing today and breaks one
   self test line (an old screen capture call). Decision: **keep 13 for now**; move to 26 (not 27)
   together with the follow ups below.
2. **Energy.** About 8 to 10 wake ups a second while idle: a 4 per second keyboard watchdog
   heartbeat, three 1 second timers that run even when their feature is off (AFK, Are you sure,
   mixer), several timers with no tolerance, and CSS stripes and glows that repaint for hours.
   App Nap is off while the vault is open (on purpose since 17 Oct, keep it).
3. **Permissions.** Accessibility is called **"Device Control and Data Access"** on 27.2 (checked
   in System Settings' own strings). The mixer needs **"Screen & System Audio Recording"**, section
   "System Audio Recording Only". The Settings links PS uses still work. PS needs nothing else.
   An updater that replaces PS.app might be asked about **App Management** (no Apple team ID).
4. **Screen capture.** Hiding the meeting notes card from capture still works on 27.2
   (ScreenCaptureKit leaves it out). The Tab list and meeting cards are not hidden from capture.
5. **Process taps (mixer).** Current APIs, nothing deprecated.
6. **Glass.** The Tab list's `.hudWindow` blur is current. New glass views exist but suit small
   rounded cards, not a full screen backdrop. Nothing to change.
7. **Animation pacing.** Two native timers should follow the display or mouse events (the AFK
   stopwatch pointer poll and drag); some cards animate layout or paint instead of transform.
8. **Security.** The hardened runtime was off, so any program running as the developer could start a genuine
   PS with injected code and read its Keychain item.
9. **Remember me.** Confirmed: with no Apple team ID, macOS ties each Keychain item to the exact
   build, so every native rebuild meant a new sign in.

## Fixed in this round

- **Hardened runtime on** (build.sh, `ps.entitlements`: Apple events and audio input only).
- **Remember me survives native updates**: the old build hands its sign in to the new build over
  a private socket after both check each other's code signature (the developer's certificate, PS, hardened
  runtime). Works for Drive updates and for `npm run release -- --app` on this Mac. Nothing about
  the Keychain item itself was weakened.
- **Build numbers**: every build gets a real CFBundleVersion (UTC yymmddHHMM).
- **Pane names**: the install screen and the main window banner say "Device Control and Data Access".
- **Fewer wake ups**: watchdog heartbeat 0.25 s to 0.4 s (still well inside its 1 s limit),
  tolerances on the 2 s, 3 s, 20 s, 30 s and 15 minute timers.
- **App Management**: if macOS ever refuses the swap, the update card says exactly where to allow it.

## Left as follow ups (each needs its own test round)

Mixer, AFK and Are you sure timers only while in use; AFK pointer poll to mouse events; card
stripes and glows to transform and opacity; network monitor sampling slower while closed; hide the
Tab list from screen sharing (the developer's call); ScreenCaptureKit for the notes self test, then target 26.
