package com.cincee.ps.gos

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IslandFigTest {
    private fun arr(f: (Int) -> Number) = (0 until 34).joinToString(",") { f(it).toString() }
    private fun obj(a: String, b: String, hr: String = "4.6") = JSONObject("""{"a":[$a],"b":[$b],"hr":$hr}""")

    @Test fun parsesTwoPosesOf17Points() {
        val f = IslandFig.parse(obj(arr { it }, arr { it + 2 }))!!
        assertEquals(34, f.a.size); assertEquals(34, f.b.size); assertEquals(4.6f, f.hr, 0.001f)
    }

    @Test fun refusesAnythingThatIsNotAFigure() {
        assertNull(IslandFig.parse(null))
        assertNull(IslandFig.parse(obj("1,2", arr { it })))
        assertNull(IslandFig.parse(obj(arr { it }, arr { 500 })))             // far outside the box
        assertNull(IslandFig.parse(obj(arr { it }, arr { it }, "0")))         // no head
        assertNull(IslandFig.parse(obj(arr { it }, arr { it }, "999")))
        assertNull(IslandFig.parse(JSONObject("""{"a":[],"b":[]}""")))
    }

    @Test fun blendIsTheStartAtZeroTheEndAtOneAndTheMiddleBetween() {
        val f = IslandFig.parse(obj(arr { 10 }, arr { 30 }))!!
        assertEquals(10f, IslandFig.blend(f, 0f)[5], 0f); assertEquals(30f, IslandFig.blend(f, 1f)[5], 0f); assertEquals(20f, IslandFig.blend(f, 0.5f)[5], 0f)
        assertEquals(30f, IslandFig.blend(f, 9f)[0], 0f)    // never past the end
    }

    @Test fun theRepLoopsAndStandsStillWithReducedMotion() {
        assertEquals(0f, IslandFig.repK(0, false), 0.001f)
        assertEquals(1f, IslandFig.repK(IslandFig.REP_MS / 2, false), 0.001f)
        assertEquals(0f, IslandFig.repK(IslandFig.REP_MS, false), 0.001f)
        assertEquals(0f, IslandFig.repK(777, true), 0f)
        assertTrue(IslandFig.repK(-5, false) in 0f..1f)
    }

    @Test fun aFigureHasSixteenLinesAndEachJoinsTheRightPoints() {
        val f = IslandFig.parse(obj(arr { it }, arr { it }))!!
        val lines = IslandFig.lines(f.a)
        assertEquals(16, lines.size)
        assertTrue(lines.all { it.size == 4 })
        // the first line is head to neck: points 0 and 1 are (0,1) and (2,3)
        assertEquals(listOf(0f, 1f, 2f, 3f), lines[0].toList())
        assertNotNull(lines.firstOrNull { it.toList() == listOf(f.a[2 * IslandFig.HIPL], f.a[2 * IslandFig.HIPL + 1], f.a[2 * IslandFig.KN], f.a[2 * IslandFig.KN + 1]) })
    }
}
