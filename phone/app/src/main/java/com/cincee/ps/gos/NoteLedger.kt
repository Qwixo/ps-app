package com.cincee.ps.gos

/**
 * The phone's memory of which card notifications it has already shown (the developer, 2 Nov 2026: the same
 * Instantly email arrived several times, and after a restart notifications he had already seen came
 * straight back). The page re-sends every card the developer has not dismissed: once a minute while PS is open,
 * on every background check (a fresh headless page each time) and after every restart, because its own
 * "already sent" list lives only as long as that page. The shell used to post whatever it was told, so
 * a notification the developer had swiped away, or seen before the restart, came back with sound.
 *
 * Each card is one entry, keyed by its stable id from the source item ("n:" + the Instantly email id,
 * "m:" + the reply record, "c:" + the chat, the meeting alert ids) and its revision ("rev": the email's
 * date, or when a "Remind me in" came due), never a time of its own or a random number. The entry is
 * written before the notification is posted:
 *  - NEW: never shown: post it, with sound.
 *  - UPDATE: shown before and still in the shade: replace it in place, silently (same tag).
 *  - SKIP: shown before and since swiped, opened or dismissed: leave it gone.
 * A newer email in the thread or a remind coming due is a new revision, so it does show again. Entries
 * older than [keepMs] go, and at most [max] are kept. Ids and dates only, never names or text, in PS's
 * private storage on this phone (nothing synced, so no Supabase egress). Plain JVM, unit tested.
 */
class NoteLedger(
    private val load: () -> String?,
    private val save: (String) -> Unit,
    private val keepMs: Long = 60L * 86_400_000,
    private val max: Int = 500,
) {
    enum class Act { NEW, UPDATE, SKIP }

    private var seen: LinkedHashMap<String, Long>? = null

    private fun loaded(): LinkedHashMap<String, Long> = seen ?: LinkedHashMap<String, Long>().also { m ->
        load()?.lineSequence()?.forEach { line ->
            val tab = line.indexOf('\t')
            if (tab > 0) line.substring(0, tab).toLongOrNull()?.let { at -> m[line.substring(tab + 1)] = at }
        }
        seen = m
    }

    @Synchronized fun decide(id: String, rev: String, showing: Boolean, now: Long): Act {
        val m = loaded()
        val k = key(id, rev)
        if (m.containsKey(k)) return if (showing) Act.UPDATE else Act.SKIP
        m[k] = now
        prune(m, now)
        save(m.entries.joinToString("\n") { "${it.value}\t${it.key}" })
        return Act.NEW
    }

    @Synchronized fun size(): Int = loaded().size

    private fun prune(m: LinkedHashMap<String, Long>, now: Long) {
        m.entries.removeAll { it.value < now - keepMs }
        if (m.size > max) m.entries.sortedBy { it.value }.take(m.size - max).map { it.key }.forEach { m.remove(it) }
    }

    companion object {
        /** One line per entry: no tab or line break may get into a key. */
        fun key(id: String, rev: String) = "${id.take(40)}|${rev.take(80)}".replace(Regex("[\\t\\r\\n]"), " ")
        /** Cards the page keeps until the developer answers them (client emails, lead replies, finished chats): a swipe in the
         *  shade is his Dismiss. Meeting cards and call alarms just leave the shade. */
        fun swipeDismisses(id: String) = id.startsWith("m:") || id.startsWith("n:") || id.startsWith("c:")
    }
}
