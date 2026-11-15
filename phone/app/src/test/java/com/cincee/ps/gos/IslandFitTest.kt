package com.cincee.ps.gos

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** V1.60 Fitness on the phone's island: what each moment looks like, the rest countdown, the order, the page's message. */
class IslandFitTest {
    private val T = 1_800_000_000_000L
    private fun fit(kind: String, id: String = "m1", title: String = "", sub: String = "", until: Long = T + 5_000, fig: IslandFig.Fig? = null) =
        IslandShow.Fit(id, kind, T, until, title, sub, fig, true)
    private fun page(fit: IslandShow.Fit? = null, rest: IslandShow.FitRest? = null, pomo: IslandShow.Pomo? = null, meet: IslandShow.Meet? = null, on: Boolean = true) =
        IslandShow.Page(on, false, false, pomo, null, meet, null, fit, rest)
    private fun look(p: IslandShow.Page, now: Long = T + 100) = IslandShow.look(p, emptyList(), now, emptyMap())
    private val fig = IslandFig.Fig(FloatArray(34) { it.toFloat() }, FloatArray(34) { it + 1f }, 4f)

    @Test fun scanningIsACompactLineWithASpinner() {
        val l = look(page(fit("scanning", until = T + 25_000))) as IslandShow.Look.Compact
        assertEquals("Scanning", l.left); assertTrue(l.spin); assertEquals("", l.right); assertEquals(false, l.tick)
    }

    @Test fun foundGrowsToTheNameAndTheFigure() {
        val l = look(page(fit("found", "scan-2", "Leg press", fig = fig))) as IslandShow.Look.Found
        assertEquals("Leg press", l.name); assertEquals("scan-2", l.id); assertEquals(fig, l.fig)
        // Not in the exercise list: the name alone, no figure.
        assertNull((look(page(fit("found", "scan-3", "Cable thing"))) as IslandShow.Look.Found).fig)
    }

    @Test fun notFoundSaysSoBrieflyThenGoesAway() {
        val p = page(fit("notfound", until = T + 3_200))
        assertEquals("Not found", (look(p) as IslandShow.Look.Compact).left)
        assertEquals(IslandShow.Look.Idle(false), look(p, T + 3_200))
    }

    @Test fun workoutAddedIsTheFaceIdSquare() {
        val a = look(page(fit("added", "scan-4", "Workout added", "Leg press", T + 2_900, fig))) as IslandShow.Look.Added
        assertEquals("Workout added", a.title); assertEquals("Leg press", a.name); assertEquals(fig, a.fig)
    }

    @Test fun hintsAreBigWithTheirOwnTone() {
        val up = look(page(fit("better", title = "Higher than last time", sub = "7 days ago"))) as IslandShow.Look.Big
        assertEquals("Higher than last time", up.title); assertEquals("7 days ago", up.sub); assertEquals(IslandShow.Tone.GREEN, up.tone)
        val same = look(page(fit("same", title = "Same weight as 7 days ago", sub = "Try going up next time."))) as IslandShow.Look.Big
        assertEquals(IslandShow.Tone.AMBER, same.tone); assertEquals("Try going up next time.", same.sub)
        val nudge = look(page(fit("nudge", title = "Try 62.5 kg", sub = "You matched last time"))) as IslandShow.Look.Big
        assertEquals("Try 62.5 kg", nudge.title)
    }

    @Test fun aMomentEndsAtItsTimeAndNeverBeforeTheIslandIsOn() {
        val p = page(fit("better", title = "x", until = T + 4_500))
        assertTrue(look(p, T + 4_499) is IslandShow.Look.Big)
        assertEquals(IslandShow.Look.Idle(false), look(p, T + 4_500))
        assertEquals(IslandShow.Look.Idle(false), look(page(fit("better", title = "x"), on = false)))
    }

    @Test fun restCountsDownLiveThenSaysRestOverForThreeSeconds() {
        val r = IslandShow.FitRest(T + 90_000, "Bench press", 2, 4, false, 0)
        val l = look(page(rest = r), T) as IslandShow.Look.Compact
        assertEquals("Rest", l.left); assertEquals("1:30", l.right); assertTrue(l.tick)
        assertEquals("0:01", (look(page(rest = r), T + 89_000) as IslandShow.Look.Compact).right)
        // +15 s moves the end and the count follows it.
        assertEquals("1:45", (look(page(rest = r.copy(endsAt = T + 105_000)), T) as IslandShow.Look.Compact).right)
        val over = r.copy(over = true, overAt = T + 90_000)
        assertEquals("Rest over", (look(page(rest = over), T + 91_000) as IslandShow.Look.Compact).left)
        assertEquals(IslandShow.Look.Idle(false), look(page(rest = over), T + 93_000))
        // A rest that ran out with no word from the page yet shows nothing, never a negative clock.
        assertEquals(IslandShow.Look.Idle(false), look(page(rest = r), T + 90_500))
    }

    @Test fun theOrderIsMomentThenBreakThenRestThenMeeting() {
        val br = IslandShow.Pomo("b", "short", T + 200_000, null, false, false, null, 0)
        val meet = IslandShow.Meet("Call", T + 20 * 60_000, T + 50 * 60_000, T - 1000, null)
        val rest = IslandShow.FitRest(T + 60_000, "Squat", 1, 3, false, 0)
        assertEquals("Call", (look(page(rest = null, meet = meet)) as IslandShow.Look.Compact).left)
        assertEquals("Rest", (look(page(rest = rest, meet = meet)) as IslandShow.Look.Compact).left)
        assertEquals("Short break", (look(page(rest = rest, pomo = br, meet = meet)) as IslandShow.Look.Compact).left)
        assertTrue(look(page(fit("found", title = "Squat"), rest, br, meet)) is IslandShow.Look.Found)
    }

    @Test fun aReminderPopStillBeatsAMoment() {
        val pop = IslandShow.Pop("rem:1", IslandShow.Tone.AMBER, "Drink water", "", "list", T + 10_000)
        assertEquals("Drink water", (IslandShow.look(page(fit("found", title = "Squat")), listOf(pop), T + 100, emptyMap()) as IslandShow.Look.Big).title)
    }

    @Test fun sleepsUntilTheMomentOrTheRestChanges() {
        val p = page(fit("better", until = T + 4_500), IslandShow.FitRest(T + 60_000, "x", 1, 2, false, 0))
        assertEquals(T + 4_500, IslandShow.wakeAt(p, emptyList(), T, 0))
        assertEquals(T + 60_000, IslandShow.wakeAt(p, emptyList(), T + 5_000, 0))
        val over = page(rest = IslandShow.FitRest(T, "x", 1, 2, true, T + 1_000))
        assertEquals(T + 1_000 + IslandShow.REST_OVER_MS, IslandShow.wakeAt(over, emptyList(), T + 1_500, 0))
    }

    @Test fun aScanGoesScanningFoundAddedThenBack() {
        val steps = listOf(
            fit("scanning", "s1", until = T + 25_000) to "spin",
            fit("found", "s2", "Leg press", until = T + 40_000, fig = fig) to "found",
            fit("added", "s3", "Workout added", "Leg press", T + 2_900, fig) to "added",
        )
        val got = steps.map { (f, _) -> when (val l = look(page(f))) { is IslandShow.Look.Compact -> if (l.spin) "spin" else "compact"; is IslandShow.Look.Found -> "found"; is IslandShow.Look.Added -> "added"; else -> "other" } }
        assertEquals(steps.map { it.second }, got)
        assertEquals(IslandShow.Look.Idle(false), look(page(steps[2].first), T + 2_900))
    }

    // ---------- the page's message ----------
    private val good = """{"mode":"on","private":false,"task":null,"fit":{
        "moment":{"id":"scan-5","kind":"added","at":$T,"until":${T + 2_900},"title":"Workout added","sub":"Leg press","sound":false,
                  "fig":{"a":[${(0 until 34).joinToString(",")}],"b":[${(1..34).joinToString(",")}],"hr":4.2}},
        "rest":{"endsAt":${T + 90_000},"exercise":"Bench press","set":2,"of":4,"over":false,"overAt":0}}}"""

    @Test fun readsTheFitBlock() {
        val p = IslandShow.page(JSONObject(good), T)
        val f = p.fit!!
        assertEquals("added", f.kind); assertEquals("scan-5", f.id); assertEquals("Workout added", f.title); assertEquals(false, f.sound)
        assertNotNull(f.fig); assertEquals(4.2f, f.fig!!.hr, 0.001f)
        assertEquals(T + 90_000, p.rest!!.endsAt); assertEquals("Bench press", p.rest!!.exercise); assertEquals(2, p.rest!!.set)
    }

    @Test fun noFitBlockMeansNothingExtra() {
        val p = IslandShow.page(JSONObject("""{"mode":"on","private":false,"task":null}"""), T)
        assertNull(p.fit); assertNull(p.rest)
        assertNull(IslandShow.page(JSONObject("""{"mode":"on","fit":null}"""), T).fit)
    }

    @Test fun badMomentsAreDroppedNotDrawn() {
        fun moment(extra: String) = IslandShow.page(JSONObject("""{"mode":"on","fit":{"moment":{"id":"a","kind":"found","at":$T,"until":${T + 5}$extra}}}"""), T).fit
        assertNotNull(moment(""))
        assertNull(IslandShow.page(JSONObject("""{"mode":"on","fit":{"moment":{"id":"a","kind":"explode","at":$T,"until":${T + 5}}}}"""), T).fit)
        assertNull(IslandShow.page(JSONObject("""{"mode":"on","fit":{"moment":{"kind":"found","at":$T,"until":${T + 5}}}}"""), T).fit)
        assertNull(IslandShow.page(JSONObject("""{"mode":"on","fit":{"moment":{"id":"a","kind":"found","at":$T}}}"""), T).fit)
        // A figure with the wrong number of points is no figure: the name still shows.
        assertNull(moment(""","fig":{"a":[1,2],"b":[1,2],"hr":4}""")!!.fig)
        // A moment can never hold the island for more than a minute, whatever the page says.
        assertEquals(T + 60_000, IslandShow.page(JSONObject("""{"mode":"on","fit":{"moment":{"id":"a","kind":"scanning","at":$T,"until":${T + 99_000_000}}}}"""), T).fit!!.until)
    }

    @Test fun anOffIslandShowsNoFitAtAll() {
        assertNull(IslandShow.page(JSONObject(good).put("mode", "off"), T).fit)
    }
}
