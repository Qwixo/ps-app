package com.cincee.ps.gos

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The profile file, the 1Password and Signal rule join and Features' answers (Profile.kt, Features.kt, V1.58). */
class ProfileTest {
    private val gsquad = Profile.from("""{"schema":1,"name":"gsquad","display":"the G Squad","channel":{"kind":"gsquad"},"othersShared":"on","features":{},"rules":{"tabOverProtectedApps":true,"islandOverProtectedApps":true}}""")!!
    private val red = Profile.from("""{"schema":1,"name":"red","channel":{"kind":"url","url":"https://example.com/p.json"},"othersShared":"off","rules":{"tabOverProtectedApps":false,"islandOverProtectedApps":false}}""")!!
    private val reg = Features.registry(JSONArray("""[{"schema":1,"features":[
        {"id":"campaigns","owner":"core","scope":"shared","default":"off"},
        {"id":"island-menu-strip","owner":"red","scope":"shared","default":"on"},
        {"id":"jan-thing","owner":"jan","scope":"shared","default":"on"},
        {"id":"jan-thing","owner":"red","scope":"shared","default":"off"},
        {"id":"Bad","owner":"jan","scope":"shared","default":"on"}]},
        {"schema":2,"features":[{"id":"future","owner":"red","scope":"shared","default":"on"}]}]"""))

    @Test fun reads() {
        assertEquals("gsquad", gsquad.name); assertEquals(Profile.Channel.GSquad, gsquad.channel); assertTrue(gsquad.othersShared)
        assertEquals(Profile.Channel.Url("https://example.com/p.json"), red.channel); assertEquals("red", red.display)
        assertEquals(true, gsquad.rule("tabOverProtectedApps")); assertEquals(false, red.rule("islandOverProtectedApps"))
    }
    @Test fun refusesBadFiles() {
        assertNull(Profile.from(null)); assertNull(Profile.from("nope"))
        assertNull(Profile.from("""{"schema":2,"name":"red","channel":{"kind":"local"},"othersShared":"off"}"""))
        assertNull(Profile.from("""{"schema":1,"name":"Owner","channel":{"kind":"local"},"othersShared":"off"}"""))
        assertNull(Profile.from("""{"schema":1,"name":"jan","channel":{"kind":"url","url":"http://x"},"othersShared":"off"}"""))
        assertTrue(Profile.from("""{"schema":1,"name":"jan","channel":{"kind":"local"},"othersShared":"off","rules":{"tabOverProtectedApps":1}}""")!!.rules.isEmpty())
    }
    @Test fun ruleJoinFailsClosed() {
        for (acct in listOf(true, false)) {
            assertEquals(acct, Profile.allows("tabOverProtectedApps", acct, null))
            assertEquals(acct, Profile.allows("tabOverProtectedApps", acct, gsquad))
            assertFalse(Profile.allows("tabOverProtectedApps", acct, red))
        }
    }
    @Test fun registry() = assertEquals(listOf("campaigns", "island-menu-strip", "jan-thing"), reg.map { it.id })
    @Test fun bundledAnswers() {
        assertFalse(Features.bundled("campaigns", reg, gsquad))
        assertTrue(Features.bundled("island-menu-strip", reg, red))
        assertTrue(Features.bundled("jan-thing", reg, gsquad))
        assertFalse(Features.bundled("jan-thing", reg, red))
        assertFalse(Features.bundled("jan-thing", reg, null))
        assertFalse(Features.bundled("nobody", reg, gsquad))
    }
    @Test fun pageAnswerWins() {
        assertTrue(Features.decide("jan-thing", mapOf("jan-thing" to true), reg, red))
        assertFalse(Features.decide("island-menu-strip", mapOf("island-menu-strip" to false), reg, red))
        assertEquals(mapOf("a-b" to true, "d" to false), Features.clean(JSONObject("""{"a-b":true,"Bad":true,"c":1,"d":false}""")))
    }
}
