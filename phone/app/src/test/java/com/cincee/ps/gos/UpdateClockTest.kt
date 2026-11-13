package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateClockTest {
    private val t0 = 1_761_900_000_000L
    private val min = 60_000L
    private val hour = 3_600_000L

    @Test fun neverLookedMeansLookNow() {
        assertTrue(UpdateClock.due(UpdateTimes(), t0, open = true))
        assertTrue(UpdateClock.due(UpdateTimes(), t0, open = false))
    }

    // V1.54: every 5 minutes, open or in the background (it was 1 hour and 6 hours).
    @Test fun theRhythmIsFiveMinutes() {
        assertEquals(5 * min, UpdateClock.everyMs(5))
        assertEquals(5 * min, UpdateClock.everyMs(0))   // Off: timers keep a safe 5 (due never looks)
    }

    @Test fun openingLooksAtMostEveryFiveMinutes() {
        val t = UpdateClock.succeeded(t0)
        assertFalse(UpdateClock.due(t, t0 + 2 * min, open = true))
        assertFalse(UpdateClock.due(t, t0 + 4 * min, open = true))
        assertTrue(UpdateClock.due(t, t0 + 5 * min, open = true))
    }

    @Test fun backgroundLooksEveryFiveMinutesToo() {
        val t = UpdateClock.succeeded(t0)
        assertFalse(UpdateClock.due(t, t0 + 2 * min, open = false))
        assertTrue(UpdateClock.due(t, t0 + 5 * min, open = false))
        assertTrue(UpdateClock.due(t, t0 + 15 * min, open = false))   // the job's own floor: every run looks
    }

    @Test fun aTimerThatFiresAHairEarlyStillLooks() {
        // The screen timer is set when PS opens and the look is stamped a moment later: 4 min 40 s after the stamp counts.
        val t = UpdateClock.succeeded(t0)
        assertTrue(UpdateClock.due(t, t0 + 5 * min - 20_000, open = true))
        assertFalse(UpdateClock.due(t, t0 + 5 * min - 40_000, open = true))
    }

    @Test fun aFailedLookIsNotStampedAsDone() {
        // The old code wrote the time first: a failure then waited 20 hours. Now only success counts.
        val ok = UpdateClock.succeeded(t0)
        val failed = UpdateClock.failed(ok, t0 + 2 * hour)
        assertEquals(t0, failed.okAt)
        assertEquals(1, failed.fails)
        assertTrue(UpdateClock.due(failed, t0 + 2 * hour + 5 * min, open = true))
    }

    @Test fun failuresBackOffAndNeverLoop() {
        assertEquals(0L, UpdateClock.retryAfter(0))
        assertEquals(5 * min, UpdateClock.retryAfter(1))
        assertEquals(10 * min, UpdateClock.retryAfter(2))
        assertEquals(20 * min, UpdateClock.retryAfter(3))
        assertEquals(30 * min, UpdateClock.retryAfter(4))   // 5, 10, 20, then 30 at most
        assertEquals(30 * min, UpdateClock.retryAfter(5))
        assertEquals(30 * min, UpdateClock.retryAfter(999))
        var t = UpdateTimes()
        repeat(3) { t = UpdateClock.failed(t, t0) }
        assertFalse(UpdateClock.due(t, t0, open = true))            // straight after a failure: never again at once
        assertFalse(UpdateClock.due(t, t0 + 19 * min, open = true))
        assertTrue(UpdateClock.due(t, t0 + 20 * min, open = true))
    }

    @Test fun successClearsTheFailures() {
        var t = UpdateTimes()
        repeat(5) { t = UpdateClock.failed(t, t0) }
        t = UpdateClock.succeeded(t0 + hour)
        assertEquals(0, t.fails)
        assertTrue(UpdateClock.due(t, t0 + 2 * hour, open = true))
    }

    @Test fun aClockThatJumpedBackStillLooks() {
        assertTrue(UpdateClock.due(UpdateClock.succeeded(t0 + 10 * hour), t0, open = true))
        assertTrue(UpdateClock.due(UpdateClock.failed(UpdateTimes(), t0 + hour), t0, open = false))
    }

    // V1.54: Settings, "Check for updates every": 5, 10, 15 or 30 minutes, anything else is 5.
    @Test fun eachChoiceSetsThePace() {
        for (m in intArrayOf(5, 10, 15, 30)) {
            assertEquals(m, UpdateClock.cleanEvery(m))
            assertEquals(m * min, UpdateClock.everyMs(m))
            val t = UpdateClock.succeeded(t0)
            assertFalse(UpdateClock.due(t, t0 + m * min - 2 * min, open = true, everyMin = m))
            assertTrue(UpdateClock.due(t, t0 + m * min, open = true, everyMin = m))
            assertTrue(UpdateClock.due(t, t0 + m * min, open = false, everyMin = m))   // the background job follows it too
        }
    }

    @Test fun badChoicesFallBackToFive() {
        for (bad in intArrayOf(-5, 1, 7, 20, 31, 60, 1800, Int.MAX_VALUE, Int.MIN_VALUE)) {
            assertEquals(5, UpdateClock.cleanEvery(bad))
            assertEquals(5 * min, UpdateClock.everyMs(bad))
        }
        val t = UpdateClock.succeeded(t0)
        assertTrue(UpdateClock.due(t, t0 + 5 * min, open = true, everyMin = 7))
        assertFalse(UpdateClock.due(t, t0 + 2 * min, open = true, everyMin = 7))
    }

    @Test fun theBackOffStaysAndIsNeverShorterThanTheChoice() {
        // 5 minute choice: the same 5, 10, 20, 30 as before.
        var t = UpdateTimes()
        repeat(2) { t = UpdateClock.failed(t, t0) }
        assertFalse(UpdateClock.due(t, t0 + 9 * min, open = true, everyMin = 5))
        assertTrue(UpdateClock.due(t, t0 + 10 * min, open = true, everyMin = 5))
        // 30 minute choice: a failed look waits the full 30, not 5.
        var u = UpdateClock.succeeded(t0)
        u = UpdateClock.failed(u, t0 + 30 * min)
        assertFalse(UpdateClock.due(u, t0 + 30 * min + 5 * min, open = true, everyMin = 30))
        assertTrue(UpdateClock.due(u, t0 + 60 * min, open = true, everyMin = 30))
        // 15 minutes, three failures in a row: 20 minutes (the back off) beats the 15.
        var w = UpdateTimes()
        repeat(3) { w = UpdateClock.failed(w, t0) }
        assertFalse(UpdateClock.due(w, t0 + 19 * min, open = true, everyMin = 15))
        assertTrue(UpdateClock.due(w, t0 + 20 * min, open = true, everyMin = 15))
    }

    // Open source build: Off (0) means no automatic look at all, opening or in the background.
    @Test fun offNeverLooksByItself() {
        assertEquals(0, UpdateClock.cleanEvery(0))
        assertTrue(UpdateClock.off(0))
        assertFalse(UpdateClock.off(5))
        assertFalse(UpdateClock.off(7))
        assertFalse(UpdateClock.due(UpdateTimes(), t0, open = true, everyMin = 0))
        assertFalse(UpdateClock.due(UpdateTimes(), t0, open = false, everyMin = 0))
        assertFalse(UpdateClock.due(UpdateClock.succeeded(t0), t0 + 10 * hour, open = true, everyMin = 0))
        assertFalse(UpdateClock.due(UpdateClock.succeeded(t0 + 10 * hour), t0, open = true, everyMin = 0))   // even a clock that jumped back
        assertTrue(UpdateClock.due(UpdateClock.succeeded(t0), t0 + 5 * min, open = true, everyMin = 5))      // back on: as before
    }

    // V1.33: one quiet notification per version, never again for the same one (no nagging).
    @Test fun tellsOncePerVersion() {
        assertTrue(UpdateClock.shouldTell(told = 0, code = 35, mine = 34))
        assertFalse(UpdateClock.shouldTell(told = 35, code = 35, mine = 34))
        assertTrue(UpdateClock.shouldTell(told = 35, code = 36, mine = 34))
    }

    @Test fun neverTellsAboutThisVersionOrOlder() {
        assertFalse(UpdateClock.shouldTell(told = 0, code = 34, mine = 34))
        assertFalse(UpdateClock.shouldTell(told = 0, code = 30, mine = 34))
    }
}
