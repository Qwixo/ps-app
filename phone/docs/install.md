# Installing PS GOS on the Pixel (first time)

Do this in the Owner profile (PS's keys and data belong to the profile it is installed in).

1. On the phone, open the **Files** app and go to Google Drive, `YOUR_SYNC_FOLDER/PS App/GOS/`, or copy
   `ps-gos-1.0.x.apk` onto the phone any way you like (USB, the Drive website in Vanadium).
   Without sandboxed Google Play the Drive app is not there: open drive.google.com in Vanadium,
   download the APK, then open it from Files > Downloads.
2. Tap the APK. GrapheneOS says the app that opened it (Files, or Vanadium) is not allowed to install
   apps: tap **Settings**, switch on **Allow from this source**, go back. This is once only.
3. Tap **Install**. GrapheneOS may ask whether PS may use the **Network**: allow it (PS needs it for
   the vault; all traffic still goes through your VPN). PS does not need **Sensors**.
4. Open PS. Allow notifications. Sign in with your username and passphrase once; PS then asks
   for your fingerprint so next time it opens with the fingerprint alone.
5. In PS > Phone settings (the gear in the dock):
   - **Usage access**: for screen time and Are you sure (Settings opens; switch PS on).
   - **Calls on the minute**: lets the 10 minute call alert ring on time.
   - **Run while the phone sleeps**: optional, makes background checks a little faster.
   - **Updates**: allow PS to install apps once (Settings > Apps > PS > Install unknown apps), so
     Download and install works later.
6. Add the Quick Settings tile: pull the shade down twice, the pencil, drag **PS list** up. Add the
   widget from the home screen (hold, Widgets, PS) if you want it.

Updates after this: PS > Phone settings > Download and install, one confirm tap.

If GrapheneOS ever shows a memory error notice for PS, report it to Claude; PS has no native code
of its own, so it should never need Exploit protection compatibility mode.
