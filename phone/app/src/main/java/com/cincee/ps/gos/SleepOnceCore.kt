package com.cincee.ps.gos

import org.json.JSONArray
import org.json.JSONObject

/** One suggested "later" choice on the clock: the minutes to move the next alarm by, and the page's own label. */
data class OnceMins(val mins: Int, val label: String)

/** Every word on the "Just tomorrow" row. They come from the page (translated there); the phone adds none of its own. */
data class OnceWords(
    val title: String, val skip: String, val later: String, val pick: String, val undo: String,
    val save: String, val reason: String, val undoReason: String, val mins: List<OnceMins>,
)

/** The page's "once" block of the sleep plan: the line under the alarm line, and what the row offers. */
data class SleepOnce(val set: Boolean, val skipped: Boolean, val line: String, val usual: String, val words: OnceWords)

/** Pure logic for "Just tomorrow" (SleepActivity draws it, Sleep.kt delivers it). Fast tests in SleepOnceCoreTest. */
object SleepOnceCore {
    const val MAX_LINE = 200
    const val MAX_REASON = 80
    const val MAX_MINS = 24 * 60
    const val IDLE_MS = 20_000L
    private val hhmm = Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$")
    private val authId = Regex("^[A-Za-z0-9_-]{1,24}$")

    fun okTime(s: String?): Boolean = s != null && hhmm.matches(s)

    /** The plan's `once`, or null (feature off, no alarm, or a block that does not make sense): draw nothing. */
    fun decode(o: JSONObject?): SleepOnce? {
        if (o == null) return null
        val line = o.optString("line").trim().take(MAX_LINE)
        val usual = o.optString("usual")
        val w = o.optJSONObject("words") ?: return null
        if (line.isEmpty() || !okTime(usual)) return null
        fun word(k: String) = w.optString(k).trim().take(MAX_LINE)
        val mins = ArrayList<OnceMins>()
        w.optJSONArray("mins")?.let { a: JSONArray ->
            for (i in 0 until minOf(a.length(), 4)) {
                val m = a.optJSONObject(i) ?: continue
                val n = m.optInt("mins", 0)
                val label = m.optString("label").trim().take(40)
                if (n in 1..MAX_MINS && label.isNotEmpty()) mins.add(OnceMins(n, label))
            }
        }
        return SleepOnce(
            set = o.optBoolean("set", false), skipped = o.optBoolean("skipped", false), line = line, usual = usual,
            words = OnceWords(word("title"), word("skip"), word("later"), word("pick"), word("undo"), word("save"), word("reason"), word("undoReason"), mins),
        )
    }

    /** The picker opens at the usual time plus 60 minutes, wrapping past midnight (23:30 gives 00:30). */
    fun pickStart(usual: String): Pair<Int, Int> {
        if (!okTime(usual)) return 8 to 0
        val m = (usual.substring(0, 2).toInt() * 60 + usual.substring(3, 5).toInt() + 60) % (24 * 60)
        return m / 60 to m % 60
    }
    fun hhmm(h: Int, m: Int): String = "%02d:%02d".format(h.coerceIn(0, 23), m.coerceIn(0, 59))

    // What goes back to the page. Built here so the shapes are fixed in one place.
    fun skipJson(): String = JSONObject().put("type", "sleep:once").put("act", "skip").toString()
    fun laterJson(mins: Int): String? = if (mins in 1..MAX_MINS) JSONObject().put("type", "sleep:once").put("act", "later").put("mins", mins).toString() else null
    fun pickJson(at: String): String? = if (okTime(at)) JSONObject().put("type", "sleep:once").put("act", "pick").put("at", at).toString() else null
    fun undoJson(): String = JSONObject().put("type", "sleep:once").put("act", "undo").toString()

    /** Only a choice that passed the owner check goes out. Not passed (or nothing to send): null, nothing is sent. */
    fun gate(passed: Boolean, act: String?): String? = if (passed) act else null

    // The page asking for the owner check ({type:"sleep:auth", id, reason}) and the answer.
    fun okAuthId(id: String?): Boolean = id != null && authId.matches(id)
    fun authReason(r: String?): String = (r ?: "").trim().take(MAX_REASON)
    fun authAnswer(id: String, ok: Boolean, none: Boolean = false): String {
        val o = JSONObject().put("type", "sleep:auth").put("id", id).put("ok", ok && !none)
        if (none) o.put("none", true)
        return o.toString()
    }
}
