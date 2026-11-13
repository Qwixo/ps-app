package com.cincee.ps.gos

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Sleep mode's timing on the phone (SleepClock.kt): FICTIONAL times, a day sleep from 07:10 Dubai. */
class SleepClockTest {
    private val since = java.time.Instant.parse("2026-11-08T03:10:00Z").toEpochMilli()
    private val a1 = java.time.Instant.parse("2026-11-08T10:30:00Z").toEpochMilli()   // 14:30
    private val a2 = a1 + 30 * 60_000L
    private fun plan(details: Boolean = false, squad: Int? = null) = SleepClock.from(JSONObject()
        .put("v", 1).put("since", since)
        .put("rings", JSONArray().put(JSONObject().put("id", "b").put("at", a2).put("label", "15:00")).put(JSONObject().put("id", "a").put("at", a1).put("label", "14:30")))
        .put("wake", a1).put("panel", a1 - 30 * 60_000L).put("details", details)
        .put("tasks", JSONObject().put("count", 2).put("titles", JSONArray(listOf("Fictional task one", "Fictional task two"))))
        .put("squad", squad ?: JSONObject.NULL)
        .put("words", JSONObject().put("wakeUp", "Wake up").put("squad", JSONObject.NULL)))!!

    @Test fun parsesAndSortsTheRings() {
        val p = plan()
        assertEquals(listOf("14:30", "15:00"), p.rings.map { it.label })
        assertEquals(since, p.since)
        assertEquals("Wake up", p.word("wakeUp", "x"))
        assertEquals("fallback", p.word("squad", "fallback"))
    }

    @Test fun countsOnlyUnlessFullDetailsIsOn() {
        assertEquals(emptyList<String>(), plan(details = false).titles)
        assertEquals(2, plan(details = false).count)
        assertEquals(listOf("Fictional task one", "Fictional task two"), plan(details = true).titles)
    }

    @Test fun theSquadIsNullWithoutASquad() {
        assertNull(plan().squad)
        assertEquals(3, plan(squad = 3).squad)
    }

    @Test fun eachRingIsDueOnceForFiveMinutes() {
        val p = plan()
        assertNull(SleepClock.due(p, a1 - 1, emptySet()))
        assertEquals("a", SleepClock.due(p, a1, emptySet())!!.id)
        assertEquals("a", SleepClock.due(p, a1 + 4 * 60_000L, emptySet())!!.id)
        assertNull(SleepClock.due(p, a1 + 6 * 60_000L, emptySet()))
        assertNull(SleepClock.due(p, a1, setOf("a@$a1")))
        assertEquals("b", SleepClock.due(p, a2 + 1, setOf("a@$a1"))!!.id)
    }

    @Test fun theNextAlarmToArm() {
        val p = plan()
        assertEquals(a1, SleepClock.next(p, since, emptySet())!!.at)
        assertEquals(a2, SleepClock.next(p, a1 + 1000, setOf("a@$a1"))!!.at)
        assertNull(SleepClock.next(p, a2 + 10 * 60_000L, setOf("a@$a1")))
    }

    @Test fun aRingStopsItselfAfterTenMinutes() {
        assertTrue(SleepClock.ringing(a1, a1 + SleepClock.RING_FOR - 1))
        assertFalse(SleepClock.ringing(a1, a1 + SleepClock.RING_FOR))
        assertFalse(SleepClock.ringing(0, a1))
    }

    @Test fun thePanelRisesThirtyMinutesBefore() {
        val p = plan()
        assertFalse(SleepClock.panelUp(p, a1 - 31 * 60_000L, ringing = false, peek = false))
        assertTrue(SleepClock.panelUp(p, a1 - 30 * 60_000L, ringing = false, peek = false))
        assertTrue(SleepClock.panelUp(p, since, ringing = false, peek = true))
    }

    @Test fun powerOnceBringsTheClockBackTwiceKeepsItDark() {
        assertTrue(SleepClock.relaunch(since, 0, ringing = false))
        assertFalse(SleepClock.relaunch(since + 5_000, since, ringing = false))
        assertTrue(SleepClock.relaunch(since + 60_000, since, ringing = false))
        assertFalse(SleepClock.relaunch(since, 0, ringing = true))
    }

    @Test fun theWords() {
        assertEquals("Asleep for a moment", SleepClock.asleepFor(since, since + 30_000))
        assertEquals("Asleep for 12 min", SleepClock.asleepFor(since, since + 12 * 60_000L))
        assertEquals("Asleep for 7 h 05", SleepClock.asleepFor(since, since + (7 * 60 + 5) * 60_000L))
        assertEquals("Asleep for 7 h", SleepClock.asleepFor(since, since + 7 * 60 * 60_000L))
    }

    @Test fun theDriftStaysInsideSixPixels() {
        var t = 0L
        repeat(300) {
            val (x, y) = SleepClock.drift(t)
            assertTrue(Math.abs(x) <= 6 && Math.abs(y) <= 6)
            t += SleepClock.DRIFT_EVERY
        }
    }

    @Test fun aBadPlanIsRefused() {
        assertNull(SleepClock.parse("{}"))
        assertNull(SleepClock.parse("not json"))
        assertNull(SleepClock.parse(null))
    }

    @Test fun firedKeysOnlyFromThisSleep() {
        assertEquals(setOf("a@$a1"), SleepClock.prune(setOf("a@$a1", "old@1"), plan()))
    }

    @Test fun wakeUpNeverWaitsForeverOnTheUnlockPrompt() {
        assertTrue(SleepClock.UNLOCK_WAIT in 10_000L..60_000L)
        val src = java.io.File("src/main/java/com/cincee/ps/gos/Sleep.kt").readText()
        assertTrue(src.contains("override fun onDismissError() { end("))
        assertTrue(src.contains("SleepClock.UNLOCK_WAIT"))
        assertTrue(src.contains("Plog.i(\"sleep: \$name pressed"))
        assertFalse(Regex("[\u2013\u2014]").containsMatchIn(src))
    }

    // ---------- V1.42 Customise ----------
    @Test fun theLookFromThePageIsChecked() {
        assertEquals(SleepLook(), SleepClock.look(null))
        val l = SleepClock.look(JSONObject().put("size", 9999).put("font", "comic").put("h12", true).put("ink", "red").put("bright", 0.01)
            .put("bg", "#1A2B3C").put("pos", "top").put("show", JSONObject().put("date", true).put("squad", false).put("evil", true)).put("watch", "big"))
        assertEquals(300.0, l.size, 0.0); assertEquals("thin", l.font); assertTrue(l.h12); assertEquals(0xE7A35E, l.ink)
        assertEquals(0.1f, l.bright, 0.0001f); assertEquals(0x1A2B3C, l.bg); assertEquals("top", l.pos); assertEquals("big", l.watch)
        assertTrue(l.shows("date")); assertFalse(l.shows("squad")); assertTrue(l.shows("asleep")); assertNull(l.show["evil"])
        assertFalse(SleepLook().shows("date"))
    }
    @Test fun thePlanCarriesTheLook() {
        val j = JSONObject().put("since", since).put("look", JSONObject().put("font", "serif").put("watch", "off"))
        assertEquals("serif", SleepClock.from(j)!!.look.font)
        assertEquals(SleepLook(), plan().look)
    }
    @Test fun theClockWords() {
        assertEquals("19:05" to null, SleepClock.clockText(19, 5, 9, h12 = false, secs = false))
        assertEquals("7:05" to "PM", SleepClock.clockText(19, 5, 9, h12 = true, secs = false))
        assertEquals("19:05:09" to null, SleepClock.clockText(19, 5, 9, h12 = false, secs = true))
        assertEquals("12:30" to "AM", SleepClock.clockText(0, 30, 0, h12 = true, secs = false))
    }
    @Test fun theClockSizeFollowsTheSliderAndFits() {
        assertEquals(92f, SleepClock.clockSp(1000f, 100.0, 5), 0.01f)
        assertEquals(46f, SleepClock.clockSp(1000f, 50.0, 5), 0.01f)
        assertTrue(SleepClock.clockSp(390f, 300.0, 5) <= 390f * 0.94f / 3f + 0.01f)
        assertTrue(SleepClock.clockSp(390f, 300.0, 8) < SleepClock.clockSp(390f, 300.0, 5))
    }
    @Test fun theStopwatchKeepsTimeFromTimestamps() {
        var w = SleepWatch().toggled(1000)
        assertEquals(60_000L, w.ms(61_000))
        w = w.toggled(61_000)
        assertEquals(60_000L, w.ms(999_000))
        w = w.toggled(100_000)
        assertEquals(65_500L, w.ms(105_500))
        assertEquals("0:07", SleepClock.watchText(7_000)); assertEquals("12:34", SleepClock.watchText(754_000)); assertEquals("1:02:03", SleepClock.watchText(3_723_000))
    }
    @Test fun customiseGoesThroughTheSameUnlockAsWakeUp() {
        val src = java.io.File("src/main/java/com/cincee/ps/gos/Sleep.kt").readText()
        assertTrue(src.contains("unlockThen(\"Customise\") { Sleep.customise(applicationContext) }"))
        assertTrue(src.contains("unlockThen(\"Wake up\") { Sleep.woke(applicationContext) }"))
        assertTrue(src.contains("override fun onDismissError() { end("))
        assertTrue(java.io.File("src/main/java/com/cincee/ps/gos/Bridge.kt").readText().contains("\"sleep:customiseSeen\""))
        assertFalse(Regex("[\u2013\u2014]").containsMatchIn(src))
    }

    // ---------- V1.43: the unlock is a setting, and short breaks ----------
    @Test fun theUnlockIsOnUnlessThePageSwitchedItOff() {
        assertTrue(plan().lock)
        assertFalse(SleepClock.from(JSONObject().put("since", since).put("lock", false))!!.lock)
        assertTrue(SleepClock.from(JSONObject().put("since", since).put("lock", "no"))!!.lock)
    }
    @Test fun theBreaksStagesMatchThePage() {
        val u = a1
        assertEquals("running" to 0, SleepClock.breakStage(u, u - 1))
        assertEquals("ask" to 1, SleepClock.breakStage(u, u))
        assertEquals("ask" to 2, SleepClock.breakStage(u, u + 5 * 60_000L))
        assertEquals("ask" to 3, SleepClock.breakStage(u, u + 14 * 60_000L))
        assertEquals("end" to 3, SleepClock.breakStage(u, u + 15 * 60_000L))
        assertEquals("none" to 0, SleepClock.breakStage(0, u))
    }
    @Test fun theBreaksAlarmLooksAgainAtEachAsk() {
        val u = a1
        assertEquals(u, SleepClock.breakNext(u, u - 60_000))
        assertEquals(u + 5 * 60_000L, SleepClock.breakNext(u, u))
        assertEquals(u + 10 * 60_000L, SleepClock.breakNext(u, u + 6 * 60_000L))
        assertEquals(u + 15 * 60_000L, SleepClock.breakNext(u, u + 11 * 60_000L))
    }
    @Test fun breaksAreWiredEndToEnd() {
        val src = java.io.File("src/main/java/com/cincee/ps/gos/Sleep.kt").readText()
        assertTrue(src.contains("\"back\", \"more\", \"up\" -> Sleep.answerBreak"))
        assertTrue(src.contains("if (Sleep.plan(applicationContext)?.lock == false)"))
        assertTrue(src.contains("clearBreak(c)   // V1.43: back to sleep ends any break"))
        val bridge = java.io.File("src/main/java/com/cincee/ps/gos/Bridge.kt").readText()
        for (t in listOf("sleep:break", "sleep:breakEnd", "sleep:breakSeen")) assertTrue(t, bridge.contains("\"$t\""))
        assertFalse(Regex("[\u2013\u2014]").containsMatchIn(src))
    }

    // ---------- V1.43: fonts, "Wake me up in", wake styles (the same numbers as web core/sleepwake.ts) ----------
    @Test fun lookV143FontsWeightSpacingTextColourCountdown() {
        val l = SleepClock.look(JSONObject().put("font", "chalk").put("weight", 650).put("spacing", 99).put("ink", "#A1B2C3").put("text", "#f08cb6").put("show", JSONObject().put("count", true)))
        assertEquals("chalk", l.font); assertEquals(600, l.weight); assertEquals(40.0, l.spacing, 0.0); assertEquals(0xF08CB6, l.text); assertTrue(l.shows("count"))
        val bad = SleepClock.look(JSONObject().put("font", "comic").put("weight", 50).put("spacing", "x").put("ink", "#a1b2c3").put("text", "red"))
        assertEquals("thin", bad.font); assertEquals(0, bad.weight); assertEquals(0.0, bad.spacing, 0.0); assertEquals(0xA1B2C3, bad.text); assertFalse(bad.shows("count"))
        assertEquals(12, SleepClock.FONTS.size)
        assertTrue(SleepClock.clockSp(400f, 300.0, 5, 30.0) < SleepClock.clockSp(400f, 300.0, 5))
        // The three bundled font files are in the app, with their licences.
        for (f in listOf("Silkscreen-Regular.ttf", "PixelifySans-Variable.ttf", "GochiHand-Regular.ttf", "OFL-Silkscreen.txt", "OFL-PixelifySans.txt", "OFL-GochiHand.txt"))
            assertTrue(f, java.io.File("src/main/assets/fonts/$f").exists())
    }
    @Test fun wakeStylesStrobeOnlyWhenSwitchedOnSoundsRiseUnlessLoud() {
        assertEquals("white", SleepClock.style("strobe", false)); assertEquals("strobe", SleepClock.style("strobe", true)); assertEquals("chime", SleepClock.style("disco", true))
        // V1.44: every style starts at half or more and is full within 30 s (V1.43: 12 to 35%, up to 2 minutes).
        assertEquals(0.5, SleepClock.volume("chime", 0), 1e-9); assertEquals(0.75, SleepClock.volume("chime", 10_000), 1e-9); assertEquals(1.0, SleepClock.volume("chime", 600_000), 1e-9)
        for (st in SleepClock.STYLES.filter { it != "light" }) { assertTrue(st, SleepClock.volume(st, 0) >= 0.5); assertEquals(st, 1.0, SleepClock.volume(st, 30_000), 1e-9) }
        assertEquals(1.0, SleepClock.volume("loud", 0), 0.0); assertEquals(0.0, SleepClock.volume("light", 60_000), 0.0)
        assertEquals(listOf("loud"), SleepClock.STYLES.filter { SleepClock.spec(it).loud })
        assertEquals(listOf("white", "strobe"), SleepClock.STYLES.filter { SleepClock.spec(it).bright })
    }
    @Test fun wakeLightSunrisePulseAndAStrobeNeverOverThreeASecond() {
        val dawn = 20 * 60_000L
        val s0 = SleepClock.light("sunrise", -dawn, dawn, 0x0A14FA, 0xE7A35E)!!; val s1 = SleepClock.light("sunrise", 0, dawn, 0x0A14FA, 0xE7A35E)!!
        assertTrue(((s0.rgb shr 16) and 255) < 60 && s0.a < 0.3); assertEquals(1.0, s1.a, 0.0); assertTrue((s1.rgb and 255) > 200)
        assertNull(SleepClock.light("sunrise", -dawn - 1, dawn, 0, 0)); assertNull(SleepClock.light("alert", -1, dawn, 0, 0)); assertNull(SleepClock.light("chime", 5, dawn, 0, 0))
        assertEquals(1.0, SleepClock.light("alert", 1000, dawn, 0, 0)!!.a, 1e-9)
        assertEquals(0x0A14FA, SleepClock.light("wave", 3000, dawn, 0x0A14FA, 0)!!.rgb)
        assertTrue(SleepClock.darkOn(SleepClock.light("white", 1, dawn, 0, 0))); assertFalse(SleepClock.darkOn(s0))
        fun flashes(hz: Double): Int { var n = 0; var prev = SleepClock.strobeOn(0, hz); for (t in 1L..10_000L) { val on = SleepClock.strobeOn(t, hz); if (on && !prev) n++; prev = on }; return n }
        assertEquals(20, flashes(SleepClock.STROBE_HZ)); assertTrue(flashes(50.0) <= 30)
        assertTrue((0 until 40).all { SleepClock.light("strobe", it * 100L, 0, 0, 0, calm = true)!!.rgb == 0xFFFFFF })
    }
    @Test fun wakeInOnAWholeMinuteWordsAndFallback() {
        val now = 1_794_000_091_000L
        assertEquals(1_794_001_320_000L, SleepClock.wakeInAt(now, 20))
        assertNull(SleepClock.okWakeIn(4)); assertEquals(960, SleepClock.okWakeIn(960)); assertNull(SleepClock.okWakeIn(961))
        assertEquals("1 h 45", SleepClock.durText(105)); assertEquals("7 h", SleepClock.durText(420)); assertEquals("20 min", SleepClock.durText(20))
        assertEquals("Wakes you in 6 h 12", SleepClock.countdown(now + 372 * 60_000L, now)); assertEquals("Waking you now", SleepClock.countdown(now - 1, now))
        assertEquals(listOf(15, 25, 95, 285, 375, 465, 555), SleepClock.WAKE_IN_FALLBACK.map { it.mins })
        assertEquals(listOf(10, 20, 90, 270, 360, 450, 540), SleepClock.WAKE_IN_FALLBACK.map { it.sleep })
        assertEquals(listOf("Nap", "Nap", "Nap", "Short sleep", "Short sleep", "5 sleep loops", "6 sleep loops"), SleepClock.WAKE_IN_FALLBACK.map { it.name })
    }
    @Test fun planV143StylesSunriseLeadSuggestionsTimer() {
        val p = SleepClock.from(JSONObject().put("since", since)
            .put("rings", JSONArray()
                .put(JSONObject().put("id", "a").put("at", a1).put("label", "14:30").put("style", "sunrise").put("from", a1 - 20 * 60_000L))
                .put(JSONObject().put("id", "b").put("at", a2).put("label", "15:00").put("style", "strobe").put("from", 1L)))
            .put("styles", JSONObject().put("wave", "#00FF00").put("sunrise", 30).put("strobe", false).put("timer", "alert"))
            .put("wakeIn", JSONArray().put(JSONObject().put("name", "Power nap").put("mins", 20).put("sleep", 20)).put(JSONObject().put("name", "evil").put("mins", 99999)))
            .put("timer", JSONObject().put("at", a1 + 60_000L).put("mins", 105)))!!
        assertEquals("sunrise", p.rings[0].style); assertEquals(a1 - 20 * 60_000L, p.rings[0].from)
        assertEquals("white", p.rings[1].style); assertEquals(a2, p.rings[1].from)          // only Sunrise lights up early
        assertEquals(0x00FF00, p.wave); assertEquals(30, p.sunrise); assertEquals("alert", p.timerStyle)
        assertEquals(1, p.wakeIn.size); assertEquals(105, p.timer!!.second)
        assertEquals("a", SleepClock.dawn(p, a1 - 60_000L, emptySet())!!.id); assertNull(SleepClock.dawn(p, a1, emptySet()))
        assertNull(SleepClock.dawn(p, a1 - 60_000L, setOf(p.rings[0].key)))
        assertEquals(a1 - 20 * 60_000L, SleepClock.nextWake(p, since, emptySet()))      // the phone wakes for the sunrise first
        val old = plan()
        assertEquals("chime", old.rings[0].style); assertNull(old.timer); assertEquals(7, old.wakeIn.size)
    }
    @Test fun wakeInOnTheClockReplacesTheTimerRingInThePlan() {
        val j = JSONObject().put("since", since).put("styles", JSONObject().put("timer", "sunrise").put("sunrise", 10))
            .put("rings", JSONArray().put(JSONObject().put("id", "a").put("at", a1).put("label", "14:30")).put(JSONObject().put("id", "timer").put("at", a2).put("label", "15:00")))
        val now = since + 60_000L
        val p = SleepClock.from(SleepClock.withWakeIn(j, 105, now) { "X" })!!
        val t = p.rings.single { it.id == "timer" }
        assertEquals(SleepClock.wakeInAt(now, 105), t.at); assertEquals("sunrise", t.style); assertEquals(t.at - 10 * 60_000L, t.from)
        assertEquals(105, p.timer!!.second)
        val none = SleepClock.from(SleepClock.withWakeIn(j, 0, now) { "X" })!!
        assertTrue(none.rings.none { it.id == "timer" }); assertNull(none.timer)
        val src = java.io.File("src/main/java/com/cincee/ps/gos/Sleep.kt").readText()
        assertTrue(src.contains("giveVolumeBack(c)")); assertTrue(src.contains("\"sleep:wakeIn\""))
        assertTrue(java.io.File("src/main/java/com/cincee/ps/gos/Bridge.kt").readText().contains("\"sleep:wakeInSeen\""))
        assertFalse(Regex("[\u2013\u2014]").containsMatchIn(src + java.io.File("src/main/java/com/cincee/ps/gos/SleepClock.kt").readText()))
    }
    @Test fun analogueFaceParsedSizedAndAngles() {
        val l = SleepClock.look(JSONObject().put("face", "analogue").put("dial", "roman").put("hand", "none").put("ink", "#112233").put("handInk", "#FF0000").put("digi", false))
        assertEquals("analogue", l.face); assertEquals("roman", l.dial); assertEquals("none", l.hand); assertFalse(l.digi)
        assertEquals(0xFF0000, l.handInk); assertEquals(0x112233, l.faceInk); assertEquals(0x112233, l.tickInk)
        val bad = SleepClock.look(JSONObject().put("face", "sundial").put("dial", "hex").put("hand", "fast"))
        assertEquals("digital", bad.face); assertEquals("ticks", bad.dial); assertEquals("sweep", bad.hand); assertTrue(bad.digi)
        val a = SleepClock.handAngles(15, 30, 15, 500, true); val t = SleepClock.handAngles(15, 30, 15, 500, false)
        assertEquals(30.25 * 6, a.second, 1e-9); assertEquals((3 + 30.25 / 60) * 30, a.first, 1e-9); assertEquals(15.5 * 6, a.third, 1e-9); assertEquals(90.0, t.third, 1e-9)
        assertEquals("IX", SleepClock.dialLabels("roman")[9]); assertEquals("12", SleepClock.dialLabels("numbers")[0]); assertTrue(SleepClock.dialLabels("ticks").isEmpty())
        assertTrue(SleepClock.dialDp(400f, 800f, 300.0) <= 400f * 0.92f); assertTrue(SleepClock.dialDp(400f, 800f, 50.0) < SleepClock.dialDp(400f, 800f, 100.0))
    }

    @Test fun alarmLoudnessAndOwnSound() {
        // V1.44: the alarm loudness from the page, 10% to 100% in 5% steps; the plan carries it (an older page: 80%).
        assertEquals(0.8, SleepClock.okLevel(null), 1e-9); assertEquals(0.8, SleepClock.okLevel("x"), 1e-9)
        assertEquals(0.1, SleepClock.okLevel(0), 1e-9); assertEquals(1.0, SleepClock.okLevel(7), 1e-9); assertEquals(0.65, SleepClock.okLevel(0.63), 1e-9)
        // The alarm volume step: the share of the stream's steps, Loud the top, never 0.
        assertEquals(7, SleepClock.alarmStep(true, 0.2, 7)); assertEquals(4, SleepClock.alarmStep(false, 0.5, 7)); assertEquals(1, SleepClock.alarmStep(false, 0.1, 7))
        assertEquals(7, SleepClock.alarmStep(false, 1.0, 7)); assertEquals(0, SleepClock.alarmStep(false, 0.5, 0))
        assertEquals(0.8, plan().level, 1e-9)
        val j = JSONObject().put("v", 1).put("since", since).put("rings", JSONArray()).put("words", JSONObject()).put("styles", JSONObject().put("level", 0.42))
        assertEquals(0.4, SleepClock.from(j)!!.level, 1e-9)
        // Your own sound: only a 16 bit mono WAV as the page makes it, under the cap.
        fun wav(n: Int, ch: Int = 1, bits: Int = 16): ByteArray {
            val b = ByteArray(44 + n * 2)
            "RIFF".toByteArray().copyInto(b, 0); "WAVE".toByteArray().copyInto(b, 8); "fmt ".toByteArray().copyInto(b, 12)
            b[20] = 1; b[22] = ch.toByte(); b[34] = bits.toByte(); "data".toByteArray().copyInto(b, 36)
            return b
        }
        assertTrue(SleepClock.okOwnWav(wav(100))); assertFalse(SleepClock.okOwnWav(wav(100, ch = 2))); assertFalse(SleepClock.okOwnWav(wav(100, bits = 8)))
        assertFalse(SleepClock.okOwnWav(ByteArray(44))); assertFalse(SleepClock.okOwnWav("%PDF-1.7 not sound at all, really not".toByteArray() + ByteArray(20)))
        assertFalse(SleepClock.okOwnWav(wav(SleepClock.OWN_MAX_BYTES / 2)))
        assertEquals("YOU ARE BROKE", SleepClock.ownName("YOU ARE BROKE")); assertEquals(null, SleepClock.ownName("  ")); assertEquals(40, SleepClock.ownName("a".repeat(90))!!.length)
    }
    // ---------- V1.47: a sound per alarm, custom sounds loop until Stop, alarms with Sleep mode off ----------
    @Test fun eachRingPlaysItsOwnSoundAndCustomLoopsRingUntilStop() {
        val d = "2026-11-11"
        val l = ListClock.PlanList("loop", 10, mapOf(d to ListClock.Entry("aaaaaaaaaaaaaaaa", "Talk", 600.0, 1, 2)))
        assertEquals(SleepClock.Play("builtin", len = SleepClock.RING_FOR), SleepClock.ringPlay("", null, d, false))
        assertEquals(SleepClock.Play("own", len = SleepClock.FOREVER), SleepClock.ringPlay("", null, d, true))
        assertEquals("builtin", SleepClock.ringPlay("builtin", l, d, true).kind)
        assertEquals(SleepClock.Play("track", "aaaaaaaaaaaaaaaa", true, 10, SleepClock.FOREVER), SleepClock.ringPlay("", l, d, false))
        assertEquals(SleepClock.Play("track", "bbbbbbbbbbbbbbbb", true, 0, SleepClock.FOREVER), SleepClock.ringPlay("t:bbbbbbbbbbbbbbbb", null, d, false))
        assertEquals("builtin", SleepClock.ringPlay("", l.copy(on = false), d, false).kind)       // only alarms set to it
        assertEquals("track", SleepClock.ringPlay("list", l.copy(on = false), d, false).kind)
        val whole = SleepClock.ringPlay("list", l.copy(end = "whole"), d, false)
        assertFalse(whole.loop); assertTrue(whole.len < SleepClock.FOREVER)
        assertTrue(SleepClock.ringing(1_000L, 1_000L + 50L * 86_400_000L, SleepClock.FOREVER))   // still ringing, no overflow
        assertTrue(SleepClock.okSound("own")); assertTrue(SleepClock.okSound("t:0123456789abcdef")); assertFalse(SleepClock.okSound("t:zz")); assertFalse(SleepClock.okSound("evil"))
    }
    @Test fun alarmsWithSleepModeOffArePlannedAndTheRingsCarryTheirSound() {
        val p = SleepClock.from(JSONObject().put("since", since).put("alarmOnly", true)
            .put("list", JSONObject().put("end", "loop").put("on", false).put("days", JSONObject()))
            .put("rings", JSONArray().put(JSONObject().put("id", "a").put("at", a1).put("label", "14:30").put("sound", "own"))
                .put(JSONObject().put("id", "b").put("at", a2).put("label", "15:00").put("sound", "t:zz"))))!!
        assertTrue(p.alarmOnly); assertEquals("own", p.rings[0].sound); assertEquals("", p.rings[1].sound)
        assertEquals(a1, SleepClock.nextWake(p, since, emptySet()))
        assertEquals(a2, SleepClock.nextWake(p, since, setOf(p.rings[0].key)))
        assertFalse(SleepClock.from(JSONObject().put("since", since))!!.alarmOnly)
        assertEquals(false, ListClock.parse(JSONObject().put("on", false).put("days", JSONObject()))!!.on)
        val src = java.io.File("src/main/java/com/cincee/ps/gos/Sleep.kt").readText()
        assertTrue(src.contains("if (alarmOnly(c)) { stop(c, \"alarmStop\"); return }"))
        assertTrue(src.contains("unlockThen(\"Settings\") { Sleep.settings(applicationContext) }"))
        assertTrue(java.io.File("src/main/java/com/cincee/ps/gos/Bridge.kt").readText().contains("\"sleep:alarms\""))
        assertFalse(Regex("[\u2013\u2014]").containsMatchIn(src))
    }
}
