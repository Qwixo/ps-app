package com.cincee.ps.gos

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.OffsetDateTime
import java.time.ZoneId

/**
 * The Annoying 15 min reminder's timing on the phone (RemClock.kt). The same cases and numbers as web
 * tests/remind.test.ts, plus New York's fall back day. FICTIONAL days only.
 */
class RemClockTest {
    private val TB = ZoneId.of("Asia/Dubai")
    private val NY = ZoneId.of("America/New_York")
    private fun tb(day: String, hm: String) = OffsetDateTime.parse("${day}T$hm:00+04:00").toInstant().toEpochMilli()
    private fun utc(s: String) = java.time.Instant.parse(s).toEpochMilli()
    private fun rem(at: String = "09:00", until: String = "21:00", tz: String = "", days: List<Int> = (0..6).toList(), on: Boolean = true,
                    snooze: Int = 15, done: String = "", snoozeUntil: Long = 0, stateAt: Long = 0, click: Boolean = false, word: String = "Yes") =
        RemItem("abc", on, "Reminder 2", "HAVE YOU DONE IT YET?", at, until, days, tz, snooze, "Remind me in $snooze mins", "Yes", word, click,
            "#28121e", "#ec4e86", "#ffffff", "none", 0.8, done, snoozeUntil, stateAt)

    // ---------- V1.55: reminders on tasks (web tests/taskremind.test.ts) ----------
    @Test fun onceOnlyOnItsDayNeverTheWeekAfter() {
        val r = rem("09:00", "12:00", "Asia/Dubai", days = emptyList()).copy(task = "0b7e6c1a-1111", date = "2026-11-12", open = "Open task")
        assertEquals(RemStatus.SHOW, RemClock.status(r, tb("2026-11-12", "10:00"), NY))
        assertEquals(RemStatus.CLOSED, RemClock.status(r, tb("2026-11-19", "10:00"), NY))
        assertEquals(tb("2026-11-12", "09:00"), RemClock.nextStart(r, tb("2026-11-12", "08:00"), NY))
        assertEquals(0L, RemClock.nextStart(r, tb("2026-11-12", "10:00"), NY))
        assertEquals(RemStatus.DONE, RemClock.status(r.copy(done = "2026-11-12"), tb("2026-11-12", "10:00"), NY))
    }

    @Test fun oncePastMidnightIsStillThatDaysWindow() {
        val r = rem("23:00", "01:00", "Asia/Dubai").copy(task = "t", date = "2026-11-12")
        assertEquals(RemStatus.SHOW, RemClock.status(r, tb("2026-11-13", "00:30"), NY))
        assertEquals(RemStatus.CLOSED, RemClock.status(r, tb("2026-11-13", "23:30"), NY))
    }

    @Test fun planKeepsTheTaskItsDayAndOpenTaskAndRoomFor80() {
        val items = RemClock.parse(JSONObject().put("items", JSONArray()
            .put(JSONObject().put("id", "t1").put("at", "09:00").put("until", "12:00").put("task", "0b7e6c1a-1111-4c2d").put("date", "2026-11-12").put("open", "Open task"))
            .put(JSONObject().put("id", "t2").put("at", "09:00").put("until", "12:00").put("task", "bad id!").put("date", "2026-11-12").put("open", "Open task"))
            .put(JSONObject().put("id", "t3").put("at", "09:00").put("until", "12:00").put("date", "2026-11-12"))))
        assertEquals("0b7e6c1a-1111-4c2d", items[0].task); assertEquals("2026-11-12", items[0].date); assertEquals("Open task", items[0].open)
        assertEquals("", items[1].task); assertEquals("", items[1].date); assertEquals("", items[1].open)
        assertEquals("", items[2].date)
        assertEquals(items[0], RemClock.parseList(RemClock.listJson(items).toString())[0])   // kept in prefs and read back the same
        val many = JSONArray(); for (i in 0 until 100) many.put(JSONObject().put("id", "x$i").put("at", "09:00").put("until", "10:00"))
        assertEquals(80, RemClock.parse(JSONObject().put("items", many)).size)
    }

    // ---------- the schedule ----------
    @Test fun dubaiWindowOpensAt0200AndClosesAt0600() {
        val r = rem("02:00", "06:00", "Asia/Dubai")
        assertEquals(RemStatus.CLOSED, RemClock.status(r, tb("2026-11-10", "01:59"), NY))
        assertEquals(RemStatus.SHOW, RemClock.status(r, tb("2026-11-10", "02:00"), NY))
        assertEquals(RemStatus.SHOW, RemClock.status(r, tb("2026-11-10", "05:59"), NY))
        assertEquals(RemStatus.CLOSED, RemClock.status(r, tb("2026-11-10", "06:00"), NY))
    }

    @Test fun beforeTheStartTimeItIsTheDayBefores() {
        val r = rem("02:00", "06:00", "Asia/Dubai")
        assertEquals("2026-11-09", RemClock.cycleDay(r, tb("2026-11-10", "01:30"), NY))
        assertEquals("2026-11-10", RemClock.cycleDay(r, tb("2026-11-10", "02:00"), NY))
    }

    @Test fun aWindowPastMidnightBelongsToTheDayItStartedOnItsPickedDaysOnly() {
        val r = rem("22:00", "02:00", "Asia/Dubai", days = listOf(1))   // Monday nights only (2026-11-09 is a Monday)
        assertEquals(1, RemClock.weekdayOf("2026-11-09"))
        assertEquals(0, RemClock.weekdayOf("2026-11-08"))
        assertEquals(RemStatus.CLOSED, RemClock.status(r, tb("2026-11-09", "21:59"), NY))
        assertEquals(RemStatus.SHOW, RemClock.status(r, tb("2026-11-09", "23:00"), NY))
        assertEquals(RemStatus.SHOW, RemClock.status(r, tb("2026-11-10", "01:00"), NY))      // Tuesday 01:00 is still Monday's
        assertEquals(RemStatus.CLOSED, RemClock.status(r, tb("2026-11-10", "02:00"), NY))
        assertEquals(RemStatus.CLOSED, RemClock.status(r, tb("2026-11-10", "23:00"), NY))    // Tuesday night: not picked
        assertEquals("2026-11-09", RemClock.openWindow(r, tb("2026-11-10", "01:00"), NY)?.day)
    }

    @Test fun weekdaysLeaveSaturdayAndSundayQuiet() {
        val r = rem("09:00", "21:00", "Asia/Dubai", days = listOf(1, 2, 3, 4, 5))
        assertEquals(RemStatus.CLOSED, RemClock.status(r, tb("2026-11-14", "12:00"), NY))   // Saturday
        assertEquals(RemStatus.SHOW, RemClock.status(r, tb("2026-11-13", "12:00"), NY))     // Friday
        assertEquals(tb("2026-11-16", "09:00"), RemClock.nextStart(r, tb("2026-11-14", "12:00"), NY))   // Monday 09:00
        assertEquals(0L, RemClock.nextStart(rem(days = emptyList()), tb("2026-11-14", "12:00"), NY))
    }

    @Test fun noZoneIsThePhonesOwnAZoneSetIsThatZoneWhereverThePhoneIs() {
        val local = rem("09:00", "10:00", "")
        val nine = OffsetDateTime.parse("2026-11-10T09:30:00-05:00").toInstant().toEpochMilli()   // 09:30 in New York, 18:30 in the developer's city
        assertEquals(RemStatus.SHOW, RemClock.status(local, nine, NY))
        assertEquals(RemStatus.CLOSED, RemClock.status(local, nine, TB))
        val fixed = rem("18:00", "19:00", "Asia/Dubai")
        assertEquals(RemStatus.SHOW, RemClock.status(fixed, nine, NY))
        assertEquals(RemStatus.SHOW, RemClock.status(fixed, nine, ZoneId.of("Europe/London")))
    }

    // ---------- New York's daylight saving: the page's numbers (tz.ts zonedToTs), checked with node ----------
    @Test fun newYorkFallBackDay() {
        // 01:30 happens twice on 1 Nov 2026: the first one (EDT, 05:30 UTC); 03:00 is EST (08:00 UTC). 2.5 hours long.
        val a = rem("01:30", "03:00", "America/New_York")
        assertEquals(RemWindow("2026-11-01", utc("2026-11-01T05:30:00Z"), utc("2026-11-01T08:00:00Z")), RemClock.windowOn(a, "2026-11-01", TB))
        // The second 01:10 (EST, 06:10 UTC) reads as before 01:30: the day before's window, as on the page and the Mac.
        assertEquals("2026-10-31", RemClock.cycleDay(a, utc("2026-11-01T06:10:00Z"), TB))
        assertEquals(RemStatus.SHOW, RemClock.status(a, utc("2026-11-01T05:45:00Z"), TB))
        assertEquals(RemStatus.CLOSED, RemClock.status(a, utc("2026-11-01T06:10:00Z"), TB))
        // 22:00 to 02:00 in the phone's own zone over the change: 5 hours that night, the next one starts at EST.
        val b = rem("22:00", "02:00", "")
        assertEquals(RemWindow("2026-10-31", utc("2026-11-01T02:00:00Z"), utc("2026-11-01T07:00:00Z")), RemClock.windowOn(b, "2026-10-31", NY))
        assertEquals(utc("2026-11-01T02:00:00Z"), RemClock.nextStart(b, utc("2026-10-31T12:00:00Z"), NY))
        assertEquals(utc("2026-11-02T03:00:00Z"), RemClock.nextStart(b, utc("2026-11-01T12:00:00Z"), NY))
        assertEquals(RemStatus.SHOW, RemClock.status(b, utc("2026-11-01T06:30:00Z"), NY))    // 01:30 EST, in its last hour
        assertEquals(RemStatus.CLOSED, RemClock.status(b, utc("2026-11-01T07:00:00Z"), NY))
        // Sunday 09:00 to 17:00 New York on the change day: EST all day.
        val d = rem("09:00", "17:00", "America/New_York", days = listOf(0))
        assertEquals(RemWindow("2026-11-01", utc("2026-11-01T14:00:00Z"), utc("2026-11-01T22:00:00Z")), RemClock.windowOn(d, "2026-11-01", TB))
    }

    @Test fun aStartTimeThatDoesNotExistLandsWhereThePageSaysSo() {
        // 02:30 on 8 Mar 2026 is skipped in New York; tz.ts zonedToTs puts it at 06:30 UTC (the page and the Mac agree).
        val c = rem("02:30", "04:00", "America/New_York")
        assertEquals(RemWindow("2026-03-08", utc("2026-03-08T06:30:00Z"), utc("2026-03-08T08:00:00Z")), RemClock.windowOn(c, "2026-03-08", TB))
    }

    @Test fun dubaiHasNoDaylightSaving() {
        val r = rem("02:00", "06:00", "Asia/Dubai")
        assertEquals(RemWindow("2026-11-01", utc("2026-10-31T22:00:00Z"), utc("2026-11-01T02:00:00Z")), RemClock.windowOn(r, "2026-11-01", NY))
        assertEquals(RemWindow("2026-03-08", utc("2026-03-07T22:00:00Z"), utc("2026-03-08T02:00:00Z")), RemClock.windowOn(r, "2026-03-08", NY))
    }

    // ---------- done and snooze ----------
    @Test fun doneIsForThatWindowOnly() {
        val r = rem("02:00", "06:00", "Asia/Dubai", done = "2026-11-10", stateAt = 1)
        assertEquals(RemStatus.DONE, RemClock.status(r, tb("2026-11-10", "03:00"), NY))
        assertEquals(RemStatus.DONE, RemClock.status(r, tb("2026-11-11", "01:59"), NY))   // still that window's day
        assertEquals(RemStatus.SHOW, RemClock.status(r, tb("2026-11-11", "02:00"), NY))   // the next window comes up again
        assertEquals(RemStatus.OFF, RemClock.status(r.copy(on = false), tb("2026-11-11", "02:00"), NY))
    }

    @Test fun snoozeWithinTheWindowComesBack() {
        val r = rem("02:00", "06:00", "Asia/Dubai")
        val s = RemClock.merge(r, RemClock.snoozeAct(r, tb("2026-11-10", "03:00")))
        assertEquals(tb("2026-11-10", "03:15"), s.snoozeUntil)
        assertEquals(RemStatus.SNOOZED, RemClock.status(s, tb("2026-11-10", "03:14"), NY))
        assertEquals(RemStatus.SHOW, RemClock.status(s, tb("2026-11-10", "03:15"), NY))
        assertEquals(tb("2026-11-10", "03:15"), RemClock.nextWake(s, tb("2026-11-10", "03:01"), NY))
    }

    @Test fun snoozePastTheWindowEndDoesNotBringItBack() {
        val r = rem("02:00", "06:00", "Asia/Dubai")
        val s = RemClock.merge(r, RemClock.snoozeAct(r, tb("2026-11-10", "05:50")))
        assertEquals(tb("2026-11-10", "06:05"), s.snoozeUntil)
        assertEquals(RemStatus.SNOOZED, RemClock.status(s, tb("2026-11-10", "05:55"), NY))
        assertEquals(tb("2026-11-10", "06:00"), RemClock.nextWake(s, tb("2026-11-10", "05:55"), NY))   // the window's end first
        assertEquals(RemStatus.CLOSED, RemClock.status(s, tb("2026-11-10", "06:05"), NY))
        assertEquals(tb("2026-11-11", "02:00"), RemClock.nextWake(s, tb("2026-11-10", "06:05"), NY))
    }

    @Test fun theNextWakeAndTheOneAlarm() {
        val r = rem("02:00", "06:00", "Asia/Dubai")
        assertEquals(tb("2026-11-10", "02:00"), RemClock.nextWake(r, tb("2026-11-10", "01:00"), NY))
        assertEquals(tb("2026-11-10", "06:00"), RemClock.nextWake(r, tb("2026-11-10", "03:00"), NY))
        assertEquals(0L, RemClock.nextWake(r.copy(on = false), tb("2026-11-10", "03:00"), NY))
        val other = rem("09:00", "21:00", "Asia/Dubai").copy(id = "def")
        assertEquals(tb("2026-11-10", "06:00"), RemClock.soonest(listOf(r, other), tb("2026-11-10", "03:00"), NY))
        assertEquals(tb("2026-11-10", "09:00"), RemClock.soonest(listOf(r, other), tb("2026-11-10", "06:00"), NY))
        assertEquals(0L, RemClock.soonest(emptyList(), tb("2026-11-10", "06:00"), NY))
    }

    @Test fun confirmsTheWordInAnyCaseOrOneTap() {
        val r = rem(word = "Done")
        assertTrue(RemClock.confirms(r, "  done "))
        assertTrue(RemClock.confirms(r, "DONE"))
        assertFalse(RemClock.confirms(r, "yes"))
        assertFalse(RemClock.confirms(r, null))
        assertTrue(RemClock.confirms(r.copy(click = true), null))
    }

    // ---------- the plan ----------
    @Test fun aBrokenItemIsSkippedNeverThePlan() {
        val good = JSONObject().put("id", "fu").put("on", true).put("pill", "Daily reminder").put("text", "HAVE YOU RAN FOLLOW UP SYSTEM YET?")
            .put("at", "02:00").put("until", "06:00").put("days", JSONArray(listOf(0, 1, 2, 3, 4, 5, 6))).put("tz", "Asia/Dubai")
            .put("snooze", 15).put("later", "Remind me in 15 mins").put("yes", "Yes").put("word", "Yes").put("click", false)
            .put("bg", "#28121E").put("accent", "#ec4e86").put("ink", "#ffffff").put("sound", "soft").put("vol", 0.8)
            .put("done", "2026-11-09").put("snoozeUntil", 0).put("stateAt", 1700)
        val plan = JSONObject().put("v", 1).put("items", JSONArray()
            .put(good)
            .put(JSONObject().put("id", "BAD!").put("at", "09:00").put("until", "10:00"))                 // bad id
            .put(JSONObject().put("id", "late").put("at", "25:00").put("until", "10:00"))                 // bad start
            .put("not an item")
            .put(JSONObject(good.toString()).put("text", "a second fu"))                                    // the same id again
            .put(JSONObject().put("id", "bare").put("at", "09:00").put("until", "21:00").put("days", JSONArray(listOf(1, 9, "x", 3)))
                .put("tz", "Not/AZone").put("snooze", 999).put("vol", "loud").put("sound", "trumpet").put("bg", "pink").put("done", "yesterday")))
        val items = RemClock.parse(plan)
        assertEquals(listOf("fu", "bare"), items.map { it.id })
        val fu = items[0]
        assertEquals("Asia/Dubai", fu.tz); assertEquals("#28121e", fu.bg); assertEquals("soft", fu.sound)
        assertEquals("2026-11-09", fu.done); assertEquals(1700L, fu.stateAt); assertEquals("HAVE YOU RAN FOLLOW UP SYSTEM YET?", fu.text)
        val bare = items[1]
        assertEquals(listOf(1, 3), bare.days); assertEquals("", bare.tz); assertEquals(240, bare.snooze); assertEquals(0.8, bare.vol, 0.0)
        assertEquals("none", bare.sound); assertEquals(RemClock.BG, bare.bg); assertEquals("", bare.done)
        assertEquals("Yes", bare.yes); assertEquals("Yes", bare.word); assertEquals("Remind me in 240 mins", bare.later); assertTrue(bare.on)
        // Kept and read back the same; nothing at all for a plan that is not one.
        assertEquals(items, RemClock.parseList(RemClock.listJson(items).toString()))
        assertEquals(emptyList<RemItem>(), RemClock.parse(JSONObject().put("items", "nope")))
        assertEquals(emptyList<RemItem>(), RemClock.parse(null))
        assertEquals(emptyList<RemItem>(), RemClock.parseList("{broken"))
    }

    // ---------- this phone's answer and the plan's state ----------
    @Test fun aLocalAnswerWinsOverAnOlderPlanStateOnly() {
        val r = rem("02:00", "06:00", "Asia/Dubai")
        val now = tb("2026-11-10", "03:00")
        val done = RemClock.doneAct(r, now, NY)
        assertEquals("2026-11-10", done.day)
        // The plan has not heard of it yet (older state): the answer stands, the notification stays away.
        val older = r.copy(snoozeUntil = now - 60_000, stateAt = now - 3_600_000)
        val m = RemClock.merge(older, done)
        assertEquals("2026-11-10", m.done); assertEquals(0L, m.snoozeUntil); assertEquals(now, m.stateAt)
        assertEquals(RemStatus.DONE, RemClock.status(m, now + 60_000, NY))
        // The plan is newer (the Mac snoozed it after): the plan wins.
        val newer = r.copy(snoozeUntil = now + 900_000, stateAt = now + 1)
        assertEquals(newer, RemClock.merge(newer, done))
        // The plan has it (the same time): the plan, and the answer is no longer kept.
        val same = r.copy(done = "2026-11-10", stateAt = now)
        assertEquals(same, RemClock.merge(same, done))
        assertEquals(emptyMap<String, RemAnswer>(), RemClock.keepAnswers(listOf(same), mapOf("abc" to done)))
        assertEquals(mapOf("abc" to done), RemClock.keepAnswers(listOf(older), mapOf("abc" to done)))
        assertEquals(emptyMap<String, RemAnswer>(), RemClock.keepAnswers(emptyList(), mapOf("abc" to done)))   // removed from the list
        // A snooze keeps the window's done day (remind.ts applyAct).
        val sn = RemClock.merge(r.copy(done = "2026-11-09", stateAt = 5), RemClock.snoozeAct(r, now))
        assertEquals("2026-11-09", sn.done); assertEquals(now + 900_000, sn.snoozeUntil)
        // Another reminder's answer never touches this one.
        assertEquals(r, RemClock.merge(r, done.copy(id = "zzz")))
    }

    @Test fun answersToThePageAndInPrefs() {
        val r = rem("02:00", "06:00", "Asia/Dubai")
        val now = tb("2026-11-10", "03:00")
        val d = RemClock.actJson(RemClock.doneAct(r, now, NY))
        assertEquals("remAct", d.getString("type")); assertEquals("abc", d.getString("id")); assertEquals("done", d.getString("act"))
        assertEquals("2026-11-10", d.getString("day")); assertEquals(now, d.getLong("at")); assertEquals("phone", d.getString("by")); assertFalse(d.has("until"))
        val s = RemClock.actJson(RemClock.snoozeAct(r, now))
        assertEquals("snooze", s.getString("act")); assertEquals(now + 15 * 60_000L, s.getLong("until")); assertFalse(s.has("day"))
        val kept = mapOf("abc" to RemClock.doneAct(r, now, NY), "def" to RemClock.snoozeAct(r.copy(id = "def"), now))
        assertEquals(kept, RemClock.answersFrom(RemClock.answersJson(kept).toString()))
        assertEquals(emptyMap<String, RemAnswer>(), RemClock.answersFrom("{\"abc\":{\"id\":\"abc\",\"act\":\"maybe\",\"at\":5}}"))
        assertNull(RemClock.answerFrom(JSONObject().put("id", "abc").put("act", "done").put("day", "soon").put("at", 5)))
    }

    // ---------- the built in sounds (alarmsound.ts) ----------
    @Test fun builtInSoundsAreOneLoopAtTheOneLevelAsAWav() {
        for ((kind, secs) in listOf("soft" to 2.6, "alarm" to 1.3)) {
            val x = RemTones.builtIn(kind)
            assertEquals(Math.round(secs * RemTones.RATE).toInt(), x.size)
            val db = 20 * Math.log10(RemTones.loudestOf(x, RemTones.RATE))
            assertTrue("$kind at $db dB", db > -12.5 && db < -11.5)
            assertTrue(x.all { Math.abs(it) < 1f })
            val wav = RemTones.wavBytes(x)
            assertEquals(44 + x.size * 2, wav.size)
            assertTrue(SleepClock.okOwnWav(wav))
        }
    }
}
