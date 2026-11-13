package com.cincee.ps.gos

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The gym reminder's timing on the phone (GymClock.kt): FICTIONAL days, gym at 08:00 Dubai (04:00 UTC). */
class GymClockTest {
    private val day = "2026-11-03"
    private val gym = java.time.Instant.parse("2026-11-03T04:00:00Z").toEpochMilli()
    private val gym2 = gym + 86_400_000L
    private fun hm(h: Int, m: Int, s: Int = 0) = gym + ((h - 8) * 3600 + m * 60 + s) * 1000L
    private fun plan(acked: List<String> = emptyList(), on: Boolean = true) = GymClock.from(JSONObject()
        .put("on", on).put("time", "08:00")
        .put("items", JSONArray().put(JSONObject().put("day", day).put("at", gym)).put(JSONObject().put("day", "2026-11-04").put("at", gym2)))
        .put("acked", JSONArray(acked)).put("before", JSONArray(listOf(120, 60, 30, 10))).put("ring", 16).put("grace", 120_000))

    @Test fun theDaysStepsAndTheRingAtMinus16() {
        val s = GymClock.steps(plan()).filter { it.day == day }
        assertEquals(listOf(120, 60, 30, 16, 10), s.map { it.mins })
        assertEquals(hm(7, 44), s.first { it.ring }.due)
        assertEquals(listOf(false, false, false, true, false), s.map { it.ring })
    }

    @Test fun eachStepFiresOnTimeOnce() {
        val p = plan()
        assertEquals(listOf("$day:120"), GymClock.dueNow(p, hm(6, 0, 5), emptySet()).map { it.id })
        assertEquals(emptyList<String>(), GymClock.dueNow(p, hm(6, 0, 5), setOf("$day:120")).map { it.id })
        val ring = GymClock.dueNow(p, hm(7, 44, 1), setOf("$day:120", "$day:60", "$day:30"))
        assertEquals(listOf("$day:16"), ring.map { it.id })
        assertTrue(ring[0].ring)
    }

    @Test fun theNextAlarmIsTheNextStep() {
        val p = plan()
        assertEquals(hm(6, 0), GymClock.next(p, hm(5, 0), emptySet())!!.due)
        assertEquals(hm(7, 44), GymClock.next(p, hm(7, 31), setOf("$day:120", "$day:60", "$day:30"))!!.due)
        assertEquals(hm(7, 50), GymClock.next(p, hm(7, 45), setOf("$day:120", "$day:60", "$day:30", "$day:16"))!!.due)
    }

    @Test fun aPhoneOffThroughTwoStepsFiresNothingStale() {
        // Off from 05:50 to 07:10: the 06:00 and 07:00 reminders are gone, nothing piles up.
        assertTrue(GymClock.dueNow(plan(), hm(7, 10), emptySet()).isEmpty())
        assertEquals(hm(7, 30), GymClock.next(plan(), hm(7, 10), emptySet())!!.due)
    }

    @Test fun theRingMayStartUpToFiveMinutesLateButNotLater() {
        val f = setOf("$day:120", "$day:60", "$day:30")
        assertEquals(listOf("$day:16"), GymClock.dueNow(plan(), hm(7, 48), f).map { it.id })
        assertTrue(GymClock.dueNow(plan(), hm(7, 49, 30), f).isEmpty())
    }

    @Test fun aNotificationTwoMinutesLateIsSkipped() {
        assertEquals(1, GymClock.dueNow(plan(), hm(7, 1, 30), emptySet()).size)
        assertTrue(GymClock.dueNow(plan(), hm(7, 2, 30), emptySet()).isEmpty())
    }

    @Test fun acknowledgedAnywhereTheDayIsQuiet() {
        assertTrue(GymClock.steps(plan(acked = listOf(day))).none { it.day == day })
        assertTrue(GymClock.steps(plan(), localAcked = setOf(day)).none { it.day == day })
        assertEquals("2026-11-04", GymClock.next(plan(acked = listOf(day)), hm(7, 0), emptySet())!!.day)
    }

    // The developer, 2 Nov 2026: 1) the 07:44 ring stops by itself after 10 minutes and leaves a missed notification,
    // Acknowledge stops it at any time; 2) it rings through PS Do Not Disturb; 3) Later: 5 minutes, then again.
    private val r0 = GymRing(day, gym, hm(7, 44))

    @Test fun theRingStopsByItselfAfterTenMinutesAsMissed() {
        assertEquals(RingNow.RINGING, GymClock.ringNow(r0, plan(), hm(7, 44, 1), emptySet()))
        assertEquals(RingNow.RINGING, GymClock.ringNow(r0, plan(), hm(7, 53, 59), emptySet()))
        assertEquals(RingNow.MISSED, GymClock.ringNow(r0, plan(), hm(7, 54), emptySet()))
        assertEquals(hm(7, 54), GymClock.ringWake(r0))   // the alarm that ends it, even if the service died
        assertEquals(RingNow.NONE, GymClock.ringNow(null, plan(), hm(7, 54), emptySet()))
    }

    @Test fun acknowledgeStopsItAtAnyTime() {
        for (t in listOf(hm(7, 44, 1), hm(7, 50), hm(7, 53, 59))) {
            assertEquals(RingNow.DONE, GymClock.ringNow(r0, plan(acked = listOf(day)), t, emptySet()))   // the Mac's Acknowledge
            assertEquals(RingNow.DONE, GymClock.ringNow(r0, plan(), t, setOf(day)))                      // this phone's
        }
        val snoozed = GymClock.later(r0, hm(7, 46))
        assertEquals(RingNow.DONE, GymClock.ringNow(snoozed, plan(), hm(7, 48), setOf(day)))             // while Later waits
        assertEquals(RingNow.DONE, GymClock.ringNow(r0, plan(on = false), hm(7, 50), emptySet()))        // switched off
    }

    @Test fun laterIsQuietFiveMinutesThenRingsAgain() {
        val s = GymClock.later(r0, hm(7, 46))
        assertEquals(hm(7, 51), s.snoozeAt)
        assertEquals(RingNow.SNOOZED, GymClock.ringNow(s, plan(), hm(7, 50, 59), emptySet()))
        assertEquals(hm(7, 51), GymClock.ringWake(s))     // armed as an alarm clock
        assertEquals(RingNow.AGAIN, GymClock.ringNow(s, plan(), hm(7, 51), emptySet()))
        val again = GymClock.again(s, hm(7, 51))
        assertEquals(RingNow.RINGING, GymClock.ringNow(again, plan(), hm(7, 51, 1), emptySet()))
        assertEquals(0L, again.snoozeAt)
    }

    @Test fun eachSnoozedRingAlsoStopsAfterTenMinutes() {
        // Later at 07:46, rings again 07:51, ignored: stops at 08:01 as missed. Later twice works the same.
        val again = GymClock.again(GymClock.later(r0, hm(7, 46)), hm(7, 51))
        assertEquals(RingNow.RINGING, GymClock.ringNow(again, plan(), hm(8, 0, 59), emptySet()))
        assertEquals(RingNow.MISSED, GymClock.ringNow(again, plan(), hm(8, 1), emptySet()))
        assertEquals(hm(8, 1), GymClock.ringWake(again))
        val third = GymClock.again(GymClock.later(again, hm(7, 55)), hm(8, 0))
        assertEquals(RingNow.RINGING, GymClock.ringNow(third, plan(), hm(8, 9), emptySet()))
        assertEquals(RingNow.MISSED, GymClock.ringNow(third, plan(), hm(8, 10), emptySet()))
    }

    @Test fun laterSleptThroughIsMissedNotRungLate() {
        val s = GymClock.later(r0, hm(7, 46))   // due 07:51; the phone was off until 08:30
        assertEquals(RingNow.AGAIN, GymClock.ringNow(s, plan(), hm(7, 55), emptySet()))
        assertEquals(RingNow.MISSED, GymClock.ringNow(s, plan(), hm(7, 56), emptySet()))
    }

    @Test fun theRingRingsThroughPsDoNotDisturb() {
        // PS DND lives in Notifier.kt (Dnd). The ring and its notices never ask it: it is an alarm. The code
        // (comments out) of Gym.kt must not mention Dnd, and the ring plays on the alarm stream.
        val src = java.io.File("src/main/java/com/cincee/ps/gos/Gym.kt").readText()
        val code = src.replace(Regex("""/\*[\s\S]*?\*/"""), "").replace(Regex("""//.*"""), "")
        assertFalse(code.contains("Dnd"))
        assertTrue(code.contains("AudioAttributes.USAGE_ALARM"))
        assertTrue(code.contains("Notification.CATEGORY_ALARM"))
    }

    @Test fun offMeansNothing() {
        assertTrue(GymClock.steps(plan(on = false)).isEmpty())
        assertNull(GymClock.next(plan(on = false), hm(5, 0), emptySet()))
    }

    @Test fun brokenPlansAreSafe() {
        assertNull(GymClock.parse("not json"))
        assertNull(GymClock.parse(null))
        val p = GymClock.from(JSONObject().put("on", true).put("time", "99:99").put("items", JSONArray().put(JSONObject().put("day", "x").put("at", 5))))
        assertEquals("08:00", p.time)
        assertTrue(p.items.isEmpty())
        assertEquals(listOf(120, 60, 30, 10), p.before)
    }

    @Test fun roundTrip() {
        val p = plan(acked = listOf("2026-11-02"))
        assertEquals(p, GymClock.from(GymClock.toJson(p)))
    }

    @Test fun firedIdsArePruned() {
        assertEquals(setOf("2026-11-02:10", "$day:120"), GymClock.prune(setOf("2026-11-01:60", "2026-11-02:10", "$day:120"), day))
    }

    @Test fun titles() {
        assertEquals("Gym in 2 h", GymClock.title(gym, hm(6, 0)))
        assertEquals("Gym in 16 min", GymClock.title(gym, hm(7, 44)))
        assertEquals("Gym in 1 h 20 min", GymClock.title(gym, hm(6, 40)))
        assertEquals("Gym time", GymClock.title(gym, hm(8, 1)))
    }
}
