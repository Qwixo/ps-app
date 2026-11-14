package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FitTonesTest {
    private val kinds = listOf("scanning", "found", "notfound", "added", "better", "same", "nudge")

    @Test fun everyMomentHasASoundAndNoSoundIsLoudOrSilent() {
        for (k in kinds) {
            val s = FitTones.render(k)
            assertTrue("$k has samples", s.size > FitTones.RATE / 20)
            val peak = s.maxOf { Math.abs(it.toInt()) }
            assertTrue("$k audible", peak > 2_000)
            assertTrue("$k at half scale or less", peak <= Short.MAX_VALUE / 2 + 1)
        }
    }

    @Test fun eachMomentSoundsDifferent() {
        val seen = kinds.map { FitTones.render(it).toList() }
        for (i in seen.indices) for (j in i + 1 until seen.size) assertFalse("${kinds[i]} and ${kinds[j]} are the same sound", seen[i] == seen[j])
    }

    @Test fun workoutAddedIsTheBigOneAndScanningTheSmallest() {
        val len = kinds.associateWith { FitTones.millis(it) }
        assertEquals(len.values.max(), len["added"])
        assertEquals(len.values.min(), len["scanning"])
        assertTrue(len["added"]!! < 2_000)
    }

    @Test fun anUnknownMomentIsSilentAndEndsCleanlyWithNoClick() {
        assertEquals(0, FitTones.render("nope").size)
        for (k in kinds) { val s = FitTones.render(k); assertTrue("$k ends near silence", Math.abs(s.last().toInt()) < 200); assertEquals(0, s.first().toInt()) }
    }

    @Test fun theSameKindMakesTheSameSoundEveryTime() {
        assertEquals(FitTones.render("added").toList(), FitTones.render("added").toList())
    }
}
