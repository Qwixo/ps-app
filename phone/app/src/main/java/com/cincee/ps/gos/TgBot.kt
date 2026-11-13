package com.cincee.ps.gos

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/*
 * Add Telegram Bot (V1.47, the developer 10 Nov 2026: "Make it so other people can add a Telegram bot as well. Add that in the
 * Settings menu as a tab called Add Telegram Bot."). For everyone. The phone's half:
 *  - The bot's key (the token BotFather gives) is pasted in Settings and comes here once ({type:"tg:save"}). It is
 *    sealed with the device key in the Keystore (Keys.kt) in the app's private storage, kept in memory while PS runs,
 *    never logged, never sent back to the page, never synced.
 *  - The relay: the page (web src/tgbot.ts) reads the bot with getUpdates long polling and answers messages.
 *    For each call it sends {type:"tg:call"}; this adds the key (TgCore checks the method and builds the request) and
 *    makes it on its own threads, never the main one and never the bridge thread (a long poll waits up to 30 s), with
 *    the system's own network (no network is ever picked, so VPN rules apply as for everything else). The answer goes
 *    back as {type:"tg:res"}.
 * Nothing runs without a key, and nothing runs while PS is not running (the page asks; no service of its own).
 */

/** The parts with no Android in them, so TgCoreTest runs them on the JVM. */
object TgCore {
    /** Read messages, answer, the Undo button, check the key. Never anything that changes the bot (no webhooks). */
    val methods = setOf("getMe", "getUpdates", "sendMessage", "answerCallbackQuery", "editMessageText")
    const val HOST = "api.telegram.org"
    const val MAX_BODY = 1_000_000
    private val TOKEN = Regex("^[0-9]{5,15}:[A-Za-z0-9_-]{30,60}$")
    private val ID = Regex("^[A-Za-z0-9]{1,40}$")
    fun validToken(s: String?) = s != null && TOKEN.matches(s)
    fun validId(s: String?) = s != null && ID.matches(s)

    data class Req(val url: String, val body: String, val readTimeoutMs: Int)
    /** The request for one call, or null when the method, the key or the body is not acceptable. */
    fun request(token: String?, method: String, params: JSONObject?): Req? {
        if (!validToken(token) || method !in methods) return null
        val p = JSONObject((params ?: JSONObject()).toString())
        if (method == "getUpdates") p.put("timeout", p.optInt("timeout", 0).coerceIn(0, 30))
        val body = p.toString()
        if (body.length > 64_000) return null
        return Req("https://$HOST/bot$token/$method", body, if (method == "getUpdates") 45_000 else 20_000)
    }
    /** The page's answer: Telegram's reply as text, or why there is none. Never the key or the URL. */
    fun answer(id: String, status: Int, body: String?, error: String?): JSONObject {
        val o = JSONObject().put("type", "tg:res").put("id", id).put("status", status)
        return if (body != null && body.length <= MAX_BODY) o.put("body", body) else o.put("error", error ?: if (body == null) "no answer" else "answer too big")
    }
    fun noKey(id: String): JSONObject = JSONObject().put("type", "tg:res").put("id", id).put("status", 0).put("noKey", true)
}

/** One HTTP POST (the tests use a fake): status and body, or an exception when no answer came. */
fun interface TgHttp { fun post(r: TgCore.Req): Pair<Int, String?> }

object TgBot {
    private const val FILE = "tgbot.key"
    @Volatile private var token: String? = null
    @Volatile private var loaded = false
    // Two threads: one long poll can wait while an answer to a message goes out.
    private val net = Executors.newFixedThreadPool(2) { r -> Thread(r, "ps-tg").apply { isDaemon = true } }

    private val http = TgHttp { r ->
        val c = URL(r.url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"; c.doOutput = true; c.useCaches = false
            c.connectTimeout = 15_000; c.readTimeout = r.readTimeoutMs
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(r.body.toByteArray()) }
            val code = c.responseCode
            val s = (if (code in 200..299) c.inputStream else c.errorStream)?.use { st -> st.readBytes().takeIf { it.size <= TgCore.MAX_BODY }?.toString(Charsets.UTF_8) }
            code to s
        } finally { c.disconnect() }
    }

    /** On the bridge thread (WebHost.onMessage), never the main one. True when it was a tg: message. */
    fun handle(c: Context, type: String, m: JSONObject, post: (JSONObject) -> Unit): Boolean {
        if (!type.startsWith("tg:")) return false
        when (type) {
            "tg:get" -> post(changed(c, false))
            "tg:save" -> {
                val t = m.optString("token").trim()
                if (TgCore.validToken(t)) {
                    Keys.write(c, FILE, t); token = t; loaded = true
                    Plog.i("telegram bot: key saved (Keystore)")
                }
                post(changed(c, true))
            }
            "tg:remove" -> { Keys.delete(c, FILE); token = null; loaded = true; Plog.i("telegram bot: key removed"); post(changed(c, true)) }
            "tg:call" -> {
                val id = m.optString("id")
                if (TgCore.validId(id)) {
                    val method = m.optString("method"); val params = m.optJSONObject("params")
                    net.execute { post(call(c, id, method, params, http)) }
                }
            }
        }
        return true
    }

    private fun key(c: Context): String? {
        if (!loaded) { token = Keys.read(c, FILE)?.takeIf { TgCore.validToken(it) }; loaded = true }
        return token
    }
    private fun changed(c: Context, fresh: Boolean) = JSONObject().put("type", "tg:changed").put("saved", key(c) != null).put("fresh", fresh)

    /** One call, on a ps-tg thread. Only the error's class is ever logged: its text could carry the URL, and the URL the key. */
    fun call(c: Context?, id: String, method: String, params: JSONObject?, h: TgHttp, keyOf: () -> String? = { c?.let { key(it) } }): JSONObject {
        val k = keyOf() ?: return TgCore.noKey(id)
        val r = TgCore.request(k, method, params) ?: return TgCore.answer(id, 0, null, "not allowed")
        return runCatching { val (code, body) = h.post(r); TgCore.answer(id, code, body, null) }
            .getOrElse { e -> TgCore.answer(id, 0, null, "network ${e.javaClass.simpleName}") }
    }
}
