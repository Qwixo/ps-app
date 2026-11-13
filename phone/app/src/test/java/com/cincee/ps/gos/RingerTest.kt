package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Test

/** The ring mode the page reads for the Edit mode sounds (V1.56, Ringer.kt). */
class RingerTest {
    @Test fun namesEachMode() {
        assertEquals("silent", Ringer.name(Ringer.SILENT))
        assertEquals("vibrate", Ringer.name(Ringer.VIBRATE))
        assertEquals("normal", Ringer.name(Ringer.NORMAL))
    }
    @Test fun unknownCountsAsNormal() {
        assertEquals("normal", Ringer.name(7))
        assertEquals("normal", Ringer.name(-1))
    }
    @Test fun answerTypeIsNotOnTheMainThread() {
        // A system read: it runs on the bridge thread like every type not named in BridgeRoutes.MAIN.
        assertEquals(On.BRIDGE, BridgeRoutes.of("ringer:get"))
    }
}
