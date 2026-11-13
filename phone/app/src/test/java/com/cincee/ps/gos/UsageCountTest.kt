package com.cincee.ps.gos

import com.cincee.ps.gos.UsageCount.Ev
import com.cincee.ps.gos.UsageCount.KEYGUARD_SHOWN
import com.cincee.ps.gos.UsageCount.PAUSED
import com.cincee.ps.gos.UsageCount.RESUMED
import com.cincee.ps.gos.UsageCount.SCREEN_OFF
import com.cincee.ps.gos.UsageCount.SCREEN_ON
import com.cincee.ps.gos.UsageCount.STOPPED
import com.cincee.ps.gos.UsageCount.Seg
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The phone's screen time from usage events (V1.31): exact minutes from midnight and the timeline. */
class UsageCountTest {
    private val M = 60_000L
    private val H = 60 * M
    private val launcher = "com.android.launcher3"
    private val apps = setOf("app.vanadium.browser", "com.whatsapp", "com.google.android.youtube", "com.cincee.ps.gos")
    private val counts = { p: String -> p in apps }
    private fun on(p: String, t: Long, c: String = "Main") = Ev(p, c, RESUMED, t)
    private fun off(p: String, t: Long, c: String = "Main") = Ev(p, c, PAUSED, t)
    private fun screen(on: Boolean, t: Long) = Ev("android", null, if (on) SCREEN_ON else SCREEN_OFF, t)

    @Test fun plainUseCountsEachStretch() {
        val evs = listOf(on("com.whatsapp", 10 * M), off("com.whatsapp", 25 * M), on("app.vanadium.browser", 25 * M), off("app.vanadium.browser", 70 * M))
        val l = UsageCount.line(evs, 0, 2 * H, counts)
        assertEquals(listOf(Seg("com.whatsapp", 10 * M, 25 * M), Seg("app.vanadium.browser", 25 * M, 70 * M)), l.segs)
        assertEquals(mapOf("com.whatsapp" to 15 * M, "app.vanadium.browser" to 45 * M), UsageCount.totals(l.segs, 0, 2 * H))
    }

    @Test fun midnightCutsAnAppOpenAcrossIt() {
        // Open from 23:30 to 00:20: only the 20 minutes after midnight are today's.
        val midnight = 24 * H
        val evs = listOf(on("com.google.android.youtube", midnight - 30 * M), off("com.google.android.youtube", midnight + 20 * M))
        val l = UsageCount.line(evs, midnight - 24 * H, midnight + H, counts)
        assertEquals(20 * M, UsageCount.totals(l.segs, midnight, midnight + H)["com.google.android.youtube"])
        assertEquals(50 * M, UsageCount.totals(l.segs, 0, midnight + H)["com.google.android.youtube"])
    }

    @Test fun anAppStillOpenCountsUntilNow() {
        val l = UsageCount.line(listOf(on("com.whatsapp", 5 * M)), 0, 65 * M, counts)
        assertEquals(listOf(Seg("com.whatsapp", 5 * M, 65 * M)), l.segs)
    }

    @Test fun screenOffEndsTheAppAndLongOffIsABreak() {
        val evs = listOf(on("com.whatsapp", 0), screen(false, 10 * M), Ev("android", null, KEYGUARD_SHOWN, 10 * M + 50),
            screen(true, 40 * M), on("com.whatsapp", 41 * M), off("com.whatsapp", 50 * M),
            screen(false, 51 * M), screen(true, 53 * M))   // two minutes off: too short to draw
        val l = UsageCount.line(evs, 0, H, counts)
        assertEquals(listOf(Seg("com.whatsapp", 0, 10 * M), Seg("com.whatsapp", 41 * M, 50 * M)), l.segs)
        assertEquals(listOf(10 * M to 40 * M), l.away)
    }

    @Test fun screenStillOffIsABreakUntilNow() {
        val l = UsageCount.line(listOf(on("com.whatsapp", 0), screen(false, 5 * M)), 0, H, counts)
        assertEquals(listOf(5 * M to H), l.away)
        assertEquals(5 * M, UsageCount.totals(l.segs, 0, H)["com.whatsapp"])
    }

    @Test fun homeScreenIsNotAnAppAndEndsTheOneBefore() {
        // The pause can come after the launcher's resume; the app still ends when home comes up.
        val evs = listOf(on("com.whatsapp", 0), on(launcher, 3 * M), off("com.whatsapp", 3 * M + 200), on("app.vanadium.browser", 4 * M))
        val l = UsageCount.line(evs, 0, 5 * M, counts)
        assertEquals(listOf(Seg("com.whatsapp", 0, 3 * M), Seg("app.vanadium.browser", 4 * M, 5 * M)), l.segs)
        assertFalse(l.segs.any { it.pkg == launcher })
    }

    @Test fun aNewScreenInsideTheSameAppIsOneStretch() {
        val evs = listOf(on("com.whatsapp", 0, "Chats"), off("com.whatsapp", 2 * M, "Chats"), on("com.whatsapp", 2 * M + 300, "Chat"),
            Ev("com.whatsapp", "Chats", STOPPED, 2 * M + 600), off("com.whatsapp", 9 * M, "Chat"))
        val l = UsageCount.line(evs, 0, 10 * M, counts)
        assertEquals(listOf(Seg("com.whatsapp", 0, 9 * M)), l.segs)
    }

    @Test fun signalAndOnePasswordNeverCount() {
        val prot = { p: String -> Regex("signal|thoughtcrime|securesms|1password|onepassword|agilebits", RegexOption.IGNORE_CASE).containsMatchIn(p) }
        val all = { p: String -> true }
        val evs = listOf(on("com.whatsapp", 0), off("com.whatsapp", 5 * M), on("org.thoughtcrime.securesms", 5 * M),
            off("org.thoughtcrime.securesms", 20 * M), on("com.onepassword.android", 20 * M), off("com.onepassword.android", 25 * M),
            on("app.vanadium.browser", 25 * M), off("app.vanadium.browser", 30 * M))
        val l = UsageCount.line(evs, 0, H, all, prot)
        assertTrue(l.segs.none { prot(it.pkg) })
        assertEquals(listOf("com.whatsapp", "app.vanadium.browser"), l.segs.map { it.pkg })
        assertEquals(10 * M, UsageCount.totals(l.segs, 0, H).values.sum())
    }

    @Test fun eventsBeforeTheWindowSetTheStateButDoNotCount() {
        val l = UsageCount.line(listOf(on("com.whatsapp", -30 * M)), 0, 10 * M, counts)
        assertEquals(listOf(Seg("com.whatsapp", 0, 10 * M)), l.segs)
    }

    @Test fun eventsAfterNowAreIgnoredAndOrderIsFixed() {
        val evs = listOf(off("com.whatsapp", 8 * M), on("com.whatsapp", 2 * M), on("app.vanadium.browser", 20 * M))
        val l = UsageCount.line(evs, 0, 10 * M, counts)
        assertEquals(listOf(Seg("com.whatsapp", 2 * M, 8 * M)), l.segs)
    }

    @Test fun aWholeDayAddsUpToTheRealTime() {
        // 16 waking hours: every hour 20 minutes in three apps, the screen off between. About 5h 20m, never one minute.
        val evs = ArrayList<Ev>()
        for (h in 7 until 23) {
            val t = h * H
            evs += screen(true, t); evs += on("com.whatsapp", t); evs += off("com.whatsapp", t + 5 * M)
            evs += on("app.vanadium.browser", t + 5 * M); evs += off("app.vanadium.browser", t + 15 * M)
            evs += on("com.google.android.youtube", t + 15 * M); evs += screen(false, t + 20 * M)
        }
        val l = UsageCount.line(evs, 0, 24 * H, counts)
        assertEquals(16 * 20 * M, UsageCount.totals(l.segs, 0, 24 * H).values.sum())
        assertEquals(16, l.away.size)
    }
}
