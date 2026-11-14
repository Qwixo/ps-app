package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** PS 1.60: the island's first time card (restricted settings steps) and the still off check. */
class OverlayHelpTest {
    @Test fun theStepsAreTheRealGrapheneOsPath() {
        val m = OverlayHelp.message(false)
        assertTrue(m.contains("three dots at the top right"))
        assertTrue(m.contains("Allow restricted settings"))
        assertTrue(m.contains("Display over other apps"))
        assertTrue(m.indexOf("Allow restricted settings") < m.lastIndexOf("Display over other apps"))
        assertTrue(m.contains("1. ") && m.contains("2. ") && m.contains("3. "))
    }

    @Test fun stillOffSaysSoAndRepeatsTheSteps() {
        val m = OverlayHelp.message(true)
        assertTrue(m.startsWith("Still off."))
        assertTrue(m.contains("Allow restricted settings"))
        assertFalse(OverlayHelp.message(false).startsWith("Still off."))
    }

    @Test fun noDashesInTheWords() {
        for (s in listOf(OverlayHelp.message(false), OverlayHelp.message(true), OverlayHelp.OPEN_APP, OverlayHelp.OPEN_OVERLAY)) {
            assertFalse(s.contains('–')); assertFalse(s.contains('—'))
        }
    }

    @Test fun showsAgainOnlyWhenWaitingAndStillOff() {
        assertTrue(OverlayHelp.showAgain(granted = false, islandOn = true, waiting = true))
        assertFalse(OverlayHelp.showAgain(granted = true, islandOn = true, waiting = true))
        assertFalse(OverlayHelp.showAgain(granted = false, islandOn = false, waiting = true))
        assertFalse(OverlayHelp.showAgain(granted = false, islandOn = true, waiting = false))
    }

    @Test fun finishedWhenGranted() {
        assertTrue(OverlayHelp.finished(granted = true, waiting = true))
        assertFalse(OverlayHelp.finished(granted = true, waiting = false))
        assertFalse(OverlayHelp.finished(granted = false, waiting = true))
    }

    @Test fun firstTimeOnlyOnce() {
        assertTrue(OverlayHelp.showFirst(granted = false, islandOn = true, asked = false))
        assertFalse(OverlayHelp.showFirst(granted = false, islandOn = true, asked = true))
        assertFalse(OverlayHelp.showFirst(granted = true, islandOn = true, asked = false))
        assertEquals(3, OverlayHelp.STEPS.size)
    }
}
