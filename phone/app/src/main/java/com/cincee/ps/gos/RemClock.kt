package com.cincee.ps.gos

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * The Annoying 15 min reminder's timing on the phone, with no platform classes in it (unit tested in src/test,
 * RemClockTest). The page (web src/core/remind.ts remPlan) sends a plan: every reminder with its
 * words already worked out and its state (confirmed for which window, snoozed until when). The schedule
 * maths here is the same as remind.ts (cycleDay, windowOn, openWindow, nextStart, remStatus, remNextWake),
 * zone maths included, so the phone opens and closes each window at the same moment as the Mac.
 * An answer given on this phone is kept here (RemAnswer) until the plan comes back with a state at least
 * as new, so a plan that has not heard of it yet never brings the notification back.
 * The built in sounds (RemTones) are the tone tables of web src/core/alarmsound.ts at its one level.
 */
data class RemItem(
    val id: String, val on: Boolean, val pill: String, val text: String, val at: String, val until: String,
    val days: List<Int>, val tz: String, val snooze: Int, val later: String, val yes: String, val word: String,
    val click: Boolean, val bg: String, val accent: String, val ink: String, val sound: String, val vol: Double,
    val done: String, val snoozeUntil: Long, val stateAt: Long,
    // V1.55, reminders on tasks ("" on the list's own): the task's id (Open task), the one day of a once reminder, the
    // third button's words.
    val task: String = "", val date: String = "", val open: String = "",
)
/** One window: the day it starts on (in the reminder's zone), when it opens and when it stops opening. */
data class RemWindow(val day: String, val start: Long, val end: Long)
/** This phone's own answer: "done" for a window day, or "snooze" until a time. `at` is when it was given. */
data class RemAnswer(val id: String, val act: String, val day: String, val until: Long, val at: Long)
enum class RemStatus { OFF, DONE, CLOSED, SNOOZED, SHOW }

object RemClock {
    const val MAX = 80   // the list's 20 and 60 on tasks (web core/remind.ts REM_ALL_MAX)
    const val SNOOZE_DEF = 15
    const val VOL_DEF = 0.8
    const val BG = "#28121e"
    const val ACCENT = "#ec4e86"
    val SOUNDS = setOf("none", "soft", "alarm", "own")
    private val ID = Regex("^[a-z0-9]{1,16}$")
    private val HHMM = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
    private val DAY = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    private val HEX = Regex("^#[0-9a-f]{6}$")
    private val ZONE = Regex("^[A-Za-z0-9_+\\-/]{1,64}$")
    private val TASK = Regex("^[A-Za-z0-9-]{1,64}$")
    fun okTask(id: String?) = id != null && TASK.matches(id)

    fun okId(id: String?) = id != null && ID.matches(id)

    // ---------- the plan ----------
    /** {v:1, items:[...]}: every item that is good, at most MAX, no id twice. A broken item is skipped, never the plan. */
    fun parse(plan: JSONObject?): List<RemItem> {
        val a = plan?.optJSONArray("items") ?: return emptyList()
        val out = ArrayList<RemItem>()
        for (i in 0 until a.length()) {
            val it = a.optJSONObject(i)?.let { o -> runCatching { item(o) }.getOrNull() } ?: continue
            if (out.none { o -> o.id == it.id } && out.size < MAX) out.add(it)
        }
        return out
    }
    fun parseList(s: String?): List<RemItem> = runCatching { parse(JSONObject().put("items", JSONArray(s ?: return emptyList()))) }.getOrDefault(emptyList())

    /** One plan item, checked field by field. Null when it cannot be scheduled (no good id, start or end). */
    fun item(o: JSONObject): RemItem? {
        val id = o.optString("id")
        val at = o.optString("at"); val until = o.optString("until")
        if (!okId(id) || !HHMM.matches(at) || !HHMM.matches(until)) return null
        val snooze = num(o, "snooze", SNOOZE_DEF.toDouble()).coerceIn(1.0, 240.0).let { Math.round(it).toInt() }
        val yes = line(o, "yes").ifEmpty { "Yes" }
        val task = o.optString("task").takeIf { okTask(it) } ?: ""
        return RemItem(
            id = id, on = if (o.has("on")) o.optBoolean("on", true) else true,
            pill = line(o, "pill").ifEmpty { "Daily reminder" },
            text = line(o, "text", 120).ifEmpty { "HAVE YOU DONE YOUR DAILY TASK YET?" },
            at = at, until = until, days = days(o.opt("days")), tz = okTz(o.optString("tz")),
            snooze = snooze,
            later = line(o, "later").ifEmpty { "Remind me in $snooze mins" },
            yes = yes, word = line(o, "word").ifEmpty { yes }, click = o.optBoolean("click", false),
            bg = hex(o.optString("bg"), BG), accent = hex(o.optString("accent"), ACCENT), ink = hex(o.optString("ink"), "#ffffff"),
            sound = o.optString("sound").takeIf { it in SOUNDS } ?: "none",
            vol = Math.round(num(o, "vol", VOL_DEF).coerceIn(0.1, 1.0) * 100) / 100.0,
            done = o.optString("done").takeIf { DAY.matches(it) } ?: "",
            snoozeUntil = o.optLong("snoozeUntil", 0).coerceAtLeast(0),
            stateAt = o.optLong("stateAt", 0).coerceAtLeast(0),
            task = task,
            date = if (task.isEmpty()) "" else o.optString("date").takeIf { DAY.matches(it) } ?: "",
            open = if (task.isEmpty()) "" else line(o, "open", 30),
        )
    }
    fun toJson(r: RemItem): JSONObject = JSONObject().put("id", r.id).put("on", r.on).put("pill", r.pill).put("text", r.text)
        .put("at", r.at).put("until", r.until).put("days", JSONArray(r.days)).put("tz", r.tz).put("snooze", r.snooze)
        .put("later", r.later).put("yes", r.yes).put("word", r.word).put("click", r.click).put("bg", r.bg).put("accent", r.accent)
        .put("ink", r.ink).put("sound", r.sound).put("vol", r.vol).put("done", r.done).put("snoozeUntil", r.snoozeUntil).put("stateAt", r.stateAt)
        .put("task", r.task).put("date", r.date).put("open", r.open)
    fun listJson(items: List<RemItem>): JSONArray = JSONArray().apply { items.forEach { put(toJson(it)) } }

    private fun num(o: JSONObject, k: String, def: Double): Double {
        val v = o.opt(k)
        val d = when (v) { is Number -> v.toDouble(); is String -> v.trim().toDoubleOrNull(); else -> null }
        return if (d == null || d.isNaN() || d.isInfinite()) def else d
    }
    /** One line, no control characters, trimmed, at most `max` characters. */
    private fun line(o: JSONObject, k: String, max: Int = 60): String {
        val v = o.opt(k) as? String ?: return ""
        return v.take(400).replace(Regex("[\\u0000-\\u001f\\u007f-\\u009f]"), "").trim().take(max).trim()
    }
    private fun hex(v: String, def: String) = v.lowercase().takeIf { HEX.matches(it) } ?: def
    private fun days(v: Any?): List<Int> {
        val a = v as? JSONArray ?: return (0..6).toList()
        val out = sortedSetOf<Int>()
        for (i in 0 until a.length()) { val d = a.opt(i); if (d is Int && d in 0..6) out.add(d) else if (d is Number && d.toDouble() == d.toInt().toDouble() && d.toInt() in 0..6) out.add(d.toInt()) }
        return out.toList()
    }
    /** An IANA zone this phone knows, else "" (the phone's own zone). */
    fun okTz(v: String): String = if (v.isNotEmpty() && ZONE.matches(v) && runCatching { ZoneId.of(v) }.isSuccess) v else ""

    // ---------- the schedule (remind.ts) ----------
    fun zoneOf(r: RemItem, device: ZoneId): ZoneId = if (r.tz.isEmpty()) device else runCatching { ZoneId.of(r.tz) }.getOrDefault(device)
    fun minutesOf(hm: String): Int = hm.substring(0, 2).toInt() * 60 + hm.substring(3, 5).toInt()
    fun addDays(day: String, n: Int): String = LocalDate.parse(day).plusDays(n.toLong()).toString()
    /** 0 Sunday to 6 Saturday. */
    fun weekdayOf(day: String): Int = LocalDate.parse(day).dayOfWeek.value % 7
    private fun dayKey(ts: Long, z: ZoneId): String = Instant.ofEpochMilli(ts).atZone(z).toLocalDate().toString()
    private fun offsetMin(ts: Long, z: ZoneId): Long = z.rules.getOffset(Instant.ofEpochMilli(ts)).totalSeconds / 60L
    /** A wall clock time in a zone to the real moment: tz.ts zonedToTs step for step, so a time that does not exist
     *  (a spring forward gap) or exists twice (a fall back hour) lands where the page and the Mac put it. */
    fun zonedToTs(day: String, hm: String, z: ZoneId): Long {
        val d = LocalDate.parse(day)
        val guess = d.atTime(hm.substring(0, 2).toInt(), hm.substring(3, 5).toInt()).toInstant(ZoneOffset.UTC).toEpochMilli()
        var ts = guess - offsetMin(guess, z) * 60_000
        ts = guess - offsetMin(ts, z) * 60_000
        return ts
    }
    /** The window that starts on `day`, whatever the days picked. `until` at or before `at`: it ends the next day. */
    fun windowOn(r: RemItem, day: String, device: ZoneId): RemWindow {
        val z = zoneOf(r, device)
        val over = minutesOf(r.until) <= minutesOf(r.at)
        return RemWindow(day, zonedToTs(day, r.at, z), zonedToTs(if (over) addDays(day, 1) else day, r.until, z))
    }
    /** From the start time on it is that day's window, before it the day before's. */
    fun cycleDay(r: RemItem, now: Long, device: ZoneId): String {
        val w = Instant.ofEpochMilli(now).atZone(zoneOf(r, device))
        val today = w.toLocalDate().toString()
        return if (w.hour * 60 + w.minute < minutesOf(r.at)) addDays(today, -1) else today
    }
    /** May a window start on this day? A once reminder (V1.55): that one day. Else: one of the days picked. */
    fun startsOn(r: RemItem, day: String): Boolean = if (r.date.isNotEmpty()) day == r.date else weekdayOf(day) in r.days
    private fun anyDay(r: RemItem) = r.date.isNotEmpty() || r.days.isNotEmpty()
    fun openWindow(r: RemItem, now: Long, device: ZoneId): RemWindow? {
        if (!r.on || !anyDay(r)) return null
        val w = windowOn(r, cycleDay(r, now, device), device)
        return if (startsOn(r, w.day) && now >= w.start && now < w.end) w else null
    }
    /** The next window start after `now` on a picked day (within 8 days), 0 when none. */
    fun nextStart(r: RemItem, now: Long, device: ZoneId): Long {
        if (!r.on || !anyDay(r)) return 0
        if (r.date.isNotEmpty()) { val s = windowOn(r, r.date, device).start; return if (s > now) s else 0 }
        val today = dayKey(now, zoneOf(r, device))
        for (i in -1..8) {
            val day = addDays(today, i)
            if (!startsOn(r, day)) continue
            val s = windowOn(r, day, device).start
            if (s > now) return s
        }
        return 0
    }
    /** What it is doing now, from the item's own state (merge it with this phone's answer first). A notification
     *  already up when the window closes is the shell's to keep (this says CLOSED). */
    fun status(r: RemItem, now: Long, device: ZoneId): RemStatus = when {
        !r.on -> RemStatus.OFF
        r.done.isNotEmpty() && r.done == cycleDay(r, now, device) -> RemStatus.DONE
        openWindow(r, now, device) == null -> RemStatus.CLOSED
        r.snoozeUntil > now -> RemStatus.SNOOZED
        else -> RemStatus.SHOW
    }
    /** When anything about it can change next (a window opens or closes, a snooze ends), 0 when never. */
    fun nextWake(r: RemItem, now: Long, device: ZoneId): Long {
        val t = ArrayList<Long>()
        nextStart(r, now, device).takeIf { it > 0 }?.let(t::add)
        openWindow(r, now, device)?.let { t.add(it.end) }
        if (r.snoozeUntil > now) t.add(r.snoozeUntil)
        return t.minOrNull() ?: 0
    }
    /** The one alarm for every reminder: the soonest wake, 0 when none. */
    fun soonest(items: List<RemItem>, now: Long, device: ZoneId): Long = items.map { nextWake(it, now, device) }.filter { it > 0 }.minOrNull() ?: 0

    // ---------- answers ----------
    /** Does what was typed clear it? Any case, spaces at the ends trimmed; one tap when `click`. */
    fun confirms(r: RemItem, typed: String?): Boolean = r.click || (typed ?: "").trim().lowercase() == r.word.trim().lowercase()
    fun doneAct(r: RemItem, now: Long, device: ZoneId) = RemAnswer(r.id, "done", cycleDay(r, now, device), 0, now)
    fun snoozeAct(r: RemItem, now: Long) = RemAnswer(r.id, "snooze", "", now + r.snooze * 60_000L, now)
    /** The plan item with this phone's own answer, when that answer is newer than the item's state (the page has
     *  not heard of it yet). Same as remind.ts applyAct: done replaces the state, a snooze keeps the done day. */
    fun merge(r: RemItem, a: RemAnswer?): RemItem = when {
        a == null || a.id != r.id || a.at <= r.stateAt -> r
        a.act == "done" -> r.copy(done = a.day, snoozeUntil = 0, stateAt = a.at)
        a.act == "snooze" -> r.copy(snoozeUntil = a.until, stateAt = a.at)
        else -> r
    }
    /** Answers still worth keeping: their reminder is in the plan and the plan has not caught up with them yet. */
    fun keepAnswers(items: List<RemItem>, answers: Map<String, RemAnswer>): Map<String, RemAnswer> =
        answers.filter { (id, a) -> items.firstOrNull { it.id == id }?.let { a.at > it.stateAt } == true }

    /** {type:"remAct", ...} for the page. */
    fun actJson(a: RemAnswer): JSONObject = JSONObject().put("type", "remAct").put("id", a.id).put("act", a.act).apply {
        if (a.act == "done") put("day", a.day) else put("until", a.until)
    }.put("at", a.at).put("by", "phone")
    fun answerJson(a: RemAnswer): JSONObject = JSONObject().put("id", a.id).put("act", a.act).put("day", a.day).put("until", a.until).put("at", a.at)
    fun answerFrom(o: JSONObject?): RemAnswer? {
        o ?: return null
        val id = o.optString("id"); val act = o.optString("act"); val at = o.optLong("at", 0)
        if (!okId(id) || at <= 0) return null
        return when (act) {
            "done" -> o.optString("day").takeIf { DAY.matches(it) }?.let { RemAnswer(id, act, it, 0, at) }
            "snooze" -> o.optLong("until", 0).takeIf { it > 0 }?.let { RemAnswer(id, act, "", it, at) }
            else -> null
        }
    }
    fun answersFrom(s: String?): Map<String, RemAnswer> {
        val o = runCatching { JSONObject(s ?: return emptyMap()) }.getOrNull() ?: return emptyMap()
        val out = HashMap<String, RemAnswer>()
        for (k in o.keys()) answerFrom(o.optJSONObject(k))?.takeIf { it.id == k }?.let { out[k] = it }
        return out
    }
    fun answersJson(m: Map<String, RemAnswer>): JSONObject = JSONObject().apply { m.forEach { (k, a) -> put(k, answerJson(a)) } }
}

/**
 * The built in sounds, as web src/core/alarmsound.ts makes them (TONES, renderTones, normalise): the same
 * tone tables, brought to the one level (the loudest 400 ms at -12 dB), one loop, as a 16 bit mono WAV.
 */
object RemTones {
    data class Tone(val f: Double, val dur: Double, val peak: Double, val wave: Int, val at: Double)   // wave: 0 sine, 1 triangle, 2 square
    const val RATE = 44100
    const val TARGET_DB = -12.0
    const val MAX_GAIN_DB = 30.0
    const val KNEE = 0.8
    val SOFT = listOf(Tone(660.0, 0.9, 0.3, 0, 0.0), Tone(880.0, 0.9, 0.28, 0, 0.22), Tone(990.0, 1.2, 0.26, 0, 0.44)) to 2.6
    val ALARM = (0..3).flatMap { i -> listOf(Tone(1046.0, 0.12, 0.3, 2, i * 0.16), Tone(784.0, 0.12, 0.34, 0, i * 0.16)) } to 1.3

    fun fromDb(d: Double) = Math.pow(10.0, d / 20)
    fun loudestOf(x: FloatArray, rate: Int, win: Double = 0.4, hop: Double = 0.1): Double {
        val n = x.size
        if (n == 0) return 0.0
        val w = maxOf(1, minOf(n, Math.round(win * rate).toInt())); val h = maxOf(1, Math.round(hop * rate).toInt())
        val sq = DoubleArray(n + 1)
        for (i in 0 until n) sq[i + 1] = sq[i] + x[i].toDouble() * x[i]
        var best = 0.0
        var s = 0
        while (s + w <= n) { best = maxOf(best, (sq[s + w] - sq[s]) / w); s += h }
        best = maxOf(best, (sq[n] - sq[n - w]) / w)
        return Math.sqrt(best)
    }
    fun soften(v: Double): Double {
        val a = Math.abs(v)
        if (a <= KNEE) return v
        return Math.signum(v) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)))
    }
    fun gainFor(loudest: Double): Double = if (!(loudest > 1e-6)) 1.0 else minOf(fromDb(MAX_GAIN_DB), fromDb(TARGET_DB) / loudest)
    fun normalise(x: FloatArray, rate: Int): FloatArray {
        val loud = loudestOf(x, rate); val max = fromDb(MAX_GAIN_DB)
        var g = gainFor(loud)
        val out = FloatArray(x.size)
        for (pass in 0 until 3) {
            for (i in x.indices) out[i] = soften(x[i] * g).toFloat()
            if (!(loud > 1e-6)) break
            val got = loudestOf(out, rate); val want = fromDb(TARGET_DB)
            if (got >= want * fromDb(-0.25) || g >= max) break
            g = minOf(max, g * want / got)
        }
        return out
    }
    fun renderTones(tones: List<Tone>, loop: Double, rate: Int = RATE): FloatArray {
        val n = Math.round(loop * rate).toInt()
        val buf = FloatArray(n)
        for (t in tones) {
            val start = Math.round(t.at * rate).toInt(); val len = Math.round(t.dur * rate).toInt()
            var phase = 0.0
            var i = 0
            while (i < len && start + i < n) {
                val x = i.toDouble() / rate
                phase += t.f / rate
                val p = phase - Math.floor(phase)
                val w = when (t.wave) { 0 -> Math.sin(2 * Math.PI * p); 1 -> 4 * Math.abs(p - 0.5) - 1; else -> if (p < 0.5) 1.0 else -1.0 }
                val attack = 0.004
                val env = if (x < attack) x / attack else Math.exp(-6.9 * (x - attack) / maxOf(0.001, t.dur - attack))
                buf[start + i] = (buf[start + i] + w * env * t.peak).toFloat()
                i++
            }
        }
        return buf
    }
    /** "soft" or "alarm" (anything else: soft), one loop at the one level. */
    fun builtIn(kind: String): FloatArray { val (t, loop) = if (kind == "alarm") ALARM else SOFT; return normalise(renderTones(t, loop), RATE) }
    fun wavBytes(x: FloatArray, rate: Int = RATE): ByteArray {
        val n = x.size
        val b = java.nio.ByteBuffer.allocate(44 + n * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()).putInt(36 + n * 2).put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(rate).putInt(rate * 2).putShort(2).putShort(16)
        b.put("data".toByteArray()).putInt(n * 2)
        for (v in x) b.putShort(Math.round(maxOf(-1f, minOf(1f, v)) * 32767f).toShort())
        return b.array()
    }
}
