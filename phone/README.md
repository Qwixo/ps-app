# PS GOS

PS for Android, built and tested on a Pixel running GrapheneOS. The same web app as cincee.com/client and PS
on the Mac (`~/Projects/ps/web`), inside a small Kotlin shell. No store listing: the first APK comes from
cincee.com/client/gos/, and its updates from GitHub (github.com/RedbyPS/ps).

- What GrapheneOS changes and how PS copes: [docs/gos-findings.md](docs/gos-findings.md)
- Building, releasing, the signing key: [docs/release.md](docs/release.md)
- Installing it on the phone: [docs/install.md](docs/install.md)

## How it fits together

- The page is bundled inside the APK and served from `https://appassets.androidplatform.net/client/`
  (a secure origin, so WebCrypto works offline too) with the same strict Content-Security-Policy as
  the website. It talks to the Supabase vault, GitHub for update checks (Settings, "Check for updates
  every", Off stops them), the G Squad hub if you are in The G Squad, Telegram only if you add your own bot,
  and youtube-nocookie.com only when you open a video in Goals.
- Home is the Tab list from the Mac in three panes a thumb can reach: Plan (clocks, timelines,
  meetings, the follow-up radar, campaign stats, Dimension X), List, Inbox (client emails,
  meeting notes, New tasks, Urgent). Vault shows the website's pages; PS opens the phone settings.
- Touch: tap a task to work on it, hold a task (or an Urgent item, a New tasks card, a Dimension X
  card) to lift it with a haptic and drag it, swipe sideways between panes, back closes the top
  layer and then sends PS to the background.
- Instead of holding Tab: the Quick Settings tile and a quiet notification (on by default), a home
  screen widget (add it from the home screen), a floating bubble (optional, needs Display over
  other apps; never over Signal or 1Password).
- Remember me: the derived vault keys (never the passphrase) sealed by a Keystore key that needs the
  fingerprint or the phone PIN.
- Notifications without Google: WorkManager about every 15 minutes asks `vault_probe` (a few hundred
  bytes); only a change wakes the page for one change only sync. Calls ring 10 minutes before
  through AlarmManager, on time even while the phone sleeps.
- Fitness (Fitness.kt, RestClock.kt): a ticked set starts a rest. A foreground service shows a big
  countdown on the lock screen (system chronometer, no wake ups) with +15 s and Skip; an exact alarm
  ends it on time through Doze with a strong buzz (even on silent) and a short chime (not on silent).
  The screen stays on while a workout is open and PS is in front. Bridge: `fitness:*` messages, contract
  in the notes folder fitness/android-bridge.md.
- Screen time (UsageStatsManager) and "Are you sure" for YouTube and Netflix (never during a call).
- the developer's own background videos come from his vault, encrypted, once per phone.
- Left on the Mac on purpose: the keyboard tap, middle click, the volume mixer, microphone and
  AirPods switching, per app network rows (that would need a VpnService, which would replace your VPN).
