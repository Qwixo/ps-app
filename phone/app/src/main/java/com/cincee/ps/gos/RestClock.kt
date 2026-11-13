package com.cincee.ps.gos

/**
 * The Fitness rest timer's state, with no Android in it (unit tested in src/test). Everything is
 * worked out from wall clock times, never from a counter, so the page, the notification and the
 * alarm always agree and nothing has to tick while the phone sleeps.
 */
data class Rest(
    val id: String,
    val exercise: String,
    val set: Int,
    val of: Int,
    val sec: Int,            // planned total, every +15 included
    val startedAt: Long,
    val endsAt: Long,
    val sound: Boolean = true,
    val over: Boolean = false,
    val overAt: Long = 0,
) {
    fun leftMs(now: Long) = if (over) 0L else (endsAt - now).coerceAtLeast(0L)
    fun running(now: Long) = !over && endsAt > now
    /** Due: the alarm (or the service's own check) should end it now. */
    fun due(now: Long) = !over && endsAt <= now
    /** "Bench press · set 3 of 5 done" while resting. */
    fun doneLine() = listOf(exercise.ifBlank { "Rest" }, if (set > 0) "set $set${if (of > 0) " of $of" else ""} done" else "").filter { it.isNotEmpty() }.joinToString(" · ")
    /** "Bench press · set 4 of 5" once the rest is over. */
    fun nextLine() = listOf(exercise.ifBlank { "Next set" }, if (set > 0) "set ${set + 1}${if (of > 0) " of $of" else ""}" else "").filter { it.isNotEmpty() }.joinToString(" · ")
}

object RestClock {
    const val MIN_SEC = 1
    const val MAX_SEC = 3600
    const val MAX_ADD = 600

    fun start(now: Long, sec: Int, exercise: String, set: Int, of: Int = 0, id: String = "", sound: Boolean = true): Rest {
        val s = sec.coerceIn(MIN_SEC, MAX_SEC)
        return Rest(id = id.take(64), exercise = exercise.trim().take(60), set = set.coerceIn(0, 999), of = of.coerceIn(0, 999),
            sec = s, startedAt = now, endsAt = now + s * 1000L, sound = sound)
    }

    /** +15 (or any amount; negative trims, never to less than one second from now). Null rest or an
     *  over rest stays as it is: a tap on an old notification must not bring a finished rest back. */
    fun add(r: Rest?, now: Long, sec: Int): Rest? {
        if (r == null || r.over) return r
        val d = sec.coerceIn(-MAX_SEC, MAX_ADD)
        val end = (r.endsAt + d * 1000L).coerceAtLeast(now + 1000L).coerceAtMost(now + MAX_SEC * 1000L)
        val total = ((end - r.startedAt + 999) / 1000).toInt().coerceAtLeast(MIN_SEC)
        return r.copy(endsAt = end, sec = total)
    }

    /** Skip or ran out: over, stamped once (a second alarm or a double tap changes nothing). */
    fun finish(r: Rest?, now: Long): Rest? = if (r == null || r.over) r else r.copy(over = true, overAt = now)

    /** What the alarm should do when it fires at `now`: end it, wait (+15 moved the end), or nothing. */
    enum class Fire { END, REARM, NOTHING }
    fun onAlarm(r: Rest?, now: Long, slackMs: Long = 500): Fire = when {
        r == null || r.over -> Fire.NOTHING
        r.endsAt <= now + slackMs -> Fire.END
        else -> Fire.REARM
    }

    // Plain one line encoding for SharedPreferences (org.json is a stub in local unit tests).
    private const val SEP = '\u001F'
    fun encode(r: Rest?): String = if (r == null) "" else listOf(
        "1", r.id, r.exercise, r.set, r.of, r.sec, r.startedAt, r.endsAt, if (r.sound) 1 else 0, if (r.over) 1 else 0, r.overAt,
    ).joinToString(SEP.toString()) { it.toString().replace(SEP, ' ') }

    fun decode(s: String?): Rest? {
        val p = s?.split(SEP) ?: return null
        if (p.size != 11 || p[0] != "1") return null
        return runCatching {
            Rest(id = p[1], exercise = p[2], set = p[3].toInt(), of = p[4].toInt(), sec = p[5].toInt(), startedAt = p[6].toLong(),
                endsAt = p[7].toLong(), sound = p[8] == "1", over = p[9] == "1", overAt = p[10].toLong())
        }.getOrNull()
    }
}
