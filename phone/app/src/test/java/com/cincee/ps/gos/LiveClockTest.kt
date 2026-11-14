package com.cincee.ps.gos

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/** V1.59 the live link's rules (LiveClock.kt): what a server frame means, the timings, and the websocket frames. */
class LiveClockTest {
    private val uid = "3f1c2b6e-1a2b-4c3d-8e9f-0123456789ab"
    private fun jwt(sub: String, exp: Long) = "eyJhbGciOiJIUzI1NiJ9." +
        Base64.getUrlEncoder().withoutPadding().encodeToString("""{"sub":"$sub","exp":$exp}""".toByteArray()) + ".sig"

    @Test fun signalsThatWakeThePage() {
        assertEquals(LiveClock.Heard.SIGNAL, LiveClock.heard("""{"topic":"realtime:inbox:$uid","event":"broadcast","payload":{"type":"broadcast","event":"inbox","payload":{}},"ref":null}"""))
        assertEquals(LiveClock.Heard.SIGNAL, LiveClock.heard("""{"topic":"realtime:second:$uid","event":"broadcast","payload":{"type":"broadcast","event":"poke","payload":{"k":"card"}},"ref":null}"""))
        // Other pokes (Fitness, the phone layout, the Second Computer's jobs) do not wake the page from here.
        assertEquals(LiveClock.Heard.NOTHING, LiveClock.heard("""{"topic":"realtime:second:$uid","event":"broadcast","payload":{"type":"broadcast","event":"poke","payload":{"k":"fit"}},"ref":null}"""))
        assertEquals(LiveClock.Heard.NOTHING, LiveClock.heard("not json"))
    }

    @Test fun joinsRefusalsAndClosing() {
        assertEquals(LiveClock.Heard.JOINED, LiveClock.heard("""{"topic":"realtime:second:$uid","event":"phx_reply","payload":{"status":"ok","response":{}},"ref":"1"}"""))
        assertEquals(LiveClock.Heard.NOTHING, LiveClock.heard("""{"topic":"phoenix","event":"phx_reply","payload":{"status":"ok","response":{}},"ref":"7"}"""))
        assertEquals(LiveClock.Heard.REFUSED, LiveClock.heard("""{"topic":"realtime:inbox:$uid","event":"phx_reply","payload":{"status":"error","response":{"reason":"Unauthorized"}},"ref":"2"}"""))
        assertEquals(LiveClock.Heard.CLOSED, LiveClock.heard("""{"topic":"realtime:second:$uid","event":"system","payload":{"status":"error","message":"Token has expired"},"ref":null}"""))
    }

    @Test fun joinMessageIsPrivateWithTheToken() {
        val j = JSONObject(LiveClock.join("realtime:inbox:$uid", "tok", 3))
        assertEquals("phx_join", j.getString("event")); assertEquals("3", j.getString("ref"))
        assertTrue(j.getJSONObject("payload").getJSONObject("config").getBoolean("private"))
        assertEquals("tok", j.getJSONObject("payload").getString("access_token"))
        assertEquals(listOf("realtime:inbox:$uid", "realtime:second:$uid"), LiveClock.topics(uid))
    }

    @Test fun userIdAndExpiryFromTheToken() {
        assertEquals(uid, LiveClock.uid(jwt(uid, 1_900_000_000)))
        assertEquals(1_900_000_000_000L, LiveClock.exp(jwt(uid, 1_900_000_000)))
        assertNull(LiveClock.uid(jwt("not-an-id", 1)))
        assertNull(LiveClock.uid("garbage"))
        assertTrue(LiveClock.tokenDue(1_000_000, 1_000_000 - 60_000))
        assertTrue(!LiveClock.tokenDue(1_000_000, 1_000_000 - 600_000))
    }

    @Test fun backoffGrowsAndStops() {
        val waits = (0..8).map { LiveClock.backoff(it) }
        assertEquals(waits, waits.sorted())
        assertEquals(1_000L, waits[0]); assertEquals(300_000L, waits.last())
    }

    /** The measurement: how late a new card can be while the phone is awake, before and after V1.59. */
    @Test fun worstDelayBeforeAndAfter() {
        val before = LiveClock.worstDelay(linkUp = false)
        val after = LiveClock.worstDelay(linkUp = true)
        println("live: worst delay before V1.59 ${before / 1000} s (one background period), after ${after / 1000.0} s plus the page's sync")
        assertEquals(15 * 60_000L, before)
        assertTrue(after <= 5_000)
        // A burst of signals: the first wakes after the debounce, the next waits for the gap.
        assertEquals(10_300L, LiveClock.wakeAt(10_000, 0))
        assertEquals(14_000L, LiveClock.wakeAt(10_000, 10_000))
    }

    /** RFC 6455 section 5.7: "Hello" masked with 37 fa 21 3d. */
    @Test fun framesAsTheRfcSays() {
        val f = WsFrame.encode(WsFrame.TEXT, "Hello".toByteArray(), byteArrayOf(0x37, 0xfa.toByte(), 0x21, 0x3d))
        assertArrayEquals(byteArrayOf(0x81.toByte(), 0x85.toByte(), 0x37, 0xfa.toByte(), 0x21, 0x3d, 0x7f, 0x9f.toByte(), 0x4d, 0x51, 0x58), f)
        val long = WsFrame.encode(WsFrame.TEXT, ByteArray(300), ByteArray(4))
        assertEquals(0xfe, long[1].toInt() and 0xff); assertEquals(300, ((long[2].toInt() and 0xff) shl 8) or (long[3].toInt() and 0xff))
        // RFC 6455 section 1.3: the handshake's example key and answer.
        assertEquals("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", WsFrame.accept("dGhlIHNhbXBsZSBub25jZQ=="))
    }
}
