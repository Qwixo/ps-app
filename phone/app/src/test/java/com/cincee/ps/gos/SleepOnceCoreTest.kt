package com.cincee.ps.gos

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** "Just tomorrow" on the clock (SleepOnceCore.kt): FICTIONAL times and words. */
class SleepOnceCoreTest {
    private fun once(set: Boolean = false, skipped: Boolean = false) = JSONObject()
        .put("set", set).put("skipped", skipped).put("line", "Just tomorrow: 09:00").put("usual", "09:00")
        .put("words", JSONObject().put("title", "Just tomorrow").put("skip", "Skip").put("later", "Later").put("pick", "Pick a time")
            .put("undo", "Undo").put("save", "Save").put("reason", "Confirm it is you").put("undoReason", "Confirm to undo")
            .put("mins", JSONArray().put(JSONObject().put("mins", 60).put("label", "1 hour later")).put(JSONObject().put("mins", 0).put("label", "bad")).put(JSONObject().put("mins", 30))))
    private fun plan(o: JSONObject?) = SleepClock.from(JSONObject().put("v", 1).put("since", 1_000L).apply { if (o != null) put("once", o) })!!

    @Test fun decodesOnceWithTheWordsAsGiven() {
        val p = plan(once(set = true))
        val o = p.once!!
        assertTrue(o.set); assertFalse(o.skipped)
        assertEquals("Just tomorrow: 09:00", o.line); assertEquals("09:00", o.usual)
        assertEquals("Pick a time", o.words.pick); assertEquals("Confirm it is you", o.words.reason)
        assertEquals(listOf(OnceMins(60, "1 hour later")), o.words.mins)   // a zero or label-less choice is dropped
    }
    @Test fun noOnceMeansNothingToDraw() {
        assertNull(plan(null).once)
        assertNull(SleepOnceCore.decode(JSONObject().put("line", "x").put("usual", "9:00").put("words", JSONObject())))
        assertNull(SleepOnceCore.decode(JSONObject().put("line", "").put("usual", "09:00").put("words", JSONObject())))
        assertNull(SleepOnceCore.decode(JSONObject().put("line", "x").put("usual", "09:00")))
    }
    @Test fun everyActBuildsItsJson() {
        assertEquals("sleep:once", JSONObject(SleepOnceCore.skipJson()).getString("type"))
        assertEquals("skip", JSONObject(SleepOnceCore.skipJson()).getString("act"))
        val l = JSONObject(SleepOnceCore.laterJson(60)!!)
        assertEquals("later", l.getString("act")); assertEquals(60, l.getInt("mins"))
        val p = JSONObject(SleepOnceCore.pickJson("10:45")!!)
        assertEquals("pick", p.getString("act")); assertEquals("10:45", p.getString("at"))
        assertEquals("undo", JSONObject(SleepOnceCore.undoJson()).getString("act"))
    }
    @Test fun badTimesAndMinutesBuildNothing() {
        assertNull(SleepOnceCore.pickJson("24:00")); assertNull(SleepOnceCore.pickJson("9:5")); assertNull(SleepOnceCore.pickJson(""))
        assertNull(SleepOnceCore.laterJson(0)); assertNull(SleepOnceCore.laterJson(5000))
        assertTrue(SleepOnceCore.okTime("00:00")); assertTrue(SleepOnceCore.okTime("23:59")); assertFalse(SleepOnceCore.okTime(null))
    }
    @Test fun pickStartIsUsualPlusAnHourAndWrapsMidnight() {
        assertEquals(10 to 0, SleepOnceCore.pickStart("09:00"))
        assertEquals(0 to 30, SleepOnceCore.pickStart("23:30"))
        assertEquals(0 to 59, SleepOnceCore.pickStart("23:59"))
        assertEquals(8 to 0, SleepOnceCore.pickStart("nonsense"))
        assertEquals("07:05", SleepOnceCore.hhmm(7, 5))
    }
    @Test fun theAuthIdIsChecked() {
        assertTrue(SleepOnceCore.okAuthId("a1_B-2")); assertTrue(SleepOnceCore.okAuthId("x".repeat(24)))
        assertFalse(SleepOnceCore.okAuthId("")); assertFalse(SleepOnceCore.okAuthId("x".repeat(25)))
        assertFalse(SleepOnceCore.okAuthId("a b")); assertFalse(SleepOnceCore.okAuthId("a\"}")); assertFalse(SleepOnceCore.okAuthId(null))
        assertEquals(80, SleepOnceCore.authReason("r".repeat(200)).length)
        assertEquals("", SleepOnceCore.authReason(null))
    }
    @Test fun theAuthAnswerCarriesIdAndNoScreenLock() {
        val ok = JSONObject(SleepOnceCore.authAnswer("id1", true))
        assertEquals("sleep:auth", ok.getString("type")); assertEquals("id1", ok.getString("id")); assertTrue(ok.getBoolean("ok")); assertFalse(ok.has("none"))
        val no = JSONObject(SleepOnceCore.authAnswer("id1", false))
        assertFalse(no.getBoolean("ok"))
        val none = JSONObject(SleepOnceCore.authAnswer("id1", true, none = true))
        assertFalse(none.getBoolean("ok")); assertTrue(none.getBoolean("none"))
    }
    @Test fun gateSendsOnlyWhenPassed() {
        assertNull(SleepOnceCore.gate(false, SleepOnceCore.skipJson()))
        assertEquals(SleepOnceCore.undoJson(), SleepOnceCore.gate(true, SleepOnceCore.undoJson()))
        assertNull(SleepOnceCore.gate(true, SleepOnceCore.laterJson(0)))
    }
}
