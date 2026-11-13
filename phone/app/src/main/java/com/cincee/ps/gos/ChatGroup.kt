package com.cincee.ps.gos

/**
 * Finished AI chats as one bundle in the shade (V1.56, the developer 13 Nov 2026: "group more than 1 notification into the same
 * one notification", as the Mac's one bubble does). Each chat stays its own notification in the "chats" group, so a
 * swipe on one still dismisses only that chat, on every device. From two chats up, a summary carries the group:
 * "3 Claude chats finished" with each chat's name on its own line, newest first (the tool's name after it when tools
 * differ). One chat: no summary, the chat shows on its own as before. During a call (Ays.inMeeting) no names.
 * The words are worked out here (pure, ChatGroupTest); Notifier.kt posts and removes the summary.
 */
object ChatGroup {
    /** The summary's tag; never a card id (cards are "c:" plus the chat's id). */
    const val TAG = "c-group"
    const val ID = 0x3ffffff1
    /** At most this many names in the expanded summary (Android's InboxStyle shows about this many). */
    const val LINES = 6

    data class Row(val id: String, val title: String, val sub: String, val at: Long)
    data class Summary(val title: String, val text: String, val lines: List<String>)

    /** "Codex finished" -> "Codex"; anything else is Claude, as on the Mac. */
    fun tool(sub: String): String = Regex("^(.+) finished$").find(sub.trim())?.groupValues?.get(1)?.takeIf { it.isNotBlank() } ?: "Claude"

    /** The chats in the shade now: the ones there, with `posted` added (it may not be listed yet) and `gone` taken out. */
    fun rows(inShade: List<Row>, posted: Row? = null, gone: String? = null): List<Row> {
        val all = inShade.filter { it.id != gone && it.id != posted?.id } + listOfNotNull(posted?.takeIf { it.id != gone })
        return all.sortedByDescending { it.at }
    }

    /** The summary for these chats, or null when there are fewer than two (no bundle needed). */
    fun summary(rows: List<Row>, private: Boolean): Summary? {
        if (rows.size < 2) return null
        val tools = rows.map { tool(it.sub) }.distinct()
        val what = if (tools.size == 1) "${tools[0]} chats" else "AI chats"
        val title = "${rows.size} $what finished"
        if (private) return Summary(title, "", emptyList())
        val mixed = tools.size > 1
        val lines = rows.take(LINES).map { if (mixed) "${it.title} · ${tool(it.sub)}" else it.title } +
            (if (rows.size > LINES) listOf("and ${rows.size - LINES} more") else emptyList())
        return Summary(title, rows.joinToString(", ") { it.title }, lines)
    }
}
