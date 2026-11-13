package com.cincee.ps.gos

/**
 * When PS looks for an update by itself, with no Android in it (unit tested in src/test).
 *
 * the developer's phone sat on code 26 for hours after 27 went out (1 Nov 2026): the only look was the
 * background check, at most once every 20 hours, the time was written BEFORE the look (so a look
 * that failed on no signal or a VPN reconnect still waited 20 hours), and it was skipped whenever
 * the PS screen was open. Now:
 *  - PS looks when it opens or comes back to the front, at most once every 5 minutes (the default choice), and
 *    while its screen stays open a timer in MainActivity asks again every 5 minutes (V1.54, the developer: "can you
 *    not change it to every five minutes the update instead of every 30 minutes?").
 *  - The background check looks too (the same pace), screen open or not. Android never runs
 *    a periodic job more often than every 15 minutes (WorkManager's floor), so with PS closed that is the
 *    real rhythm: every look of the job, about every 15 minutes.
 *  - Only a look that got an answer counts. A failed one is tried again sooner, waiting longer
 *    after each failure in a row (5, 10, 20, then 30 minutes at most), never in a loop.
 *  - V1.54 (the developer: "have the option to have the different time delays between checking for updates... five minutes by
 *    default, up to 30"): Settings, "Check for updates every" (5, 10, 15 or 30 minutes, one choice synced for every
 *    device; the page tells this app, Updater.setEvery). It sets the wait for both kinds of look and the screen
 *    timer; the failed-look back off only ever makes it longer. Anything else is 5.
 *  - One look at a time: Updater skips a look while another still runs (a slow network never piles them up).
 *  - Looking never installs anything: an update only shows (the PS dot, the card, one notification)
 *    and installs on the developer's tap.
 *  - V1.33 (the developer: "click update now or something to actually update"): the notification is quiet and comes
 *    once per version, remembered across restarts (shouldTell), so it never nags.
 */
data class UpdateTimes(val okAt: Long = 0, val failAt: Long = 0, val fails: Int = 0)

object UpdateClock {
    const val SLACK = 30_000L                    // a timer that fires a hair early is not told "too soon"
    const val RETRY_FIRST = 5 * 60_000L          // 5 minutes
    const val RETRY_MAX = 30 * 60_000L           // 30 minutes (was 2 hours)

    val CHOICES = intArrayOf(5, 10, 15, 30)
    /** Off (open source build): no look by itself, open or in the background; Check now still looks. */
    const val OFF = 0
    /** The minutes to use: one of the four choices or 0 (Off), anything else is 5. */
    fun cleanEvery(min: Int): Int = if (min == OFF || CHOICES.contains(min)) min else 5
    fun off(min: Int): Boolean = cleanEvery(min) == OFF
    /** The wait for timers; Off never looks (due), 5 minutes here only as a safe number. */
    fun everyMs(min: Int): Long = (if (off(min)) 5 else cleanEvery(min)) * 60_000L

    /** How long to wait after the last failure, given how many failed in a row. */
    fun retryAfter(fails: Int): Long {
        if (fails <= 0) return 0
        val steps = (fails - 1).coerceAtMost(10)
        return (RETRY_FIRST shl steps).coerceAtMost(RETRY_MAX)
    }

    /** Should PS look now? `open`: PS opened or came to the front; otherwise the background check. */
    fun due(t: UpdateTimes, now: Long, open: Boolean, everyMin: Int = 5): Boolean {
        if (off(everyMin)) return false   // "Check for updates every" Off: only a tap on Check now looks
        // A clock that jumped backwards (a wrong time fixed by the network) must not stop looks for days.
        if (t.okAt > now || t.failAt > now) return true
        val every = everyMs(everyMin)   // the same for opening and for the background job (they differ only in who asks)
        if (now - t.okAt < every - SLACK) return false
        return t.fails == 0 || now - t.failAt >= maxOf(retryAfter(t.fails), every - SLACK)
    }

    /** Tell the developer about version `code` (one quiet notification)? Only when it is newer than this app and newer
     *  than the last version he was told about (`told`, kept in the app's own settings). */
    fun shouldTell(told: Int, code: Int, mine: Int) = code > mine && code > told

    fun succeeded(now: Long) = UpdateTimes(okAt = now)
    fun failed(t: UpdateTimes, now: Long) = t.copy(failAt = now, fails = (t.fails + 1).coerceAtMost(1000))
}
