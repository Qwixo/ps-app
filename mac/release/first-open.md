# Opening PS the first time (macOS 27.2)

DRAFT for the download page cincee.com/ps-app-mac. Public copy: it goes live only after the developer
approves these exact words. (Checked against macOS 27.2: the strings below are what 27.2 shows.
The DMG holds PS.app only; the app is signed by Cincee's own certificate, not by Apple, so macOS
asks once.)

---

**Opening PS the first time**

PS is signed by Cincee, not through Apple's App Store, so your Mac asks you to confirm it once.

1. Open **PS.dmg** from your Downloads, then double-click **PS**.
2. Your Mac says **"PS" Not Opened**. Click **Done**. (Not Move to Trash.)
3. Open **System Settings**, then **Privacy & Security**. Scroll down to **Security**. Next to
   **"PS" was blocked to protect your Mac**, click **Open Anyway**.
4. Enter your Mac password or use Touch ID. Your Mac asks once more, **Open "PS"?**: click **Open Anyway**.
5. The **Install PS** screen opens. Click **Install PS**. It copies PS to your Applications folder
   and shows you the one setting PS needs: **Device Control and Data Access**, so PS can open your list when you
   hold Tab. The volume mixer also asks for **Screen & System Audio Recording**; that one is
   optional.

You only do this once. After that PS opens like any other app and updates itself.

---

Notes for whoever puts this on the page (not public copy):
- 31 Oct 2026: these steps are on cincee.com/client/ps/download/ (web ps-download/download/,
  with drawings of the three macOS windows), next to the one line Terminal install
  (`curl -fsSL https://cincee.com/client/ps/install.sh | bash`), which needs none of them. The wording
  above is checked against macOS 27.2's own strings (CoreServicesUIAgent, Privacy & Security).
- Only an Apple Developer ID plus notarization removes the question entirely (the developer's call, paid).
- Right-click > Open no longer skips this on macOS 15 and later; the Open Anyway button is the
  only way, and it shows for about an hour after step 2.
- If the Install PS screen says macOS did not let PS replace itself during a later update, the
  fix is System Settings > Privacy & Security > App Management, PS on. The updater says so itself.
