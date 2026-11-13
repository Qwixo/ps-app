# Privacy: what the developer can and cannot see

The developer makes PS and runs the server most people use. This page says exactly what that lets him see, and what it
does not. Every point names the code that proves it, so you (or your AI) can check it.

## The short version

- the developer cannot read your tasks, notes, lists, settings, clients or anything else you keep in PS. They are encrypted
  on your device with a key made from your passphrase, and the server only ever gets the locked version.
- the developer can see that your account exists, when and from which IP address you sign in, how many encrypted items you
  have, how big they are and when they change, and whatever you choose to share in The G Squad.
- PS asks cincee.com for updates. Those requests show your IP address to cincee.com's hosting.
- You can keep everything on your Mac only, or on a Supabase server of your own. Then most of the above goes away.
  The exceptions are listed at the end.

## Where your data can live

When you first open PS on a Mac you choose:

1. **Start now**: everything stays on this Mac, encrypted, with its key in your Mac's Keychain
   (`mac/Sources/LocalKey.swift`, `web/src/localfirst.ts`). Nothing is synced, and the developer's vault server never hears
   of you. Update checks and The G Squad, below, still apply unless you switch them off.
2. **Sign in**: your vault is on the developer's server (a Supabase project at `mxusokxekkecebwqgeru.supabase.co`). Your data
   is end to end encrypted, but the server sees the facts listed below.
3. **Connect your own Supabase**: your vault is on a Supabase project you own (`mac/Sources/ProjectSetup.swift`).
   The developer has no access to it.

The phone app (Android) always uses the developer's server. It cannot use your own Supabase yet (`web/src/core/project.ts`).

## What the developer cannot see

**Your content.** Every task, note, list, setting, client, calendar event PS copies in, screen time total and
background is sealed with AES-256-GCM before it leaves your device (`web/src/core/crypto.ts`,
`web/src/core/vault.ts`). Even the kind of item (task, note, setting) is inside the sealed part. Files and
backgrounds are sealed the same way (`blobs`).

**Your passphrase and your key.** Your passphrase goes through PBKDF2 (SHA-256, 600,000 rounds), then is split
into two different values (`web/src/core/crypto.ts`, `deriveFromPassphrase`):

- a sign in value, which is what the server checks (Supabase stores its own hash of it), and
- a key that unlocks your vault key, which never leaves your device.

One cannot be worked out from the other. The sign in function on the server (`web/supabase/functions/vault-auth/`)
only ever receives the sign in value and a login id. Your recovery key works the same way; the server keeps only
a hash of a token made from it.

**Your username.** The server stores a login id, `v-<40 hex characters>@vault.cincee.app`, which is a SHA-256 hash
of your username (`loginEmail` in `web/src/core/crypto.ts`). It is not stored in plain text anywhere. Note: a hash
of a short or common username can be guessed by trying names, so this hides your username from a casual look, not
from someone determined.

**Linking your phone.** When you link a phone by QR code, your Mac seals the sign in details to a key made on the
phone, after you check the same six digit code on both screens and press Allow (`web/src/core/phonepair.ts`,
`web/supabase/migrations/029_phone_signin.sql`). The server only relays sealed data and public keys, and deletes
them within 15 minutes.

## What the developer can see, for accounts on his server

This is what the database and Supabase's own logs hold. The developer owns the project, so he can read all of it.

| What | Where |
| --- | --- |
| That your account exists, when it was made, and your hashed login id | Supabase's `auth.users` |
| Each sign in: the time, your IP address and your browser or app User-Agent | `access_log` (`003_access_log.sql`), and Supabase's auth logs |
| Every request to the server: time, IP address, User-Agent, which table | Supabase's platform logs (kept by Supabase, not by PS's code; PS cannot switch them off) |
| How many encrypted items you have, the exact size of each, when each was made, changed or deleted | `records`, `blobs` (`001_vault.sql`, `010_blobs.sql`) |
| Which accounts share a client workspace, and who invited whom | `workspaces`, `members`, `invites`, `owners` |
| That a phone or iPhone was linked to your account, and when | `ps_devices` (`029_phone_signin.sql`) |
| While PS is open and unlocked on your Mac or website, a live connection that tells your other devices "PS is open" (nothing is written to a table) | Supabase Realtime, `ps-presence:<your id>` (`web/src/ps.ts`). Switch: Settings, Privacy and sharing, "Tell the website PS app is open" |
| On the phone, a small check about every 15 minutes while Background checks is on | `vault_probe` (`phone/app/.../Background.kt`) |

He cannot see what any of those encrypted items say.

## What goes to cincee.com

| What | When | What it sends | Switch |
| --- | --- | --- | --- |
| Mac update check (`cincee.com/client/ps/ps-update.json`) | 45 s after launch, then every 5 minutes by default, and after the Mac wakes | A plain request with `User-Agent: PS`. No account, no device id, no version number (`mac/Sources/UpdateCore.swift`) | Settings, About and updates, "Check for updates every": 5, 10, 15, 30 minutes or Off |
| Website version check (`cincee.com/client/version.json`) | The website in a browser, on the same timer as above. (The Mac app does this too, every 15 minutes, but only on the developer's own account: `checkWebsite` in `mac/Sources/main.swift`) | A plain request with the browser's usual headers | Same switch |
| Phone update check (`cincee.com/client/gos/version.json`) | When the app opens, every 5 minutes while it is on screen, and from the background check | A plain request; Android adds its standard User-Agent, which usually names the Android version and phone model | Same switch |
| "Last online" check of the network monitor | Once a minute while the network monitor is on | A DNS lookup of a made up name, `ps-check-<random>.cincee.com` (`mac/Sources/NetUptime.swift`). It goes through your normal DNS server, so cincee.com's DNS host usually sees your DNS provider's address, not yours | Settings, Mac, "Network monitor" Off |
| The website itself (cincee.com/client) | Each time you open it in a browser | The page is loaded fresh from cincee.com each visit | Use the Mac or phone app instead |

Other services, only when you use them: Telegram, if you add your own Telegram bot; YouTube's no cookie player
(`youtube-nocookie.com`), when you open a video in Goals; Apple's speed test servers, when you press Speed test in
the network monitor; and Supabase's own website (`api.supabase.com`), when you connect your own Supabase.

cincee.com is hosted on Netlify behind Cloudflare. Like any website, those services see the IP address and
User-Agent of every request. PS has no analytics and no crash reporting in any of the three apps. ("Sentry" in
the code is PS's lock screen mode, not the error reporting service.)

## The G Squad (friends)

The G Squad is a shared space with other PS users. It runs on a second server of the developer's, the hub
(`zxhvchchfrkfqxuyorqo.supabase.co`, code in `web/supabase/hub/`).

- PS joins The G Squad by itself after you sign in, unless you switch "Join The G Squad automatically" off
  (Settings, G Squad). You can leave at any time in G Squad's own settings.
- What you share is sealed with a squad key that every member's device holds. **Every member can read it, and the developer
  is a member and the squad's admin.** So the developer can read anything you share there.
- Shared by default: your first name, whether PS is running ("working"), money, your daily screen time total,
  fitness and sleep. Tasks are only shared if you mark them. Each piece has a switch: Settings, G Squad, "What you
  share" (`web/src/core/squadshare.ts`).
- Not sealed on the hub: when you joined, a "last seen" time updated about every 3 minutes while PS runs, the type
  of each shared card, chat message times, and file sizes.
- The hub stores a hash of your account (your server's address plus your account id) so your Mac and phone count
  as one member. The developer runs the main server too, so he can match that hash to your account there.
- Joining needs no approval: the code lets any copy of PS join and be given the squad key automatically
  (`supabase/hub/functions/squad/index.ts`, `auto_join`). Anyone who joins can read what members share.

## What stays on your Mac

These read things on your Mac and never send them anywhere:

- **Network monitor**: per app traffic (macOS's own `nettop` tool), the route table, Wi-Fi signal strength and a
  country lookup from a file inside the app (`mac/geo/ip-country.bin`). Nothing is uploaded; its history is kept
  encrypted on the Mac (`mac/Sources/NetMonitor.swift`). The only network use is the "Last online" lookup above,
  and Apple's speed test when you press Speed test.
- **Are you sure**: the title of the front browser window, to notice sites you asked it to watch.
- **AFK timer, screen time counting, the mixer, the Tab overlay keyboard watch**: all local. Screen time totals
  are saved in your encrypted vault, and the daily total goes to The G Squad unless you switch it off.
- **Logs** in `~/Library/Logs/PS/` stay on your Mac.

- **AI task API** (off until you switch it on): PS listens on `127.0.0.1` port 47836, so only apps on this Mac can
  reach it, and only with the key from Settings, AI task API (kept in your Keychain). An AI tool you give the key to
  can read, add or change your tasks, as far as the switches there allow (by default: read tasks, add tasks, the AI
  Inbox only). Requests never leave the Mac (`mac/Sources/TaskApi.swift`, `mac/Sources/TaskApiCore.swift`,
  `web/src/core/taskapi.ts`). "Copy for AI" puts the key on your clipboard.
- **Auto approve** (every switch off until you turn one on): reads the text of terminal windows to spot permission
  prompts and keeps a log of what it approved in `~/Library/PS/auto-approve/` (commands shortened, secrets taken
  out). Nothing is sent anywhere. See [PERMISSIONS.md](PERMISSIONS.md) for what it writes and what it presses.

PS never looks into 1Password or Signal: it stops its keyboard watch while they are in front and leaves them out
of every list (`mac/Sources/Protected.swift`).

## What the developer could do as the person who runs the server

Encryption stops the developer reading your data. It does not stop everything:

- He can delete your account or your items, or hand back an older copy of an item, because the server stores them.
- The website at cincee.com/client loads its code fresh from cincee.com each time. If that code were changed, it
  could read what you type. The Mac and phone apps only change when you install an update, and the update must be
  signed by the developer's key (`mac/Sources/UpdateCore.swift`, `phone/.../Updater.kt`).
- The app you download also contains features that switch on only for the developer's own account (`RED_ONLY` in
  `web/src/core/account.ts`). Their code is not in this repo, so you cannot check it here. Which account is the developer's is
  decided by his server (`vault_role()`). On your own Supabase it can never be yours (`ProjectStore.isRed`,
  `mac/Sources/Project.swift`).
- Someone who copies the whole database could try to guess weak passphrases offline. Each guess costs 600,000
  rounds of PBKDF2, so a long passphrase is safe; a short one is not.

## Your own Supabase: what changes

With Connect your own Supabase (Mac), your vault, the sign in log and all server logs are on your project, not
The developer's. The developer cannot see your account at all. These still reach the developer's servers, unless you switch them off:

- update checks to cincee.com (switch: "Check for updates every", Off),
- the "Last online" DNS check (switch: Network monitor, Off),
- The G Squad hub (switch: "Join The G Squad automatically", Off, or leave the squad).

Also: if you let PS keep your Supabase access token (it asks), an update that changes the database setup applies
the new setup to your project by itself, about 20 seconds after launch (`mac/Sources/ProjectSetup.swift`). Remove
the token in the same window if you would rather do that yourself.
