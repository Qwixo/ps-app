package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class RestClockTest {
    private val t0 = 1_761_900_000_000L

    @Test fun startSetsTheEndFromTheWallClock() {
        val r = RestClock.start(t0, 90, "  Bench press ", 3, 5, "set-1")
        assertEquals(t0 + 90_000, r.endsAt)
        assertEquals(90, r.sec)
        assertEquals("Bench press", r.exercise)
        assertEquals(90_000, r.leftMs(t0))
        assertEquals(30_000, r.leftMs(t0 + 60_000))
        assertTrue(r.running(t0 + 89_999))
        assertFalse(r.running(t0 + 90_000))
        assertTrue(r.due(t0 + 90_000))
    }

    @Test fun startClampsSillyValues() {
        assertEquals(1, RestClock.start(t0, 0, "x", 1).sec)
        assertEquals(3600, RestClock.start(t0, 99_999, "x", 1).sec)
        assertEquals(60, RestClock.start(t0, 10, "x".repeat(200), 1).exercise.length)
        assertEquals(64, RestClock.start(t0, 10, "x", 1, id = "i".repeat(100)).id.length)
    }

    @Test fun plusFifteenMovesTheEndAndTheTotal() {
        val r = RestClock.start(t0, 90, "Squat", 2)
        val a = RestClock.add(r, t0 + 80_000, 15)!!
        assertEquals(t0 + 105_000, a.endsAt)
        assertEquals(105, a.sec)
        val b = RestClock.add(a, t0 + 81_000, 15)!!
        assertEquals(t0 + 120_000, b.endsAt)
        assertEquals(120, b.sec)
    }

    @Test fun trimmingNeverEndsInThePast() {
        val r = RestClock.start(t0, 90, "Squat", 2)
        val a = RestClock.add(r, t0 + 80_000, -60)!!
        assertEquals(t0 + 81_000, a.endsAt)
    }

    @Test fun addingToAFinishedOrMissingRestChangesNothing() {
        assertNull(RestClock.add(null, t0, 15))
        val over = RestClock.finish(RestClock.start(t0, 90, "Row", 1), t0 + 90_000)!!
        assertSame(over, RestClock.add(over, t0 + 95_000, 15))
    }

    @Test fun finishStampsOnce() {
        val r = RestClock.start(t0, 60, "Row", 1)
        val a = RestClock.finish(r, t0 + 60_000)!!
        assertTrue(a.over)
        assertEquals(t0 + 60_000, a.overAt)
        assertEquals(0, a.leftMs(t0))
        assertSame(a, RestClock.finish(a, t0 + 70_000))   // a second alarm or a double tap
        assertFalse(a.running(t0))
        assertFalse(a.due(t0 + 999_999))
    }

    @Test fun alarmDecides() {
        val r = RestClock.start(t0, 60, "Row", 1)
        assertEquals(RestClock.Fire.END, RestClock.onAlarm(r, t0 + 60_000))
        assertEquals(RestClock.Fire.END, RestClock.onAlarm(r, t0 + 59_700))    // within the slack
        assertEquals(RestClock.Fire.REARM, RestClock.onAlarm(RestClock.add(r, t0 + 50_000, 15), t0 + 60_000))
        assertEquals(RestClock.Fire.NOTHING, RestClock.onAlarm(RestClock.finish(r, t0 + 10_000), t0 + 60_000))
        assertEquals(RestClock.Fire.NOTHING, RestClock.onAlarm(null, t0))
    }

    @Test fun linesForTheNotification() {
        val r = RestClock.start(t0, 60, "Bench press", 3, 5)
        assertEquals("Bench press · set 3 of 5 done", r.doneLine())
        assertEquals("Bench press · set 4 of 5", r.nextLine())
        val noOf = RestClock.start(t0, 60, "Dips", 2)
        assertEquals("Dips · set 2 done", noOf.doneLine())
        assertEquals("Dips · set 3", noOf.nextLine())
        val bare = RestClock.start(t0, 60, "", 0)
        assertEquals("Rest", bare.doneLine())
        assertEquals("Next set", bare.nextLine())
    }

    @Test fun encodeDecodeRoundTrip() {
        val r = RestClock.add(RestClock.start(t0, 75, "Pull up", 4, 4, "id-9", sound = false), t0 + 10_000, 15)!!
        assertEquals(r, RestClock.decode(RestClock.encode(r)))
        val over = RestClock.finish(r, t0 + 90_000)
        assertEquals(over, RestClock.decode(RestClock.encode(over)))
        assertNull(RestClock.decode(RestClock.encode(null)))
        assertNull(RestClock.decode(null))
        assertNull(RestClock.decode("2\u001Fjunk"))
        assertNull(RestClock.decode("1\u001Fa\u001Fb\u001Fx\u001F1\u001F1\u001F1\u001F1\u001F1\u001F0\u001F0"))
    }

    @Test fun separatorInsideANameCannotBreakTheRecord() {
        val r = RestClock.start(t0, 60, "Odd\u001Fname", 1)
        val back = RestClock.decode(RestClock.encode(r))!!
        assertEquals("Odd name", back.exercise)
        assertEquals(r.endsAt, back.endsAt)
    }
}
