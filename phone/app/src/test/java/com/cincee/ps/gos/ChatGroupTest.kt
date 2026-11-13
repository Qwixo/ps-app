package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Finished AI chats bundled in the shade (ChatGroup.kt, V1.56). Fictional chats only. */
class ChatGroupTest {
    private val t0 = 1_794_520_000_000L
    private fun row(id: String, title: String, at: Long, sub: String = "Claude finished") = ChatGroup.Row(id, title, sub, at)

    @Test fun oneChatNeedsNoBundle() {
        assertNull(ChatGroup.summary(listOf(row("c:a", "Fictional chat", t0)), private = false))
        assertNull(ChatGroup.summary(emptyList(), private = false))
    }

    @Test fun twoChatsBundleNewestFirst() {
        val rows = ChatGroup.rows(listOf(row("c:a", "PS app manager chat", t0)), posted = row("c:b", "Fictional login fix", t0 + 5_000))
        val s = ChatGroup.summary(rows, private = false)!!
        assertEquals("2 Claude chats finished", s.title)
        assertEquals(listOf("Fictional login fix", "PS app manager chat"), s.lines)
        assertEquals("Fictional login fix, PS app manager chat", s.text)
    }

    @Test fun theSameChatAgainIsOneRow() {
        val rows = ChatGroup.rows(listOf(row("c:a", "Old name", t0), row("c:b", "B", t0 + 1)), posted = row("c:a", "New name", t0 + 9_000))
        assertEquals(listOf("c:a", "c:b"), rows.map { it.id })
        assertEquals("New name", rows[0].title)
    }

    @Test fun mixedToolsSayTheirTool() {
        val rows = ChatGroup.rows(listOf(row("c:a", "Fictional chat", t0), row("c:codex-x", "Fictional thread", t0 + 1, "Codex finished")))
        val s = ChatGroup.summary(rows, private = false)!!
        assertEquals("2 AI chats finished", s.title)
        assertEquals(listOf("Fictional thread · Codex", "Fictional chat · Claude"), s.lines)
    }

    @Test fun aChatGoneLeavesOneSoTheBundleGoes() {
        val shade = listOf(row("c:a", "A", t0), row("c:b", "B", t0 + 1))
        assertNull(ChatGroup.summary(ChatGroup.rows(shade, gone = "c:b"), private = false))
        assertEquals(2, ChatGroup.rows(shade + row("c:c", "C", t0 + 2), gone = "c:b").size)
    }

    @Test fun inACallNoNames() {
        val s = ChatGroup.summary(listOf(row("c:a", "Secret", t0, ""), row("c:b", "Other", t0 + 1, "")), private = true)!!
        assertEquals("2 Claude chats finished", s.title)
        assertEquals("", s.text)
        assertTrue(s.lines.isEmpty())
    }

    @Test fun manyChatsShowSixAndACount() {
        val rows = (1..9).map { row("c:$it", "Chat $it", t0 + it) }
        val s = ChatGroup.summary(ChatGroup.rows(rows), private = false)!!
        assertEquals("9 Claude chats finished", s.title)
        assertEquals(7, s.lines.size)
        assertEquals("Chat 9", s.lines[0])
        assertEquals("and 3 more", s.lines[6])
    }

    @Test fun toolFromTheLine() {
        assertEquals("Codex", ChatGroup.tool("Codex finished"))
        assertEquals("Gemini", ChatGroup.tool("Gemini finished"))
        assertEquals("Claude", ChatGroup.tool(""))
        assertEquals("Claude", ChatGroup.tool("something else"))
    }
}
