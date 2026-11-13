package com.cincee.ps.gos

import org.json.JSONObject

/**
 * Sleep mode's timing on the phone, with no Android in it (unit tested in src/test, SleepClockTest). The page
 * (web src/core/sleepmode.ts) hands over a plan: when you went to sleep, the alarm times (ms), when the
 * panel rises, the counts (titles only with "Show full details" on), the G Squad count, and every sentence the
 * screen shows. From it the shell rings on time and draws the screen while the page sleeps.
 */
/** V1.43: `style` is how it wakes you, `from` when its light starts (Sunrise: before the alarm; else the alarm time). */
/** V1.47 `sound`: this alarm's own choice, "list" the day's playlist file, "style" the usual sound, "" (an older page, or
 *  no choice) the playlist when the plan has one. */
data class SleepRing(val id: String, val at: Long, val label: String, val style: String = "chime", val from: Long = at, val sound: String = "") { val key get() = "$id@$at" }
/** V1.42 Customise (web core/sleepmode.ts PlanLook): how the screen looks. An older page sends none: the
 *  V1.40 look. Colours are 0xRRGGBB. */
data class SleepLook(
    val size: Double = 100.0, val font: String = "thin", val h12: Boolean = false, val secs: Boolean = false,
    val ink: Int = 0xE7A35E, val bright: Float = 0.78f, val bg: Int = 0x050302, val pos: String = "center",
    val show: Map<String, Boolean> = emptyMap(), val watch: String = "small",
    // V1.43: the other words' colour (0xRRGGBB), the weight (0: the font's own), letter spacing (hundredths of the size)
    val text: Int = 0xE7A35E, val weight: Int = 0, val spacing: Double = 0.0,
    // V1.43 the analogue face: digital or analogue, its marks, the second hand, its own colours, the small time under it
    val face: String = "digital", val dial: String = "ticks", val hand: String = "sweep",
    val faceInk: Int = 0xE7A35E, val handInk: Int = 0xE7A35E, val tickInk: Int = 0xE7A35E, val digi: Boolean = true,
) {
    fun shows(k: String) = show[k] ?: (k != "date" && k != "count")
}
/** The stopwatch, kept as times so it is right however few ticks the screen draws (and across the power button). */
data class SleepWatch(val run: Boolean = false, val from: Long = 0, val acc: Long = 0) {
    fun ms(now: Long) = maxOf(0L, acc + if (run) now - from else 0L)
    fun toggled(now: Long) = if (run) SleepWatch(false, 0, ms(now)) else SleepWatch(true, now, acc)
}
data class SleepPlan(
    val since: Long, val rings: List<SleepRing>, val wake: Long?, val panel: Long?, val details: Boolean,
    val count: Int, val titles: List<String>, val squad: Int?, val words: Map<String, String>,
    val look: SleepLook = SleepLook(),
    val lock: Boolean = true,    // V1.43: Wake up and Customise pass the phone's unlock first (default, as before)
    // V1.43 wake styles: Colour wave's colour, the sunrise's minutes, Strobe flash switched on, the timer's style;
    // "Wake me up in": the page's suggestions and the timer set for this sleep.
    val wave: Int = 0x4F7CFF, val sunrise: Int = 20, val strobe: Boolean = false, val timerStyle: String = "chime",
    // V1.44: the alarm loudness (web core/alarmsound.ts): the phone's alarm volume while an alarm rings.
    val level: Double = SleepClock.LEVEL_DEF,
    val wakeIn: List<WakeChoice> = SleepClock.WAKE_IN_FALLBACK, val timer: Pair<Long, Int>? = null,
    val alarmOnly: Boolean = false,   // V1.47: an alarm with Sleep mode off: only Stop, nothing logged
) {
    fun word(k: String, fallback: String) = words[k]?.takeIf { it.isNotBlank() } ?: fallback
}

data class WakeChoice(val name: String, val mins: Int, val sleep: Int)

object SleepClock {
    /** A ring stops by itself after 10 minutes (like the gym ring); one missed by up to 5 minutes still rings. */
    const val RING_FOR = 10 * 60_000L
    const val RING_GRACE = 5 * 60_000L
    /** The power button pressed twice within this: the screen stays dark (the clock does not come back). */
    const val DARK_AGAIN = 20_000L
    /** Wake up waits this long for the phone's unlock prompt; then Sleep mode ends anyway (the phone stays locked). */
    const val UNLOCK_WAIT = 45_000L
    const val DRIFT = 6.0
    const val DRIFT_EVERY = 90_000L

    fun parse(s: String?): SleepPlan? = runCatching { from(JSONObject(s ?: return null)) }.getOrNull()
    fun from(j: JSONObject): SleepPlan? {
        val since = j.optLong("since")
        if (since <= 0) return null
        val st = j.optJSONObject("styles")
        val strobe = st?.opt("strobe") as? Boolean ?: false
        val rings = ArrayList<SleepRing>()
        j.optJSONArray("rings")?.let { a ->
            for (i in 0 until minOf(a.length(), 6)) {
                val o = a.optJSONObject(i) ?: continue
                val at = o.optLong("at"); val id = o.optString("id").take(24)
                if (at <= 0 || id.isEmpty()) continue
                // Only Sunrise lights up before its alarm, and never more than 30 minutes before.
                val style = style(o.optString("style"), strobe)
                val from = if (style == "sunrise") o.optLong("from", at).coerceIn(at - 30 * 60_000L, at) else at
                rings.add(SleepRing(id, at, o.optString("label").take(5), style, from, o.optString("sound").takeIf { okSound(it) } ?: ""))
            }
        }
        val choices = ArrayList<WakeChoice>()
        j.optJSONArray("wakeIn")?.let { a ->
            for (i in 0 until minOf(a.length(), 10)) {
                val o = a.optJSONObject(i) ?: continue
                val m = o.optInt("mins"); val n = o.optString("name").take(30)
                if (okWakeIn(m) != null && n.isNotBlank()) choices.add(WakeChoice(n, m, o.optInt("sleep", m)))
            }
        }
        val tj = j.optJSONObject("timer")
        val t = j.optJSONObject("tasks")
        val details = j.optBoolean("details")
        // Counts only unless full details is on: titles are dropped here as well, whatever the page sent.
        val titles = ArrayList<String>()
        if (details) t?.optJSONArray("titles")?.let { a -> for (i in 0 until minOf(a.length(), 6)) a.optString(i).take(90).takeIf { it.isNotBlank() }?.let(titles::add) }
        val words = HashMap<String, String>()
        j.optJSONObject("words")?.let { w -> for (k in w.keys()) w.optString(k).takeIf { it.isNotEmpty() && !w.isNull(k) }?.let { words[k] = it.take(200) } }
        return SleepPlan(
            since = since, rings = rings.sortedBy { it.at },
            wake = j.optLong("wake").takeIf { it > 0 && !j.isNull("wake") },
            panel = j.optLong("panel").takeIf { it > 0 && !j.isNull("panel") },
            details = details, count = t?.optInt("count")?.coerceAtLeast(0) ?: 0, titles = titles,
            squad = if (j.has("squad") && !j.isNull("squad")) j.optInt("squad").coerceAtLeast(0) else null,
            words = words,
            look = look(j.optJSONObject("look")),
            lock = j.opt("lock") as? Boolean ?: true,
            wave = st?.optString("wave")?.takeIf { Regex("^#[0-9a-fA-F]{6}$").matches(it) }?.drop(1)?.toInt(16) ?: 0x4F7CFF,
            sunrise = st?.optInt("sunrise")?.takeIf { it in listOf(10, 20, 30) } ?: 20,
            strobe = strobe,
            timerStyle = style(st?.optString("timer"), strobe),
            level = okLevel(st?.opt("level")),
            wakeIn = choices.ifEmpty { WAKE_IN_FALLBACK },
            alarmOnly = j.opt("alarmOnly") as? Boolean ?: false,
            timer = tj?.let { t -> val at = t.optLong("at"); val m = t.optInt("mins"); if (at > since && okWakeIn(m) != null) at to m else null },
        )
    }

    /** The look from the page, checked: junk dropped, numbers in range. */
    fun look(j: JSONObject?): SleepLook {
        if (j == null) return SleepLook()
        val d = SleepLook()
        fun hex(k: String) = j.optString(k).takeIf { Regex("^#[0-9a-fA-F]{6}$").matches(it) }?.drop(1)?.toInt(16)
        val show = HashMap<String, Boolean>()
        j.optJSONObject("show")?.let { o -> for (k in listOf("asleep", "alarm", "date", "count", "panel", "tasks", "squad")) if (o.has(k) && o.opt(k) is Boolean) show[k] = o.getBoolean(k) }
        val ink = hex("ink") ?: d.ink
        return SleepLook(
            size = if (j.has("size")) j.optDouble("size", d.size).takeIf { it.isFinite() }?.coerceIn(40.0, 300.0) ?: d.size else d.size,
            font = j.optString("font").takeIf { it in FONTS } ?: d.font,
            h12 = j.opt("h12") as? Boolean ?: d.h12, secs = j.opt("secs") as? Boolean ?: d.secs,
            ink = ink, text = hex("text") ?: ink,
            face = j.optString("face").takeIf { it in listOf("digital", "analogue") } ?: d.face,
            dial = j.optString("dial").takeIf { it in listOf("ticks", "numbers", "roman") } ?: d.dial,
            hand = j.optString("hand").takeIf { it in listOf("sweep", "tick", "none") } ?: d.hand,
            faceInk = hex("faceInk") ?: ink, handInk = hex("handInk") ?: ink, tickInk = hex("tickInk") ?: ink,
            digi = j.opt("digi") as? Boolean ?: d.digi,
            weight = j.optInt("weight").takeIf { it in 100..900 }?.let { it / 100 * 100 } ?: 0,
            spacing = if (j.has("spacing")) j.optDouble("spacing", 0.0).takeIf { it.isFinite() }?.coerceIn(-10.0, 40.0)?.let { Math.round(it).toDouble() } ?: 0.0 else 0.0,
            bright = if (j.has("bright")) j.optDouble("bright", 0.78).takeIf { it.isFinite() }?.coerceIn(0.1, 1.0)?.toFloat() ?: d.bright else d.bright,
            bg = hex("bg") ?: d.bg,
            pos = j.optString("pos").takeIf { it in listOf("top", "center", "bottom") } ?: d.pos,
            show = show,
            watch = j.optString("watch").takeIf { it in listOf("off", "small", "big") } ?: d.watch,
        )
    }
    /** The clock's words: "07:05" or "7:05" with "PM", seconds when on (the same as the page). */
    fun clockText(h: Int, m: Int, s: Int, h12: Boolean, secs: Boolean): Pair<String, String?> {
        val hh = if (h12) (if (h % 12 == 0) 12 else h % 12).toString() else "%02d".format(h)
        return "$hh:${"%02d".format(m)}${if (secs) ":%02d".format(s) else ""}" to (if (h12) (if (h < 12) "AM" else "PM") else null)
    }
    /** The clock's size in sp: the usual 92 times the chosen percent, never wider than the screen. */
    fun clockSp(widthDp: Float, size: Double, chars: Int, spacing: Double = 0.0): Float =
        minOf((92 * size / 100).toFloat(), widthDp * 0.94f / (maxOf(4, chars) * (0.6f + maxOf(0.0, spacing / 100).toFloat()))).coerceAtLeast(24f)
    /** "0:07", "12:34", "1:02:03". */
    fun watchText(ms: Long): String {
        val t = ms / 1000; val h = t / 3600; val m = (t % 3600) / 60; val s = t % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
    }

    // ---------- V1.43 short breaks (the same rules as web core/sleepmode.ts breakStage) ----------
    const val BREAK_REASK = 5 * 60_000L
    const val BREAK_ASKS = 3
    const val BREAK_MORE = 5 * 60_000L
    /** Where a break stands: "running" before its end, "ask" with which ask (1 to BREAK_ASKS), then "end". */
    fun breakStage(until: Long, now: Long): Pair<String, Int> {
        if (until <= 0) return "none" to 0
        if (now < until) return "running" to 0
        val k = ((now - until) / BREAK_REASK).toInt() + 1
        return if (k > BREAK_ASKS) "end" to BREAK_ASKS else "ask" to k
    }
    /** The next moment to look again: the end, each ask after it, then the last moment. */
    fun breakNext(until: Long, now: Long): Long {
        if (now < until) return until
        val k = (now - until) / BREAK_REASK + 1
        return until + k * BREAK_REASK
    }

    // ---------- V1.43 the analogue face (the same numbers as web core/sleepmode.ts handAngles) ----------
    /** The hands' angles in degrees clockwise from 12; the second hand sweeps (smooth) or ticks. */
    fun handAngles(h: Int, m: Int, s: Int, ms: Int, sweep: Boolean): Triple<Double, Double, Double> {
        val sec = s + if (sweep) ms / 1000.0 else 0.0; val mins = m + s / 60.0
        return Triple(((h % 12) + mins / 60) * 30, mins * 6, sec * 6)
    }
    fun dialLabels(dial: String): List<String> = when (dial) {
        "numbers" -> listOf("12") + (1..11).map { it.toString() }
        "roman" -> listOf("XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI")
        else -> emptyList()
    }
    /** The face's size in dp: the usual size times the slider, never over 92% of the width or 60% of the height. */
    fun dialDp(widthDp: Float, heightDp: Float, size: Double): Float =
        minOf(maxOf(200f, minOf(480f, minOf(widthDp, heightDp) * 0.8f)) * (size / 100).toFloat(), widthDp * 0.92f, heightDp * 0.6f).coerceAtLeast(80f)

    // ---------- V1.43 fonts, "Wake me up in" and the wake styles (the same as web core/sleepwake.ts) ----------
    val FONTS = listOf("thin", "bold", "rounded", "clean", "mono", "type", "serif", "digital", "pixel", "hand", "marker", "chalk")
    /** Each font's own weight and letter spacing (em), the same as the page's views/sleepmode.css. */
    fun fontBase(id: String): Pair<Int, Float> = when (id) {
        "bold" -> 800 to -0.045f; "rounded" -> 500 to -0.03f; "clean" -> 300 to -0.02f; "mono" -> 300 to -0.04f
        "type" -> 400 to -0.02f; "serif" -> 400 to -0.02f; "digital" -> 400 to 0.02f; "pixel" -> 400 to 0f
        "hand" -> 500 to 0f; "marker" -> 400 to 0f; "chalk" -> 400 to 0.01f; else -> 200 to -0.03f
    }
    val STYLES = listOf("chime", "sunrise", "alert", "wave", "white", "strobe", "light", "loud")
    /** The style that really rings: Strobe flash only once switched on (else Bright white, never a flash). */
    fun style(s: String?, strobe: Boolean): String { val v = if (s in STYLES) s!! else "chime"; return if (v == "strobe" && !strobe) "white" else v }
    data class Spec(val sound: String, val start: Double, val rise: Long, val loud: Boolean, val bright: Boolean)
    // V1.44: every style starts at half or more and is full within 30 s (V1.43 started at 12 to 35% and took up to 2
    // minutes: a friend found every style but Loud "super quiet"). Loud alone ignores the alarm loudness.
    fun spec(s: String) = when (s) {
        "sunrise" -> Spec("soft", 0.5, 30_000, false, false)
        "alert" -> Spec("alarm", 0.7, 10_000, false, false)
        "white", "strobe" -> Spec("alarm", 0.8, 5_000, false, true)
        "light" -> Spec("none", 0.0, 0, false, false)
        "loud" -> Spec("alarm", 1.0, 0, true, false)
        else -> Spec("soft", 0.5, 20_000, false, false)
    }
    // ---------- V1.47 a sound per alarm; custom sounds loop until Stop (the same as web core/sleepmode.ts) ----------
    /** A ring's own sound, checked: "", builtin, own, list, the playlist chat's style, or t:<16 hex> (one library file). */
    fun okSound(s: String?) = s != null && (s in listOf("", "builtin", "own", "list", "style") || (s.startsWith("t:") && ListClock.okId(s.drop(2))))
    /** A ring that rings until Stop (a custom sound that loops). Far off but safe to add to a time. */
    const val FOREVER = 100L * 365 * 86_400_000L
    data class Play(val kind: String, val id: String? = null, val loop: Boolean = true, val fade: Int = 0, val len: Long)
    /** What a ring plays (the developer's friend: "The custom default should just play on a loop forever until the user turns it
     *  off"): built in (stops after RING_FOR), your own sound or a looping file (until Stop), the whole file (its end). */
    fun ringPlay(sound: String, list: ListClock.PlanList?, day: String, haveOwn: Boolean): Play {
        val usual = if (haveOwn) Play("own", len = FOREVER) else Play("builtin", len = RING_FOR)
        if (sound == "builtin") return Play("builtin", len = RING_FOR)
        if (sound == "style" || sound == "own") return usual
        if (sound.startsWith("t:")) return Play("track", sound.drop(2), true, list?.fade ?: 0, FOREVER)
        if (sound == "list" || (sound.isEmpty() && list?.on == true)) {
            val e = list?.days?.get(day)
            if (list != null && e != null) return Play("track", e.id, list.end != "whole", list.fade, if (list.end == "whole") ListClock.ringFor("whole", e.secs) else FOREVER)
        }
        return usual
    }

    // ---------- V1.44 the alarm loudness and your own sound (web core/alarmsound.ts) ----------
    const val LEVEL_MIN = 0.1
    const val LEVEL_DEF = 0.8
    /** The loudness from the page: 0.1 to 1 in steps of 0.05; anything else the default. */
    fun okLevel(v: Any?): Double {
        val n = (v as? Number)?.toDouble() ?: return LEVEL_DEF
        if (!n.isFinite()) return LEVEL_DEF
        return Math.round(n.coerceIn(LEVEL_MIN, 1.0) * 20) / 20.0
    }
    /** The alarm volume step to set while ringing (or testing): the loudness of the stream's steps, Loud the top one,
     *  never 0 (a loudness of 10% on a 7 step stream is still step 1). */
    fun alarmStep(loud: Boolean, level: Double, max: Int): Int =
        if (max <= 0) 0 else if (loud) max else Math.round(okLevel(level) * max).toInt().coerceIn(1, max)
    /** Your own sound as the page made it: a 16 bit mono WAV, not empty, not over OWN_MAX_BYTES. */
    const val OWN_MAX_BYTES = 6 * 1024 * 1024
    fun okOwnWav(b: ByteArray): Boolean =
        b.size in 45..OWN_MAX_BYTES && String(b, 0, 4, Charsets.ISO_8859_1) == "RIFF" && String(b, 8, 4, Charsets.ISO_8859_1) == "WAVE"
            && (b[20].toInt() and 0xff) == 1 && (b[22].toInt() and 0xff) == 1 && (b[34].toInt() and 0xff) == 16
    fun ownName(v: String?): String? = v?.replace(Regex("[\\u0000-\\u001f]"), "")?.trim()?.take(40)?.takeIf { it.isNotEmpty() }
    const val TEST_MAX = 15_000L
    /** How loud the alarm is `ms` after it started ringing: rising unless Loud; Silent light is silent. */
    fun volume(style: String, ms: Long): Double {
        val s = spec(style)
        if (s.sound == "none") return 0.0
        if (s.rise <= 0) return 1.0
        return minOf(1.0, maxOf(s.start, s.start + (1 - s.start) * maxOf(0L, ms).toDouble() / s.rise))
    }
    const val STROBE_HZ = 2.0
    const val STROBE_MAX_HZ = 3.0
    const val PULSE_MS = 2000.0   // no pulse faster than one every 2 seconds
    const val WAVE_MS = 6000.0
    const val BREATHE_MS = 4000.0
    /** A light over the screen: colour 0xRRGGBB and how strong (0 to 1). */
    data class Light(val rgb: Int, val a: Double)
    private val WARM = intArrayOf(255, 238, 212)
    private val RAMP = listOf(0.0 to intArrayOf(36, 2, 0), 0.3 to intArrayOf(120, 14, 4), 0.6 to intArrayOf(230, 92, 30), 0.85 to intArrayOf(255, 182, 110), 1.0 to WARM)
    private fun rgb(c: IntArray) = (c[0] shl 16) or (c[1] shl 8) or c[2]
    private fun mix(a: IntArray, b: IntArray, k: Double) = IntArray(3) { Math.round(a[it] + (b[it] - a[it]) * k).toInt() }
    private fun split(c: Int) = intArrayOf((c shr 16) and 255, (c shr 8) and 255, c and 255)
    fun sunrise(p: Double): Light {
        val q = p.coerceIn(0.0, 1.0)
        var i = 0
        while (i < RAMP.size - 2 && q > RAMP[i + 1].first) i++
        val (p0, c0) = RAMP[i]; val (p1, c1) = RAMP[i + 1]
        return Light(rgb(mix(c0, c1, if (p1 > p0) (q - p0) / (p1 - p0) else 1.0)), 0.25 + 0.75 * q)
    }
    private fun wave01(t: Double, period: Double) = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / period)
    /** Is the strobe white `t` ms into the ring (half a period on, half off, never over 3 a second)? */
    fun strobeOn(t: Long, hz: Double = STROBE_HZ) = Math.floor(maxOf(0L, t) * 2 * minOf(hz, STROBE_MAX_HZ) / 1000).toLong() % 2 == 0L
    /** The light `t` ms after the alarm (negative: before it, only Sunrise). `calm`: Remove animations is on. */
    fun light(style: String, t: Long, dawnMs: Long, wave: Int, ink: Int, calm: Boolean = false): Light? {
        if (t < 0) return if (style == "sunrise" && dawnMs > 0 && -t <= dawnMs) sunrise(1 + t.toDouble() / dawnMs) else null
        val td = t.toDouble()
        return when (style) {
            "sunrise" -> Light(rgb(WARM), 1.0)
            "alert" -> Light(0xFF1A10, if (calm) 0.8 else 0.25 + 0.75 * wave01(td, PULSE_MS))
            "wave" -> Light(wave, if (calm) 0.8 else 0.3 + 0.7 * wave01(td, WAVE_MS))
            "white" -> Light(0xFFFFFF, 1.0)
            "strobe" -> if (calm || strobeOn(t)) Light(0xFFFFFF, 1.0) else Light(0x000000, 1.0)
            "light" -> Light(rgb(mix(split(ink), WARM, 0.35)), if (calm) 0.6 else 0.35 + 0.5 * wave01(td, BREATHE_MS))
            else -> null
        }
    }
    /** Dark words on a bright light. */
    fun darkOn(l: Light?): Boolean { if (l == null) return false; val c = split(l.rgb); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * l.a > 140 }
    /** The ring whose light is up before its alarm (Sunrise), not answered yet. */
    fun dawn(p: SleepPlan?, now: Long, fired: Set<String>): SleepRing? =
        p?.rings?.firstOrNull { it.key !in fired && it.from < it.at && now >= it.from && now < it.at }
    const val WAKE_IN_MIN = 5
    const val WAKE_IN_MAX = 16 * 60
    fun okWakeIn(m: Int): Int? = if (m in WAKE_IN_MIN..WAKE_IN_MAX) m else null
    /** When "Wake me up in `mins`" rings from `now`, on a whole minute (the page does the same). */
    fun wakeInAt(now: Long, mins: Int): Long = Math.round((now + mins * 60_000L) / 60_000.0) * 60_000L
    /** "20 min", "1 h 45", "7 h". */
    fun durText(mins: Int): String { val m = maxOf(0, mins); val h = m / 60; val r = m % 60; return if (h == 0) "$r min" else if (r == 0) "$h h" else "$h h ${"%02d".format(r)}" }
    /** "Wakes you in 6 h 12". */
    fun countdown(at: Long, now: Long): String { val m = Math.ceil((at - now) / 60_000.0).toInt(); return if (m <= 0) "Waking you now" else "Wakes you in ${durText(m)}" }
    /** The suggestions if the page sent none (the research list, the same as web core/sleepwake.ts):
     *  naps of 10, 20 and 90 minutes plus 5 to fall asleep, sleeps of 4 h 30, 6 h, 7 h 30 and 9 h plus 15. */
    val WAKE_IN_FALLBACK = listOf(10, 20, 90).map { WakeChoice("Nap", it + 5, it) } +
        listOf(270, 360, 450, 540).map { WakeChoice(if (it <= 360) "Short sleep" else "${it / 90} sleep loops", it + 15, it) }
    /** The stored plan (JSON) with "Wake me up in" set from `now` (0 or junk: none): the timer ring in place of any
     *  old one, in the same shape the page sends, so the page's next plan simply replaces it. */
    fun withWakeIn(j: JSONObject, mins: Int, now: Long, label: (Long) -> String): JSONObject {
        val p = from(j) ?: return j
        val out = JSONObject(j.toString())
        val rings = org.json.JSONArray()
        j.optJSONArray("rings")?.let { a -> for (i in 0 until a.length()) a.optJSONObject(i)?.takeIf { it.optString("id") != "timer" }?.let(rings::put) }
        val m = okWakeIn(mins)
        if (m == null) { out.put("rings", rings); out.put("timer", JSONObject.NULL); return out }
        val at = wakeInAt(now, m)
        val from = if (p.timerStyle == "sunrise") maxOf(p.since, at - p.sunrise * 60_000L) else at
        rings.put(JSONObject().put("id", "timer").put("at", at).put("label", label(at)).put("style", p.timerStyle).put("from", from))
        out.put("rings", rings); out.put("timer", JSONObject().put("at", at).put("mins", m))
        return out
    }
    /** When to wake the phone next: a sunrise's light, or the alarm itself. */
    fun nextWake(p: SleepPlan?, now: Long, fired: Set<String>): Long? =
        p?.rings?.filter { it.key !in fired && it.at + RING_GRACE > now }?.minOfOrNull { if (it.from in (now + 1) until it.at) it.from else it.at }

    /** The ring due now: from its time for RING_GRACE, once. */
    fun due(p: SleepPlan?, now: Long, fired: Set<String>): SleepRing? =
        p?.rings?.firstOrNull { it.key !in fired && now >= it.at && now < it.at + RING_GRACE }
    /** The next ring still to come (the one exact alarm to arm). */
    fun next(p: SleepPlan?, now: Long, fired: Set<String>): SleepRing? =
        p?.rings?.firstOrNull { it.key !in fired && it.at + RING_GRACE > now }
    /** V1.47: `len` a playlist's whole file ring (AlarmList.kt ListClock.ringFor); else the usual RING_FOR. */
    fun ringing(start: Long, now: Long, len: Long = RING_FOR) = start > 0 && now >= start && now < start + len
    /** The panel near the wake time: up from `panel` on (or while it rings, or tapped). */
    fun panelUp(p: SleepPlan?, now: Long, ringing: Boolean, peek: Boolean) = ringing || peek || (p?.panel?.let { now >= it } ?: false)

    /** The power button turned the screen off: bring the clock back over the lock screen, unless it was pressed
     *  again within DARK_AGAIN of the last time the clock came back (then the person wants it dark). */
    fun relaunch(now: Long, lastBack: Long, ringing: Boolean) = !ringing && (lastBack <= 0 || now - lastBack > DARK_AGAIN)

    /** "Asleep for 7 h 05" (the same words as the page). */
    fun asleepFor(since: Long, now: Long): String {
        val m = ((now - since) / 60_000L).toInt()
        if (m < 1) return "Asleep for a moment"
        val h = m / 60; val mi = m % 60
        return if (h > 0) (if (mi > 0) "Asleep for $h h ${"%02d".format(mi)}" else "Asleep for $h h") else "Asleep for $mi min"
    }
    fun drift(now: Long): Pair<Int, Int> {
        val k = (now / DRIFT_EVERY).toDouble()
        return Math.round(DRIFT * Math.sin(k * 0.71)).toInt() to Math.round(DRIFT * Math.cos(k * 0.53)).toInt()
    }
    /** Fired keys only from this sleep (a new sleep starts clean). */
    fun prune(fired: Set<String>, p: SleepPlan?): Set<String> = if (p == null) emptySet() else fired.filter { k -> p.rings.any { it.key == k } }.toSet()
}
