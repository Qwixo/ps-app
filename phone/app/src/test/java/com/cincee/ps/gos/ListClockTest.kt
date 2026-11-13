package com.cincee.ps.gos

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.time.ZoneId

/** V1.47 alarm playlists on the phone (AlarmList.kt ListClock): the plan's days, the day key, the ring length, the fade,
 *  the pieces' checks and the file id. FICTIONAL names; nothing is played. */
class ListClockTest {
    private val dubai = ZoneId.of("Asia/Dubai")
    private val utc = ZoneId.of("UTC")
    private val at = java.time.Instant.parse("2026-11-10T20:00:00Z").toEpochMilli()   // 00:00 on 11 Nov in the developer's city

    @Test fun dayKeyOnThePhonesClock() {
        assertEquals("2026-11-11", ListClock.day(at, dubai))
        assertEquals("2026-11-10", ListClock.day(at, utc))
    }

    @Test fun thePlansListIsChecked() {
        val plan = JSONObject().put("since", 1).put("list", JSONObject().put("end", "whole").put("fade", 30).put("days", JSONObject()
            .put("2026-11-11", JSONObject().put("id", "00000000000000aa").put("name", "Fictional talk").put("secs", 600).put("n", 3).put("of", 7))
            .put("2026-11-12", JSONObject().put("id", "not hex at all!!"))))
        val l = ListClock.parse(plan.toString())!!
        assertEquals("whole", l.end); assertEquals(30, l.fade); assertEquals(1, l.days.size)
        assertEquals("Fictional talk", ListClock.entry(l, at, dubai)!!.name)
        assertNull(ListClock.entry(l, at, utc))
        val odd = ListClock.parse(JSONObject().put("end", "x").put("fade", 7).put("days", JSONObject()))!!
        assertEquals("loop", odd.end); assertEquals(0, odd.fade)
        assertNull(ListClock.parse(JSONObject().put("since", 1).toString()))   // an older page: no playlist
        assertNull(ListClock.parse(null as String?))
    }

    @Test fun eachRingCarriesItsOwnSoundChoice() {
        val plan = JSONObject().put("v", 1).put("since", 1000L).put("rings", org.json.JSONArray()
            .put(JSONObject().put("id", "a").put("at", 2000L).put("label", "07:00").put("sound", "style"))
            .put(JSONObject().put("id", "b").put("at", 3000L).put("label", "07:30").put("sound", "list"))
            .put(JSONObject().put("id", "c").put("at", 4000L).put("label", "08:00").put("sound", "odd")))
            .put("tasks", JSONObject().put("count", 0)).put("words", JSONObject())
        val p = SleepClock.from(plan)!!
        assertEquals(listOf("style", "list", ""), p.rings.map { it.sound })
    }

    @Test fun ringLengthAndFadeAreThePagesNumbers() {
        assertEquals(600_000L, ListClock.ringFor("loop", 3600.0))
        assertEquals(600_000L, ListClock.ringFor("whole", 60.0))
        assertEquals(1_803_000L, ListClock.ringFor("whole", 1800.0))
        assertEquals(3 * 3600_000L, ListClock.ringFor("whole", 5 * 3600.0))
        assertEquals(1.0, ListClock.fadeAt(0, 0), 0.0)
        assertEquals(0.05, ListClock.fadeAt(0, 30), 1e-9)
        assertEquals(0.525, ListClock.fadeAt(15_000, 30), 1e-9)
        assertEquals(1.0, ListClock.fadeAt(40_000, 30), 0.0)
        // A whole file's ring keeps ringing past the usual 10 minutes, and stops at its own end.
        assertTrue(SleepClock.ringing(1000, 1000 + 20 * 60_000L, ListClock.ringFor("whole", 1800.0)))
        assertFalse(SleepClock.ringing(1000, 1000 + 20 * 60_000L))
    }

    @Test fun piecesComeInOrderAndUnderTheCap() {
        val id = "0123456789abcdef"
        assertTrue(ListClock.pieceOk(id, "mp3", 0, 3, 0, 0, 1000))
        assertFalse(ListClock.pieceOk(id, "mp3", 2, 3, 1, 1000, 1000))            // a piece skipped
        assertFalse(ListClock.pieceOk(id, "exe", 0, 3, 0, 0, 1000))               // not a kind PS takes
        assertTrue(ListClock.pieceOk(id, "flac", 0, 3, 0, 0, 1000))
        assertFalse(ListClock.pieceOk("../../etc/passwd", "mp3", 0, 1, 0, 0, 10))  // never a path
        assertFalse(ListClock.pieceOk(id, "mp3", 0, 1, 0, 0, ListClock.PIECE + 1)) // too big a piece
        assertFalse(ListClock.pieceOk(id, "mp3", 5, 200, 5, ListClock.MAX_BYTES - 10, 100))   // over 100 MB in all
        assertFalse(ListClock.pieceOk(id, "mp3", 0, 100_000, 0, 0, 10))           // more pieces than 100 MB needs
    }

    @Test fun theIdIsTheStartOfTheSha256() {
        val f = File.createTempFile("ps-test-list", ".mp3")
        f.writeBytes(ByteArray(300_000) { (it % 251).toByte() })
        val want = MessageDigest.getInstance("SHA-256").digest(f.readBytes()).take(8).joinToString("") { "%02x".format(it) }
        assertEquals(want, ListClock.idOf(f))
        assertTrue(ListClock.okId(want))
        f.delete()
    }
}
