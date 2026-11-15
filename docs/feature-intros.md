# Feature intros: how to add the next one

A feature intro is the "Did you know?" the island shows once, after an update, for one big new feature. The first one is
"WhatsApp messages now supported". Every release can add one. Adding it is one new entry in a list. No new animation code.

## Add one

1. Open `web/src/core/featureintro.ts` and add an entry to `INTROS` (newest at the end):

   ```ts
   {
     id: "my-feature",                 // never reused or renamed, the saved record is keyed by it
     headline: "My feature is here",   // the first line the island says
     ask: "Did you know you can do X?",
     show: "Show me",
     later: "Later",
     mark: "spark",                    // the picture that swoops in: "whatsapp" or "spark", or add one to MARKS (below)
     steps: ["Open Settings.", "Switch X on.", "Try it."],   // short plain steps, used when there is no guide of its own
     demo: "https://example.com/demo", // optional link, shown as "See the demo"
     settings: "Settings, My feature",  // where the guide stays reachable for good
   }
   ```

   A one button notice (V1.62, "New app logo"): leave out `ask`, `later`, `steps` and `settings`, and add `ack: true` with
   `show: "Ok"`. Ok, Esc and Back end it for good, saved with the person's settings (`introsDone`), so it shows once per
   person. Add `updatersOnly: true` and a `DONE_PROBES` line using `updaterProbe` to keep it from first installs.

2. Say who it is for. By default an intro applies to everyone. To stop it for people who already did the thing (like WhatsApp
   for people who linked it), add one line to `DONE_PROBES` in `web/src/views/FeatureIntro.tsx`: a function that answers
   `"done"` (never show again), `"open"` (show) or `"unknown"` (wait, never guess).

3. Only if you need a new picture or a bigger guide: add a picture to `MARKS` (one small SVG) or a guide to `GUIDES` (a component
   that takes `onClose` and `anchor`, and grows out of the island the way `WaGuide` does). Both are the same file.

4. Add the words to the "New words" list in your report, and a line in `FEATURES.md` if it is a new switch. The intros as a whole
   already have a switch: Settings, From the squad, "Did you know? intros" (`features.json`, id `feature-intros`).

5. Add a test line to `web/tests/featureintro.test.ts` only if you changed a rule. The words need no test.

Keep every word plain: no dashes, no hype, one short sentence per line.

## The rules (already built, you do not touch them)

All in `web/src/core/featureintro.ts` (`nextIntro`), tested in `web/tests/featureintro.test.ts` and
`mac/tests/island-intro-test.sh`:

- Not right after an update. It starts after about 1 minute of ACTIVE use of the to do list on the new version. Idle time does
  not count, and neither does a Mac that slept.
- Only when the island is free. It goes through the shared island queue (`IslandQueue`), at the lowest priority, so a meeting,
  reminder, stand up, What's new, Welcome back or any other card always goes first.
- Never in Sleep mode, Sentry mode, Do Not Disturb, while sharing the screen or over a full screen app. It waits for the next
  free moment.
- Only to people it still applies to (`DONE_PROBES`). Once they did it, never again.
- "Later" (or Esc, or Back) asks once more after 3 days, then never. "Show me" ends it for good.
- One intro at a time, at least a day after the last one. Several waiting: the first in the list goes first.
- The state is kept on each device (`localStorage`, key `ps.featureIntros`), so a Mac, the website and a phone each count on their own.

## What each device shows

- Mac: the island squeezes in a little, bounces out with a soft chime (the "Island sounds" switch and Reduce Motion are respected),
  the mark swoops in on a spring, the card hangs from the island, same black. "Show me" grows the card into the guide, still
  attached. Esc closes it and the island goes back to normal. With the island off, moments off or Reduce Motion it is the same
  card drawn plainly at the top of the Tab list.
- Website and phone: the same card, plain, at the top of the page, with the page's own queue. Phone Back closes it.

## The guide stays in Settings

The guide never goes away. For WhatsApp: Settings, WhatsApp settings, Link WhatsApp. Write that place into `settings` so the
generic guide can say it.
