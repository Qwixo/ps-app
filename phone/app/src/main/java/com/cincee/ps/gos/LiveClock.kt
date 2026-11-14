package com.cincee.ps.gos

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.Base64

/**
 * The live link's pure rules (V1.59, the developer: "the notifications are laggy"). Checked on the JVM by LiveClockTest.
 *
 * Why notifications were late: with PS closed the phone only heard about a new client email, lead reply or finished
 * chat from the background check, a WorkManager job that Android runs at most every 15 minutes, and later while the
 * phone dozes (its maintenance windows move to an hour and more). GrapheneOS has no Google push, so nothing woke PS in
 * between. The page's own Realtime socket only lives while PS is on screen. So a card came on average 7 to 8 minutes
 * late awake, up to 15, and much later asleep.
 *
 * The fix: while the island or Instant notifications is on, PS keeps one quiet Supabase Realtime connection itself
 * (LiveLink.kt, inside the island's foreground service, which GrapheneOS lets use the network while dozing). The
 * server already sends an empty signal on the owner's private "inbox:<id>" topic for every new inbox package, and
 * since V1.59 the web pokes {k:"card"} on "second:<id>" when a card changes on another device. A signal wakes the
 * page once (the same change only sync as the background check) and the notification shows within seconds. Nothing
 * else travels: the payload is empty, the data comes through the normal sync.
 */
object LiveClock {
    const val HEARTBEAT_MS = 30_000L          // Phoenix heartbeat (supabase-js uses 25 s; the server drops a quiet socket after about a minute)
    const val READ_TIMEOUT_MS = 75_000         // no frame at all for this long (two heartbeats missed): the socket is dead
    const val SIGNAL_DEBOUNCE_MS = 300L        // a burst of signals is one wake
    const val MIN_GAP_MS = 4_000L              // at most one page wake every few seconds; a signal meanwhile runs once after
    const val TOKEN_EARLY_MS = 180_000L        // ask for a fresh token this long before the old one ends
    /** The background check alone (before V1.59): WorkManager's shortest period and its flex. */
    const val OLD_PERIOD_MS = 15 * 60_000L

    /** Wait before reconnect attempt n (0 based): quick at first, then slower, never more than 5 minutes. */
    fun backoff(n: Int): Long = when {
        n <= 0 -> 1_000L
        n == 1 -> 3_000L
        n == 2 -> 10_000L
        n == 3 -> 30_000L
        n == 4 -> 60_000L
        else -> 300_000L
    }

    /** The topics this link joins for owner [uid]. inbox: the developer's own server signal (others are refused, harmless). */
    fun topics(uid: String) = listOf("realtime:inbox:$uid", "realtime:second:$uid")

    /** A user id from a Supabase access token (its "sub"), or null. Only to name the topics; the token is never logged. */
    fun uid(jwt: String): String? = runCatching {
        val part = jwt.split('.').getOrNull(1) ?: return null
        val json = String(Base64.getUrlDecoder().decode(part.padEnd((part.length + 3) / 4 * 4, '=')))
        JSONObject(json).optString("sub").takeIf { Regex("^[0-9a-fA-F-]{36}$").matches(it) }
    }.getOrNull()
    fun exp(jwt: String): Long = runCatching {
        val part = jwt.split('.')[1]
        JSONObject(String(Base64.getUrlDecoder().decode(part.padEnd((part.length + 3) / 4 * 4, '=')))).optLong("exp") * 1000
    }.getOrDefault(0L)

    fun join(topic: String, token: String, ref: Int): String = JSONObject()
        .put("topic", topic).put("event", "phx_join").put("ref", ref.toString()).put("join_ref", ref.toString())
        .put("payload", JSONObject()
            .put("config", JSONObject()
                .put("broadcast", JSONObject().put("ack", false).put("self", false))
                .put("presence", JSONObject().put("key", "").put("enabled", false))
                .put("postgres_changes", org.json.JSONArray())
                .put("private", true))
            .put("access_token", token))
        .toString()
    fun heartbeat(ref: Int): String = JSONObject().put("topic", "phoenix").put("event", "heartbeat").put("payload", JSONObject()).put("ref", ref.toString()).toString()
    fun accessToken(topic: String, token: String, ref: Int): String =
        JSONObject().put("topic", topic).put("event", "access_token").put("payload", JSONObject().put("access_token", token)).put("ref", ref.toString()).toString()

    enum class Heard { NOTHING, SIGNAL, JOINED, REFUSED, CLOSED }

    /** What a frame from the server means. SIGNAL: something new for this phone (wake the page once). */
    fun heard(text: String): Heard {
        val m = runCatching { JSONObject(text) }.getOrNull() ?: return Heard.NOTHING
        val topic = m.optString("topic")
        val payload = m.optJSONObject("payload")
        return when (m.optString("event")) {
            "broadcast" -> {
                val ev = payload?.optString("event") ?: ""
                when {
                    topic.startsWith("realtime:inbox:") && ev == "inbox" -> Heard.SIGNAL
                    topic.startsWith("realtime:second:") && ev == "poke" && payload?.optJSONObject("payload")?.optString("k") == "card" -> Heard.SIGNAL
                    else -> Heard.NOTHING
                }
            }
            "phx_reply" -> if (topic == "phoenix") Heard.NOTHING else if (payload?.optString("status") == "ok") Heard.JOINED else Heard.REFUSED
            "phx_close", "phx_error" -> if (topic.startsWith("realtime:inbox:")) Heard.REFUSED else Heard.CLOSED
            // The server says the token ran out ("system" with status error): treat as closed, a fresh token joins again.
            "system" -> if (payload?.optString("status") == "error") Heard.CLOSED else Heard.NOTHING
            else -> Heard.NOTHING
        }
    }

    /** Should the link ask for a fresh token now? */
    fun tokenDue(exp: Long, now: Long) = exp in 1..(now + TOKEN_EARLY_MS)

    /** How late a card could be (ms), worst case while the phone is awake: before V1.59 one background period; with the
     *  link up a signal plus the debounce and the gap between page wakes. */
    fun worstDelay(linkUp: Boolean) = if (linkUp) SIGNAL_DEBOUNCE_MS + MIN_GAP_MS else OLD_PERIOD_MS

    /** When the next page wake may start, given the last one started at [lastAt]. */
    fun wakeAt(signalAt: Long, lastAt: Long) = maxOf(signalAt + SIGNAL_DEBOUNCE_MS, lastAt + MIN_GAP_MS)
}

/** RFC 6455 frames for the live link's small client (LiveLink.kt). Pure, so LiveClockTest checks it. */
object WsFrame {
    const val TEXT = 1; const val CLOSE = 8; const val PING = 9; const val PONG = 10; const val CONT = 0
    private const val GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    /** A client frame (always masked, always final). */
    fun encode(op: Int, payload: ByteArray, mask: ByteArray): ByteArray {
        require(mask.size == 4)
        val out = ByteArrayOutputStream(payload.size + 14)
        out.write(0x80 or (op and 0x0f))
        val n = payload.size
        when {
            n < 126 -> out.write(0x80 or n)
            n < 65536 -> { out.write(0x80 or 126); out.write(n ushr 8); out.write(n and 0xff) }
            else -> { out.write(0x80 or 127); for (i in 7 downTo 0) out.write(((n.toLong() ushr (8 * i)) and 0xff).toInt()) }
        }
        out.write(mask)
        for (i in 0 until n) out.write(payload[i].toInt() xor mask[i % 4].toInt())
        return out.toByteArray()
    }

    /** The Sec-WebSocket-Accept the server must answer for [key]. */
    fun accept(key: String): String =
        Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((key + GUID).toByteArray()))
}
