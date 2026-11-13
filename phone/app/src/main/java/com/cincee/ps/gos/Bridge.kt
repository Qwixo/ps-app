package com.cincee.ps.gos

import org.json.JSONObject
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.Executor
import java.util.concurrent.locks.ReentrantLock

/*
 * Why this file exists: the 2 Nov 2026 freeze (ANR, V1.28 code 30, "Waited 5000ms for FocusEvent").
 * The page's "session" message was handled on the main thread and sealed the access token with the
 * Keystore there (Cipher.init, a call into keystore2). At the same moment five WebView threads were
 * decrypting background video pieces in the Keystore, two of them only because SequenceInputStream's
 * close() decrypts every piece it has not read yet. keystore2 was busy, the main thread waited over
 * 5 seconds, GrapheneOS said PS was not responding. The pieces below make that impossible:
 *  - BridgeDispatcher: the main thread only hands a page message over; it is read and handled on the
 *    bridge thread, and only the few that need the screen go back to the main thread.
 *  - KeyGate: every Keystore use goes through one gate, one at a time, and debug builds throw when the
 *    main thread gets there.
 *  - PieceStream: a video's pieces are opened only when read, and closing opens nothing (V1.33: from a
 *    byte range, see VideoCrypt.kt).
 *  - SameAsLast: a repeat of the same token or schedule is not sealed again.
 * Plain JVM code (no Android classes), so the unit tests run it as is.
 */

/** Where a message from the page is handled. */
enum class On { MAIN, BRIDGE }

object BridgeRoutes {
    /**
     * The only messages handled on the main thread: they need the screen (the activity, a view, a
     * prompt) or state the main thread owns (Fitness and Gym, shared with their alarms and services).
     * None of them touches the Keystore or a file there: the fingerprint ones (remember:save,
     * remember:unlock, cmd:sign) do their Keystore work on the bridge thread and come back only for
     * the prompt. Everything else, including any type added later, runs on the bridge thread.
     */
    val MAIN = setOf(
        "haptic", "perm", "back:none", "kb:show",
        "remember:save", "remember:unlock", "cmd:sign",
        "gymPlan",
        "sleep:start", "sleep:plan", "sleep:stop", "sleep:get", "sleep:wokeSaved", "sleep:customiseSeen", "sleep:settingsSeen", "sleep:alarms", "sleep:break", "sleep:breakEnd", "sleep:breakSeen", "sleep:wakeInSeen",
        "sleep:test", "sleep:testStop",   // V1.44 Test (Sleep.kt); the own sound's file work (sleep:sound:*) runs on the bridge thread
        "fitness:start", "fitness:add", "fitness:skip", "fitness:cancel", "fitness:awake", "fitness:get",
        // Not here on purpose: the Annoying 15 min reminder (remPlan, rem:test, rem:testStop, rem:sound:*). Remind.kt
        // does its files, notifications and sound on its own thread, so they stay on the bridge thread.
    )
    fun of(type: String): On = if (type in MAIN) On.MAIN else On.BRIDGE
}

/**
 * The WebMessageListener calls [onRaw] on the main thread. It only queues the text on the bridge thread
 * (one thread, so messages keep their order) and returns at once; reading the JSON and the work itself
 * happen there. A failed message is logged by type and never takes PS down.
 */
class BridgeDispatcher(
    private val main: Executor,
    private val bridge: Executor,
    private val handle: (String, JSONObject) -> Unit,
    private val fail: (String, Throwable) -> Unit = { _, _ -> },
) {
    fun onRaw(raw: String) {
        bridge.execute {
            val m = runCatching { JSONObject(raw) }.getOrNull() ?: return@execute
            val type = m.optString("type")
            val run = Runnable { try { handle(type, m) } catch (e: Throwable) { fail(type, e) } }
            if (BridgeRoutes.of(type) == On.MAIN) main.execute(run) else run.run()
        }
    }
}

/**
 * Every use of the Android Keystore goes through [run]: one at a time (keystore2 and the StrongBox chip
 * get slow for everyone when many operations run at once), and never on the main thread. Debug builds
 * throw there, so a slip shows up on the emulator at once. A release build logs it once and goes straight
 * to the Keystore without queueing, as before this gate, rather than crash the developer's phone or make the main
 * thread wait behind video pieces. Reentrant: a gated call may make another gated call.
 */
class KeyGate(private val isMain: () -> Boolean, private val strict: Boolean, private val warn: (String) -> Unit = {}) {
    private val lock = ReentrantLock(true)   // fair: a token or a fingerprint step never starves behind a video
    @Volatile private var warned = false

    fun <T> run(what: String, block: () -> T): T {
        if (isMain()) {
            if (strict) throw IllegalStateException("Keystore on the main thread ($what)")
            if (!warned) { warned = true; warn("Keystore on the main thread ($what)") }
            return block()
        }
        lock.lock()
        try { return block() } finally { lock.unlock() }
    }
}

/**
 * One background video as a single stream of its sealed pieces. A piece is opened (decrypted) only when
 * the player reads into it, and [close] opens nothing. java.io.SequenceInputStream must not be used for
 * this: its close() opens every piece it has not reached yet just to close it, so each time the player
 * let go of a video, PS decrypted the rest of it.
 * A byte range (V1.33): start at piece [first], skip [skip] bytes of it, and stop after [limit] bytes.
 */
class PieceStream(
    private val total: Int,
    first: Int = 0,
    private var skip: Int = 0,
    private var limit: Long = Long.MAX_VALUE,
    private val open: (Int) -> ByteArray,
) : InputStream() {
    private var next = first
    private var cur: ByteArray? = null
    private var pos = 0
    @Volatile private var closed = false

    /** True when there is a byte to read in `cur`, opening the next piece only when the last one is used up. */
    private fun ready(): Boolean {
        while (true) {
            if (closed || limit <= 0) return false
            val c = cur
            if (c != null && pos < c.size) return true
            if (next >= total) return false
            cur = open(next++); pos = minOf(skip, cur!!.size); skip = 0
        }
    }

    override fun read(): Int {
        if (!ready()) return -1
        limit--
        return cur!![pos++].toInt() and 0xff
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (off < 0 || len < 0 || len > b.size - off) throw IndexOutOfBoundsException()
        if (len == 0) return 0
        if (!ready()) return -1
        val c = cur!!
        val n = minOf(len.toLong(), (c.size - pos).toLong(), limit).toInt()
        System.arraycopy(c, pos, b, off, n)
        pos += n
        limit -= n
        return n
    }

    override fun available(): Int = if (closed) 0 else minOf(((cur?.size ?: 0) - pos).toLong(), limit).toInt()

    override fun close() { closed = true; cur = null }
}

/**
 * Lets a repeat of the last value skip a Keystore seal (the page sends the same access token on every
 * auth event). Keeps only a SHA-256 of the value, never the value itself.
 */
class SameAsLast {
    @Volatile private var last: String? = null
    private fun hash(v: String) = MessageDigest.getInstance("SHA-256").digest(v.toByteArray()).joinToString("") { "%02x".format(it) }
    fun same(v: String): Boolean = last == hash(v)
    /** Call once the value really is written. */
    fun wrote(v: String) { last = hash(v) }
    fun forget() { last = null }
}
