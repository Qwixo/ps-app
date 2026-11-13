package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.json.JSONObject
import org.junit.Test

/** V1.57: the phone asks the public PS repo's GitHub release for updates, never cincee.com. */
class UpdateWhereTest {
    private val gh = "https://github.com/RedbyPS/ps/releases/latest/download/"

    @Test fun theReleaseBuildAsksGitHub() {
        assertEquals(gh, UpdateWhere.base())
        assertEquals(gh + "gos-version.json", UpdateWhere.note())
        assertFalse(BuildConfig.UPDATE_BASE.contains("cincee"))
    }

    @Test fun theApkIsBesideTheNote() {
        assertEquals(gh + "ps-gos-1.57.apk", UpdateWhere.apk("ps-gos-1.57.apk"))
        assertEquals(gh + "ps-gos-1.57-b62.apk", UpdateWhere.apk("ps-gos-1.57-b62.apk"))
    }

    @Test fun oddNamesAreRefused() {
        assertNull(UpdateWhere.apk("../ps-gos.apk"))
        assertNull(UpdateWhere.apk("https://cincee.com/client/gos/ps-gos-1.57.apk"))
        assertNull(UpdateWhere.apk("sub/ps-gos.apk"))
        assertNull(UpdateWhere.apk("ps-gos.zip"))
        assertNull(UpdateWhere.apk(".apk"))
        assertNull(UpdateWhere.apk(""))
    }

    @Test fun aTestServerKeepsItsOwnPlace() {
        assertEquals("https://10.0.2.2:8443/gos/gos-version.json", UpdateWhere.note("https://10.0.2.2:8443/gos", "gos-version.json"))
    }

    // V1.58: the channel comes from the build's own profile; no profile is today's channel.
    @Test fun noProfileIsTheGSquadChannel() {
        assertEquals(UpdateWhere.GSQUAD, UpdateWhere.route(null))
        assertEquals(UpdateWhere.GSQUAD, UpdateWhere.route("not json"))
        assertEquals(UpdateWhere.GSQUAD, UpdateWhere.route("""{"name":"gsquad","channel":{"kind":"gsquad"}}"""))
        assertEquals(UpdateWhere.GSQUAD, UpdateWhere.route("""{"name":"jan"}"""))
        assertEquals(UpdateWhere.GSQUAD, UpdateWhere.route("""{"name":"jan","channel":{"kind":"ftp"}}"""))
        assertNull(UpdateWhere.GSQUAD.base)   // BuildConfig.UPDATE_BASE, exactly as in V1.57
    }

    @Test fun aPersonsOwnChannel() {
        val jan = UpdateWhere.route("""{"name":"jan","channel":{"kind":"url","url":"https://example.invalid/jan/gos/"}}""")
        assertEquals(UpdateRoute("url", "jan", "https://example.invalid/jan/gos/"), jan)
        assertEquals("https://example.invalid/jan/gos/gos-version.json", UpdateWhere.note(jan.base!!, "gos-version.json"))
        assertEquals("https://example.invalid/jan/gos/ps-gos-1.59.apk", UpdateWhere.apk("ps-gos-1.59.apk", jan.base!!))
        assertEquals(UpdateRoute("local", "mia", null), UpdateWhere.route("""{"name":"mia","channel":{"kind":"local"}}"""))
    }

    @Test fun aBadPrivateChannelIsNotUsed() {
        for (p in listOf("""{"name":"jan","channel":{"kind":"url","url":"http://example.invalid/gos/"}}""",
                         """{"name":"jan","channel":{"kind":"url","url":"https://example.invalid/gos"}}""",
                         """{"name":"jan","channel":{"kind":"url","url":"https:///gos/"}}""",
                         """{"name":"Jan Smith","channel":{"kind":"url","url":"https://example.invalid/gos/"}}""",
                         """{"name":"gsquad","channel":{"kind":"url","url":"https://example.invalid/gos/"}}""")) assertEquals(p, UpdateWhere.GSQUAD, UpdateWhere.route(p))
    }

    @Test fun onlyNotesForThisChannel() {
        val jan = UpdateRoute("url", "jan", "https://example.invalid/jan/gos/")
        val old = JSONObject("""{"versionCode":62}""")
        assertNull(UpdateWhere.noteChannel(old))
        assertTrue(UpdateWhere.GSQUAD.takes(UpdateWhere.noteChannel(old)))
        assertTrue(jan.takes(UpdateWhere.noteChannel(old)))
        val squad = JSONObject("""{"versionCode":63,"channel":"gsquad"}""")
        assertTrue(UpdateWhere.GSQUAD.takes(UpdateWhere.noteChannel(squad)))
        assertFalse(jan.takes(UpdateWhere.noteChannel(squad)))
        val janNote = JSONObject("""{"versionCode":64,"channel":"jan"}""")
        assertFalse(UpdateWhere.GSQUAD.takes(UpdateWhere.noteChannel(janNote)))
        assertTrue(jan.takes(UpdateWhere.noteChannel(janNote)))
        assertFalse(UpdateWhere.GSQUAD.takes(UpdateWhere.noteChannel(JSONObject("""{"channel":7}"""))))
    }

    @Test fun whoMadeIt() {
        assertEquals("by Jan", UpdateWhere.byLine("jan"))
        assertEquals("by the G Squad", UpdateWhere.byLine("gsquad"))
        assertEquals("by Mary-Jane", UpdateWhere.byLine("mary-jane"))
        assertNull(UpdateWhere.byLine(null))
        assertNull(UpdateWhere.byLine(""))
        assertNull(UpdateWhere.byLine("<b>Jan</b>"))
    }
}
