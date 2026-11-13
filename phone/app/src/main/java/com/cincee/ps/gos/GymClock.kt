package com.cincee.ps.gos

import org.json.JSONObject

/**
 * The gym reminder's timing on the phone, with no Android in it (unit tested in src/test). The page
 * (web src/core/gym.ts, src/gymwatch.ts) sends a plan: the gym times for the next 8 days, the
 * days the developer already acknowledged, and the minutes before (120, 60, 30, 10 notify; 16 rings). From that
 * the shell works out every step itself, so the reminders and the ring come on time while PS sleeps.
 * A step more than its grace late (the phone was off) is skipped, never fired late in a pile.
 */
data class GymItem(val day: String, val at: Long)
data class GymPlan(val on: Boolean, val time: String, val items: List<GymItem>, val acked: Set<String>,
                   val before: List<Int>, val ring: Int, val grace: Long)
data class GymStep(val id: String, val day: String, val at: Long, val mins: Int, val due: Long, val ring: Boolean)
/** One ring and its snoozes, kept while it lasts: `at` gym time, `start` when this ring began, `snoozeAt` when
 *  Later rings again (0 while it rings). */
data class GymRing(val day: String, val at: Long, val start: Long, val snoozeAt: Long = 0)
/** Where a ring stands now. AGAIN: Later's 5 minutes are up. MISSED: it rang 10 minutes unanswered. DONE: acknowledged or switched off. */
enum class RingNow { NONE, RINGING, SNOOZED, AGAIN, MISSED, DONE }

object GymClock {
    /** The ring may still start this late (the phone was rebooting at 07:44, say); notifications only `grace`. */
    const val RING_GRACE = 5 * 60_000L
    /** Each ring (the first and every one after Later) stops by itself after this, then a missed-gym notification (the developer, 2 Nov 2026). */
    const val RING_FOR = 10 * 60_000L
    /** Later: quiet this long, then it rings again. */
    const val SNOOZE = 5 * 60_000L
    private val DAY = Regex("""^\d{4}-\d{2}-\d{2}$""")
    private val TIME = Regex("""^([01]\d|2[0-3]):[0-5]\d$""")

    fun parse(s: String?): GymPlan? = runCatching { from(JSONObject(s ?: return null)) }.getOrNull()
    fun from(j: JSONObject): GymPlan {
        val items = ArrayList<GymItem>()
        j.optJSONArray("items")?.let { a ->
            for (i in 0 until minOf(a.length(), 20)) {
                val o = a.optJSONObject(i) ?: continue
                val day = o.optString("day"); val at = o.optLong("at")
                if (DAY.matches(day) && at > 0) items.add(GymItem(day, at))
            }
        }
        val acked = HashSet<String>()
        j.optJSONArray("acked")?.let { a -> for (i in 0 until minOf(a.length(), 30)) a.optString(i).takeIf { DAY.matches(it) }?.let(acked::add) }
        val before = ArrayList<Int>()
        j.optJSONArray("before")?.let { a -> for (i in 0 until minOf(a.length(), 8)) a.optInt(i).takeIf { it in 1..600 }?.let(before::add) }
        return GymPlan(
            on = j.optBoolean("on"),
            time = j.optString("time").takeIf { TIME.matches(it) } ?: "08:00",
            items = items.sortedBy { it.at },
            acked = acked,
            before = before.ifEmpty { listOf(120, 60, 30, 10) },
            ring = j.optInt("ring", 16).coerceIn(1, 600),
            grace = j.optLong("grace", 120_000L).coerceIn(30_000L, 15 * 60_000L),
        )
    }
    fun toJson(p: GymPlan): JSONObject = JSONObject().put("on", p.on).put("time", p.time)
        .put("items", org.json.JSONArray().apply { p.items.forEach { put(JSONObject().put("day", it.day).put("at", it.at)) } })
        .put("acked", org.json.JSONArray(p.acked.sorted())).put("before", org.json.JSONArray(p.before)).put("ring", p.ring).put("grace", p.grace)

    /** Every step for the days not acknowledged (by the vault or on this phone), soonest first. */
    fun steps(p: GymPlan?, localAcked: Set<String> = emptySet()): List<GymStep> {
        if (p == null || !p.on) return emptyList()
        val out = ArrayList<GymStep>()
        for (g in p.items) {
            if (g.day in p.acked || g.day in localAcked) continue
            for (m in p.before + p.ring) out.add(GymStep("${g.day}:$m", g.day, g.at, m, g.at - m * 60_000L, m == p.ring))
        }
        return out.sortedBy { it.due }
    }
    private fun graceOf(p: GymPlan, s: GymStep) = if (s.ring) RING_GRACE else p.grace

    /** What fires now: due, within its grace, not fired yet. A ring comes first, then the newest notification only. */
    fun dueNow(p: GymPlan?, now: Long, fired: Set<String>, localAcked: Set<String> = emptySet()): List<GymStep> {
        if (p == null) return emptyList()
        val live = steps(p, localAcked).filter { it.due <= now && now < it.due + graceOf(p, it) && it.id !in fired }
        val ring = live.filter { it.ring }.takeLast(1)
        val note = live.filter { !it.ring }.takeLast(1)
        return ring + note
    }
    /** The next step still to come (the one alarm to arm), or null. */
    fun next(p: GymPlan?, now: Long, fired: Set<String>, localAcked: Set<String> = emptySet()): GymStep? =
        steps(p, localAcked).firstOrNull { it.due > now && it.id !in fired }

    /** Steps that are over and done with: kept only from yesterday on. */
    fun prune(fired: Set<String>, today: String): Set<String> {
        val y = minusDay(today)
        return fired.filter { it.take(10) >= y }.takeLast(60).toSet()
    }
    internal fun minusDay(day: String): String {
        val d = java.time.LocalDate.parse(day).minusDays(1)
        return d.toString()
    }

    /** Where the ring stands. Acknowledge (here, on the Mac: the plan's acked) ends it at any time, ringing or snoozed. */
    fun ringNow(r: GymRing?, p: GymPlan?, now: Long, localAcked: Set<String>): RingNow = when {
        r == null -> RingNow.NONE
        p == null || !p.on || r.day in p.acked || r.day in localAcked -> RingNow.DONE
        r.snoozeAt > 0 && now < r.snoozeAt -> RingNow.SNOOZED
        r.snoozeAt > 0 && now < r.snoozeAt + RING_GRACE -> RingNow.AGAIN
        r.snoozeAt > 0 -> RingNow.MISSED            // the phone was off when Later's ring was due
        now < r.start + RING_FOR -> RingNow.RINGING
        else -> RingNow.MISSED
    }
    /** Later: quiet now, rings again in 5 minutes. */
    fun later(r: GymRing, now: Long) = r.copy(snoozeAt = now + SNOOZE)
    /** Later is over: a new ring, again for at most 10 minutes. */
    fun again(r: GymRing, now: Long) = r.copy(start = now, snoozeAt = 0)
    /** When the ring next needs the alarm: Later's ring, or this ring's 10 minutes being up. */
    fun ringWake(r: GymRing?): Long? = when { r == null -> null; r.snoozeAt > 0 -> r.snoozeAt; else -> r.start + RING_FOR }

    /** "Gym in 2 h", "Gym in 30 min", "Gym time". */
    fun title(at: Long, now: Long): String {
        val left = Math.round((at - now) / 60_000.0).toInt()
        return when {
            left <= 0 -> "Gym time"
            left >= 60 && left % 60 == 0 -> "Gym in ${left / 60} h"
            left > 60 -> "Gym in ${left / 60} h ${left % 60} min"
            else -> "Gym in $left min"
        }
    }
}
