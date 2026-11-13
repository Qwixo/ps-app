package com.cincee.ps.gos

/**
 * Screen time maths from the phone's own usage events, with no Android types so the JVM tests run it.
 *
 * Why events and not the per app totals (V1.31): the totals UsageStatsManager hands back come from
 * its stored buckets, and those start and end wherever the system last rolled them over, not at
 * midnight. Asking "midnight to now" could add yesterday's evening or miss part of today, and the
 * totals cannot say WHEN an app was open, so the phone had no timeline. The events say exactly
 * when each app came to the front and left it, and when the screen went off, so today's minutes and
 * the last hours line are both counted from the same facts, cut exactly at midnight.
 *
 * Signal and 1Password never get here: the caller drops their events at the first read, and
 * [line] drops them again before anything else.
 */
object UsageCount {
    // UsageEvents.Event type numbers (fixed platform constants).
    const val RESUMED = 1          // ACTIVITY_RESUMED (was MOVE_TO_FOREGROUND)
    const val PAUSED = 2           // ACTIVITY_PAUSED (was MOVE_TO_BACKGROUND)
    const val STOPPED = 23         // ACTIVITY_STOPPED
    const val SCREEN_ON = 15       // SCREEN_INTERACTIVE
    const val SCREEN_OFF = 16      // SCREEN_NON_INTERACTIVE
    const val KEYGUARD_SHOWN = 17
    const val SHUTDOWN = 26        // DEVICE_SHUTDOWN
    const val STARTUP = 27         // DEVICE_STARTUP
    val WANTED = setOf(RESUMED, PAUSED, STOPPED, SCREEN_ON, SCREEN_OFF, KEYGUARD_SHOWN, SHUTDOWN, STARTUP)

    /** Same app again within this gap (a new screen inside the app): one stretch. */
    const val JOIN_MS = 2_000L
    /** Screen off for at least this long shows as a break on the line. */
    const val MIN_AWAY_MS = 5 * 60_000L

    data class Ev(val pkg: String, val cls: String?, val type: Int, val t: Long)
    data class Seg(val pkg: String, val s: Long, val e: Long)
    data class Line(val segs: List<Seg>, val away: List<Pair<Long, Long>>)

    /**
     * Which app was in front and when, between [from] and [now], plus the screen off breaks.
     * [counts] says whether a package is an app the developer opens (the home screen and system UI are not:
     * when one of them comes to the front the app before it has left). Events may start before
     * [from] so an app already open at [from] is known; everything is cut to [from, now].
     */
    fun line(evs: List<Ev>, from: Long, now: Long, counts: (String) -> Boolean, isProtected: (String) -> Boolean = { false }): Line {
        val raw = ArrayList<Seg>()
        val away = ArrayList<Pair<Long, Long>>()
        val open = HashMap<String, MutableSet<String>>()
        var front: String? = null
        var since = 0L
        var offAt: Long? = null
        fun close(t: Long) {
            val f = front ?: return
            if (t > since) raw.add(Seg(f, since, t))
            front = null
        }
        fun screenOn(t: Long) {
            val o = offAt ?: return
            if (t - o >= MIN_AWAY_MS) away.add(o to t)
            offAt = null
        }
        for (e in evs.sortedBy { it.t }) {
            if (e.t > now) break
            if (isProtected(e.pkg)) continue          // golden rule: as if the event never happened
            when (e.type) {
                RESUMED -> {
                    screenOn(e.t)                         // an app came up, so the screen is on (a missed SCREEN_ON)
                    if (!counts(e.pkg)) { close(e.t); continue }
                    open.getOrPut(e.pkg) { HashSet() }.add(e.cls ?: "")
                    if (front != e.pkg) { close(e.t); front = e.pkg; since = e.t }
                }
                PAUSED, STOPPED -> {
                    val s = open[e.pkg]
                    s?.remove(e.cls ?: "")
                    if (e.pkg == front && s.isNullOrEmpty()) close(e.t)
                }
                SCREEN_OFF, KEYGUARD_SHOWN, SHUTDOWN -> {
                    close(e.t)
                    open.clear()
                    if (offAt == null) offAt = e.t
                }
                SCREEN_ON, STARTUP -> screenOn(e.t)
            }
        }
        if (offAt == null) close(now)
        else { val o = offAt!!; if (now - o >= MIN_AWAY_MS) away.add(o to now) }

        // Cut to the window, then join the same app's stretches split by a screen change inside it.
        val segs = ArrayList<Seg>()
        for (g in raw) {
            val s = maxOf(g.s, from); val e = minOf(g.e, now)
            if (e <= s) continue
            val last = segs.lastOrNull()
            if (last != null && last.pkg == g.pkg && s - last.e <= JOIN_MS) segs[segs.size - 1] = Seg(g.pkg, last.s, maxOf(last.e, e))
            else segs.add(Seg(g.pkg, s, e))
        }
        val cut = away.mapNotNull { (s, e) -> val a = maxOf(s, from); val b = minOf(e, now); if (b > a) a to b else null }
        return Line(segs, cut)
    }

    /** Milliseconds per app inside [from, to] (today: from local midnight). */
    fun totals(segs: List<Seg>, from: Long, to: Long): Map<String, Long> {
        val out = LinkedHashMap<String, Long>()
        for (g in segs) {
            val ms = minOf(g.e, to) - maxOf(g.s, from)
            if (ms > 0) out[g.pkg] = (out[g.pkg] ?: 0L) + ms
        }
        return out
    }
}
