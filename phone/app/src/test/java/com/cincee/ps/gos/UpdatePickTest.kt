package com.cincee.ps.gos

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** V1.51: the Update now tap installs the NEWEST version.json, never the one an earlier look found. */
class UpdatePickTest {
    // The real phone releases of 11 Nov 2026: V1.48 code 53, V1.49 code 54, V1.50 code 55.
    private fun note(code: Int, name: String) = JSONObject().put("versionCode", code).put("versionName", name).put("apk", "ps-gos-${name.drop(1)}.apk")
    private val v149 = note(54, "V1.49")
    private val v150 = note(55, "V1.50")
    private val installed148 = 53

    @Test fun cardSays149ServerSays150InstallsTheNewest() {
        val m = UpdatePick.choose(v149, v150)
        assertEquals(55, m.optInt("versionCode"))
        assertEquals("V1.50", m.optString("versionName"))
        assertEquals("ps-gos-1.50.apk", m.optString("apk"))
        assertTrue(UpdatePick.newer(m.optInt("versionCode"), installed148))
    }

    @Test fun offlineAtTheTapInstallsTheCardsVersion() {
        assertEquals(54, UpdatePick.choose(v149, null).optInt("versionCode"))
    }

    @Test fun aStaleDownloadIsRefused() {
        val why = UpdatePick.staleProblem(apkCode = 54, newestCode = 55)
        assertNotNull(why)
        assertTrue(UpdatePick.isStale(why))
    }

    @Test fun theNewestDownloadPasses() {
        assertNull(UpdatePick.staleProblem(apkCode = 55, newestCode = 55))
        assertNull(UpdatePick.staleProblem(apkCode = 56, newestCode = 55))
    }

    @Test fun nothingNewerOnTheServerInstallsNothing() {
        assertFalse(UpdatePick.newer(55, 55))
        assertFalse(UpdatePick.newer(54, 55))
    }

    @Test fun otherFailuresAreNotStale() {
        assertFalse(UpdatePick.isStale("The file does not match its checksum. Not installed."))
        assertFalse(UpdatePick.isStale(null))
    }
}
