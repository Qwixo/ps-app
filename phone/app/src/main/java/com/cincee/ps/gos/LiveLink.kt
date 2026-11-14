package com.cincee.ps.gos

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.security.SecureRandom
import java.util.Base64
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * The live link (V1.59): one quiet Supabase Realtime connection kept by PS itself while the island's service runs
 * (LiveService in Island.kt), so a new client email, lead reply, AI message or finished chat shows within seconds
 * instead of at the next background check. Why and the rules: LiveClock.kt.
 *
 * It only listens. It joins the owner's two private topics with the page's current access token (Session, never the
 * refresh token), hears empty signals, and on one wakes the page once for its usual change only sync (Pulse.now).
 * Its own small websocket client (RFC 6455 over the system TLS, host name checked), so no new library goes into the APK.
 * Everything runs on its own two threads, never the main one. Logs say what happened, never a token or an id.
 */
object LiveLink {
    private val ht = HandlerThread("ps-live").apply { start() }
    private val h = Handler(ht.looper)
    private lateinit var app: Context
    private var running = false
    private var conn: Conn? = null
    private var tries = 0
    private var ref = 1
    private var token: String? = null
    private var tokenExp = 0L
    private var topics: List<String> = emptyList()
    private var refused = mutableSetOf<String>()
    private var downSince = 0L
    private var lastAsk = 0L
    private var lastWake = 0L
    private var wakeSet = false
    /** Is the link up (joined)? Read by Settings and the log. */
    @Volatile var up = false; private set
    /** When the last signal came (elapsed ms), so the notification can log how long it took. */
    @Volatile var lastSignalAt = 0L; private set

    fun start(c: Context) { app = c.applicationContext; h.post { if (!running) { running = true; Plog.i("live: start"); listenNet(); connect() } } }
    fun stop() { h.post { if (running) { running = false; Plog.i("live: stop"); unlistenNet(); drop("stopped"); h.removeCallbacksAndMessages(null); wakeSet = false } } }
    /** A new access token from the page (Session.save) or the network came back: use it now. */
    fun kick() { h.post { if (!running) return@post; if (conn == null) { tries = 0; h.removeCallbacks(connectR); connect() } else freshToken() } }

    private val connectR = Runnable { connect() }
    private val beatR = object : Runnable { override fun run() { conn?.let { c -> if (!c.send(LiveClock.heartbeat(ref++))) drop("heartbeat failed") else h.postDelayed(this, LiveClock.HEARTBEAT_MS) } } }
    private val tokenR = Runnable { freshToken() }
    private val wakeR = Runnable { wakeSet = false; lastWake = SystemClock.elapsedRealtime(); Pulse.now(app, force = true, why = "live") }

    private fun connect() {
        if (!running || conn != null) return
        if (!Net.online(app)) { up = false; return }   // the network callback brings it back
        val cur = Session.current(app)
        if (cur == null || cur.second <= System.currentTimeMillis() + 60_000) { up = false; askToken(); return }
        val uid = LiveClock.uid(cur.first) ?: return
        token = cur.first; tokenExp = cur.second
        topics = LiveClock.topics(uid).filter { it !in refused }
        val host = java.net.URL(BuildConfig.SUPABASE_URL).host
        val c = Conn(host, "/realtime/v1/websocket?apikey=${BuildConfig.SUPABASE_KEY}&vsn=1.0.0")
        conn = c
        c.start()
    }

    private fun opened(c: Conn) {
        if (c !== conn) return
        val t = token ?: return
        topics.forEach { c.send(LiveClock.join(it, t, ref++)) }
        h.removeCallbacks(beatR); h.postDelayed(beatR, LiveClock.HEARTBEAT_MS)
        h.removeCallbacks(tokenR); h.postDelayed(tokenR, (tokenExp - LiveClock.TOKEN_EARLY_MS - System.currentTimeMillis()).coerceAtLeast(5_000))
    }

    private fun text(c: Conn, s: String) {
        if (c !== conn) return
        when (LiveClock.heard(s)) {
            LiveClock.Heard.SIGNAL -> signal()
            LiveClock.Heard.JOINED -> {
                if (!up) {
                    up = true; tries = 0
                    val gap = if (downSince > 0) SystemClock.elapsedRealtime() - downSince else 0
                    Plog.i("live: up${if (gap > 0) " after ${gap / 1000} s down" else ""}")
                    // Down for a while: a signal may have been missed, so one tiny probe (no page wake unless it changed).
                    if (gap > LiveClock.HEARTBEAT_MS) Pulse.now(app, force = false, why = "live back")
                    downSince = 0
                }
            }
            LiveClock.Heard.REFUSED -> runCatching { org.json.JSONObject(s).optString("topic") }.getOrNull()?.let { t ->
                // inbox:<id> is the developer's own server signal: anyone else is refused once, then not asked again this run.
                if (t.startsWith("realtime:inbox:") && refused.add(t)) Plog.i("live: no inbox signal on this account (cards come with pokes and checks)")
            }
            LiveClock.Heard.CLOSED -> drop("closed by the server")
            LiveClock.Heard.NOTHING -> {}
        }
    }

    private fun signal() {
        lastSignalAt = SystemClock.elapsedRealtime()
        Plog.i("live: signal")
        if (wakeSet) return
        wakeSet = true
        val now = SystemClock.elapsedRealtime()
        h.postDelayed(wakeR, (LiveClock.wakeAt(now, lastWake) - now).coerceAtLeast(0))
    }

    private fun gone(c: Conn, why: String) { if (c === conn) drop(why) }
    private fun drop(why: String) {
        val c = conn
        conn = null
        h.removeCallbacks(beatR); h.removeCallbacks(tokenR)
        if (c != null) { c.close(); Plog.i("live: down ($why)") }
        if (up || downSince == 0L) downSince = SystemClock.elapsedRealtime()
        up = false
        if (running) { h.removeCallbacks(connectR); h.postDelayed(connectR, LiveClock.backoff(tries++)) }
    }

    /** The token runs out soon: a newer one from the page if it has one, else wake the page once to renew it. */
    private fun freshToken() {
        val cur = Session.current(app)
        if (cur != null && cur.first != token && cur.second > System.currentTimeMillis() + 60_000) {
            token = cur.first; tokenExp = cur.second
            val c = conn
            if (c == null) { connect(); return }
            topics.forEach { c.send(LiveClock.accessToken(it, cur.first, ref++)) }
            h.removeCallbacks(tokenR); h.postDelayed(tokenR, (tokenExp - LiveClock.TOKEN_EARLY_MS - System.currentTimeMillis()).coerceAtLeast(5_000))
            return
        }
        if (LiveClock.tokenDue(tokenExp, System.currentTimeMillis())) askToken()
        h.removeCallbacks(tokenR); h.postDelayed(tokenR, 60_000)
    }
    /** No usable token: the page renews it on its next wake and sends it (bridge "session" -> kick). At most every 10 minutes. */
    private fun askToken() {
        val now = SystemClock.elapsedRealtime()
        if (lastAsk > 0 && now - lastAsk < 600_000) return
        lastAsk = now
        Pulse.now(app, force = false, why = "token")
    }

    // ---------- the network ----------
    private var net: ConnectivityManager.NetworkCallback? = null
    private fun listenNet() {
        val cm = app.getSystemService(ConnectivityManager::class.java)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(n: Network) { h.post { if (running && conn == null) { tries = 0; h.removeCallbacks(connectR); connect() } } }
            override fun onLost(n: Network) { h.post { if (running && !Net.online(app)) drop("network lost") } }
        }
        runCatching { cm.registerDefaultNetworkCallback(cb, h); net = cb }
    }
    private fun unlistenNet() { net?.let { cb -> runCatching { app.getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(cb) } }; net = null }

    // ---------- one websocket ----------
    private class Conn(val host: String, val path: String) {
        @Volatile private var sock: Socket? = null
        @Volatile private var out: OutputStream? = null
        private val rnd = SecureRandom()
        fun start() = Thread({ run() }, "ps-live-read").apply { isDaemon = true }.start()

        private fun run() {
            var why = "closed"
            try {
                val plain = Socket()
                plain.connect(InetSocketAddress(host, 443), 15_000)
                val s = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(plain, host, 443, true) as SSLSocket
                s.sslParameters = s.sslParameters.apply { endpointIdentificationAlgorithm = "HTTPS" }
                s.soTimeout = LiveClock.READ_TIMEOUT_MS
                s.startHandshake()
                if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, s.session)) throw java.io.IOException("host name")
                sock = s
                val o = s.outputStream
                val key = Base64.getEncoder().encodeToString(ByteArray(16).also(rnd::nextBytes))
                o.write(("GET $path HTTP/1.1\r\nHost: $host\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                    "Sec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\nUser-Agent: PS app\r\n\r\n").toByteArray())
                o.flush()
                val inp = DataInputStream(BufferedInputStream(s.inputStream))
                val head = readHead(inp)
                if (!head.startsWith("HTTP/1.1 101")) throw java.io.IOException("no upgrade (${head.substringBefore('\r').take(40)})")
                val accept = head.lineSequence().firstOrNull { it.lowercase().startsWith("sec-websocket-accept:") }?.substringAfter(':')?.trim()
                if (accept != WsFrame.accept(key)) throw java.io.IOException("bad accept")
                out = o
                h.post { opened(this) }
                val msg = java.io.ByteArrayOutputStream()
                while (true) {
                    val b0 = inp.readUnsignedByte(); val b1 = inp.readUnsignedByte()
                    val fin = b0 and 0x80 != 0; val op = b0 and 0x0f
                    var len = (b1 and 0x7f).toLong()
                    if (len == 126L) len = inp.readUnsignedShort().toLong() else if (len == 127L) len = inp.readLong()
                    if (len < 0 || len > (1 shl 20)) throw java.io.IOException("frame too big")
                    val mask = if (b1 and 0x80 != 0) ByteArray(4).also { inp.readFully(it) } else null
                    val p = ByteArray(len.toInt()).also { inp.readFully(it) }
                    if (mask != null) for (i in p.indices) p[i] = (p[i].toInt() xor mask[i % 4].toInt()).toByte()
                    when (op) {
                        WsFrame.TEXT, WsFrame.CONT -> {
                            msg.write(p)
                            if (msg.size() > (1 shl 20)) throw java.io.IOException("message too big")
                            if (fin) { val t = msg.toString("UTF-8"); msg.reset(); h.post { text(this, t) } }
                        }
                        WsFrame.PING -> frame(WsFrame.PONG, p)
                        WsFrame.CLOSE -> { why = "closed by the server"; break }
                        else -> {}
                    }
                }
            } catch (e: Exception) {
                why = e.javaClass.simpleName   // the class only: a message could carry the address with the key
            }
            runCatching { sock?.close() }
            h.post { gone(this, why) }
        }

        private fun readHead(inp: DataInputStream): String {
            val sb = StringBuilder()
            while (sb.length < 8192) {
                sb.append(inp.readUnsignedByte().toChar())
                if (sb.endsWith("\r\n\r\n")) return sb.toString()
            }
            throw java.io.IOException("head too long")
        }

        @Synchronized private fun frame(op: Int, p: ByteArray): Boolean {
            val o = out ?: return false
            return runCatching { o.write(WsFrame.encode(op, p, ByteArray(4).also(rnd::nextBytes))); o.flush() }.isSuccess
        }
        fun send(text: String): Boolean = frame(WsFrame.TEXT, text.toByteArray())
        fun close() { runCatching { frame(WsFrame.CLOSE, byteArrayOf(0x03, 0xE8.toByte())) }; out = null; runCatching { sock?.close() } }
    }
}
